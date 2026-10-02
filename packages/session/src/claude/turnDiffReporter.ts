/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * 轮次变更合成器（ADR 0008 / turn-archive B）：result 消息处理点后置任务——
 * 合成 turn-diff 自定义事件消息入流（local / remote 两模式共用，模式同
 * GoalStatusHandler），journal 口径命中时封口归档。
 *
 * 口径：「归因」与「投影」分层（turn-archive B 后快照链退场）——
 * - 归因层（主源）：turn 内 journal 累积（本会话 Edit 族工具的内容对）。会话私有，
 *   天然免疫并发会话/用户手改/shell 改动的归因污染（Codex TurnDiffTracker /
 *   ZCode per-turn 快照同款机制）；git: null（快照链退役后恒 null，web 卡按钮不依赖它）。合成后封口归档
 *   （turnArchiveStore，历史轮回看的精确性基础）。
 * - 投影层（降级档）：累积为空时用工具事件行数累加（Bash/subagent 写入不在内），
 *   `git: null` 显式标记（web 卡按钮同样可用——审查 turn 档由归档/降级源供数）。
 *
 * 轮界隔离（排队消息竞态，2026-09-30）：result 到达时**同步冻结**本轮采集上下文
 * （TurnContext 五件套整包换新），旧引用闭包交给封口链——封口操作的是冻结快照，
 * 与后续轮的 observe 天然隔离（queue 立即投喂下一轮时不串轮、不丢数据）。封口
 * 入串行队列执行（归档 seal / 全文落盘不并发，滚动单条语义下并发覆盖会丢轮）。
 *
 * 时序：卡片先于归档 IO——卡片 wire 载荷（stats/files）纯内存可算，在在途读盘
 * 收口后立即入流，归档封口（全文落盘 + 目录 diff + seal，秒级盘 IO）在卡片之后
 * 后台执行。排队消息场景下保证卡片落库在下一轮用户消息之前（result → 卡片 →
 * 下一轮 user）；归档晚到由读侧降级协议兜底。
 *
 * journal 采集边界：覆盖 Edit/Write/MultiEdit/NotebookEdit 的 toolUseResult 全文对
 * （afterContent 落笔即读盘补全），主线与 sidechain（subagent）消息流一视同仁——
 * reporter 不看 parent_tool_use_id，sidechain 编辑归到外层 turn（采集契约有测试锁定）。
 * sidechain 兜底（E2E 实证）：CC 不给 sidechain tool_result 附 toolUseResult，
 * 「一视同仁」只有半边成立——sidechain 的编辑族 tool_use 观测时预读盘记 before、
 * 对应 tool_result 无 toolUseResult 时再读盘记 after（is_error / 零变更不入账）。
 * Bash 写入不在内——漏但不错归因（ZCode 同行为）。投影口径（降级档）同此边界。
 */

import { readFile } from 'node:fs/promises'
import type { RawJSONLines } from '@/claude/types'
import { OVERSIZE_DIFF_LINES, TURN_DIFF_EVENT, getField, summarizeTurnDiffFiles, TurnDiffPayloadSchema, type TurnDiffFileEntry, type TurnDiffPayload } from '@mobi/shared'
import { git, textLineCount } from '@mobi/node-core/git/gitExec'
import { ToolChangeJournal } from '@mobi/node-core/git/toolChangeJournal'
import { contentsChangeOf } from '@mobi/node-core/git/reviewEntry'
import { synthesizeContentsPatch } from '@mobi/node-core/git/contentsPatch'
import type { FileTurnFulltextStore, TurnFulltextSealed } from '@mobi/node-core/git/turnFulltextStore'
import type { TurnArchiveStore } from '@mobi/node-core/git/turnArchiveStore'
import { logger } from '@mobi/node-core/logger'

/** 记变更的编辑族工具（工具名 → 是否取 input.file_path；名单即采集口径边界） */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** 合成事件信封（mobiCustomEvent 标记由 apiSession 咽喉点识别，custom role 原样落库）。
 *  positionBeforeResultId：归属 result 行的 nativeId，随信封透传 hub——落库 position_at
 *  由 hub 权威按该行定位（result 前 -1ms），消除 queue 立即投喂时卡片输给下一轮用户气泡
 *  的毫秒级展示竞态；锚定具体行而非「最新」，封口异步期间下一轮 result 已落库也不锚错轮 */
type CustomEventEnvelope = {
    mobiCustomEvent: true
    role: 'custom'
    content: unknown[]
    positionBeforeResultId?: string
}

/** turn 内累积的单文件内容对 = ToolChangeEntry 的归并规则（before 取首次 / after 取
 *  末次 / writeCount 累加 / toolNames 保序去重）——复用 ToolChangeJournal 本体作每轮
 *  累积器，规则单源不双写（它纯内存无 I/O，I/O 只在 Persistent 包装层） */

/** 合成结果（带供数源标签：journal 源需封口归档） */
type ComposedFiles = {
    turnIndex: number
    baseTurnIndex: number | null
    files: TurnDiffFileEntry[]
    git: { baseTree: string; headTree: string } | null
    source: 'journal' | 'projection'
}

/**
 * 单轮采集上下文：轮界状态五件套整包。result 到达时同步换新实例（冻结语义），
 * 旧引用闭包交给封口链消费——异步读盘补全等回写一律捕获所属 ctx（写冻结的旧
 * accumulator 无害：封口链在等它，或已消费完毕无人再读），与下一轮互不干扰，
 * 无需纪元守卫。
 */
type TurnContext = {
    /** 归因主源：turn 内按 path 累积的内容对 */
    accumulator: ToolChangeJournal
    /** 投影口径：path → 行数累加（末位降级档的数据源） */
    projected: Map<string, { additions: number; deletions: number }>
    /** toolUseId → file_path + 工具名（assistant tool_use 观测，供 tool_result 的 patch 归位与 journal 归因） */
    toolFilePaths: Map<string, { path: string; toolName: string }>
    /** 在途异步读盘（封口合成前 await，保确定性） */
    pendingReads: Set<Promise<void>>
    /** 同 path 补读的串行链：并发读的 resolve 顺序不保证，乱序 recordAfter 会把中间态
     *  内容当末次写进 journal/累积（turn 封口与审查供数随之失真）——按调度序串行应用，
     *  后调度的读反映更新的磁盘状态，afterContent 单调前进 */
    readChains: Map<string, Promise<void>>
    /** sidechain 兜底的盘上预读（path → before 侧全文；读失败 = 新建语义 null）：
     *  sidechain tool_use 观测时落，对应 tool_result 无 toolUseResult 时消费。
     *  同 path 首次预读为准（journal before 取首次同构） */
    preReads: Map<string, Promise<string | null>>
}

function createTurnContext(): TurnContext {
    return {
        accumulator: new ToolChangeJournal(),
        projected: new Map(),
        toolFilePaths: new Map(),
        pendingReads: new Set(),
        readChains: new Map(),
        preReads: new Map(),
    }
}

export class TurnDiffReporter {
    /** 当前轮采集上下文（observe 永远写当前轮；result 到达即整包换新） */
    private ctx = createTurnContext()
    /** 封口串行链：归档 seal / 全文落盘不并发（滚动单条语义下并发覆盖会丢轮） */
    private sealQueue: Promise<void> = Promise.resolve()
    /** 投影口径的轮次计数（仅归档缺省时的兜底；归档在则 turnIndex 从归档接续） */
    private turnCounter = 0

    constructor(
        private readonly send: (raw: RawJSONLines) => void,
        /** turn 封口归档（历史轮回看的事实源）；缺省 = 不封口 */
        private readonly archive?: TurnArchiveStore,
        /** 全文目录存储（hydration）：封口落 a/b 全文 + 目录模式合成 patch + 归档带
         *  ref；缺省 = 归档条目无 ref（patch 走单文件兜底合成，行为同 B 方案） */
        private readonly fulltext?: Pick<FileTurnFulltextStore, 'sealFiles' | 'prune'>,
    ) {}

    /** 每条 SDK 转换消息（RawJSONLines）流过时观测；不抛错、不影响主流程 */
    observe(message: RawJSONLines): void {
        try {
            this.observeInner(message)
        } catch (e) {
            logger.debug('[TurnDiffReporter] observe failed', e)
        }
    }

    private observeInner(message: RawJSONLines): void {
        const msg = message.message as { role?: string; content?: unknown } | undefined
        if (!Array.isArray(msg?.content)) return

        if (message.type === 'assistant') {
            for (const block of msg.content as Array<{ type?: string; id?: string; name?: string; input?: unknown }>) {
                if (block?.type !== 'tool_use' || !block.id || !block.name) continue
                const filePath = EDIT_TOOLS.has(block.name)
                    ? (block.input as { file_path?: unknown } | undefined)?.file_path
                    : undefined
                if (typeof filePath === 'string' && filePath.length > 0) {
                    const sidechain = getField(message, 'isSidechain') === true
                    this.ctx.toolFilePaths.set(block.id, { path: filePath, toolName: block.name })
                    // sidechain 不进投影：其结果永不带 structuredPatch，只会产 0/0 噪声条目
                    if (!sidechain && !this.ctx.projected.has(filePath)) this.ctx.projected.set(filePath, { additions: 0, deletions: 0 })
                    // sidechain 兜底的 before 侧预读（主线结果带 toolUseResult，用不上不预读）
                    if (sidechain) this.schedulePreRead(filePath)
                }
            }
            return
        }

        if (message.type === 'user') {
            // toolUseResult.structuredPatch：Edit/MultiEdit/Write 的原生 unified diff hunk。
            // 并行工具调用的多条 tool_result 会合并进一条 user 消息——逐条归位（toolUseResult
            // 为数组时按 tool_result 顺序一一对应），只取首条会漏计其余补丁
            const results = (msg.content as Array<{ type?: string; tool_use_id?: string }>)
                .filter((c): c is { type: 'tool_result'; tool_use_id: string } => c?.type === 'tool_result' && !!c.tool_use_id)
            if (results.length === 0) return
            // toolUseResult 键名双格式（SDK 消息驼峰/下划线并存，E2E 实证 snake_case）：
            // 必须走 getField，直读驼峰会让投影与 journal 双双空转（E2E 实证 +0 -0）
            const raw = getField(message, 'toolUseResult')
            if (raw === undefined || raw === null) {
                // 无 toolUseResult（sidechain 实证形态）：兜底采集（预读 before + 读盘 after）
                this.captureUnattributedWrites(results)
                return
            }
            const patches: unknown[] = Array.isArray(raw) ? raw : [raw]
            for (const [i, result] of results.entries()) {
                const observed = this.ctx.toolFilePaths.get(result.tool_use_id)
                if (!observed) continue
                // 单结果形态 toolUseResult 就是对象本身；合并数组形态按序对应（缺位跳过）
                const patchSource = Array.isArray(raw) ? patches[i] : patches[0]
                this.applyStructuredPatch(observed.path, patchSource)
                // 全文对采集（归因主源）：与行数投影同一遍历，形状不符静默跳过
                this.recordJournalChange(observed, patchSource)
            }
        }
    }

    /**
     * toolUseResult 的全文对采集（归因主源）：Edit/MultiEdit 类结果带 originalFile
     * （编辑前全文）、Write 类带 content（写入后全文）；afterContent 缺失（Edit 类）
     * 时异步读盘补全——落笔后的磁盘内容即编辑后全文（ZCode 同款「记录时读盘记全」，
     * 历史轮回看不受文件后续变化影响）。两者都缺（非编辑族结果）跳过。
     * path 优先取结果自带的 filePath，缺省回退 tool_use 的 file_path。
     */
    private recordJournalChange(observed: { path: string; toolName: string }, patchSource: unknown): void {
        const src = patchSource as { filePath?: unknown; originalFile?: unknown; content?: unknown } | undefined
        if (!src || typeof src !== 'object') return
        const path = typeof src.filePath === 'string' && src.filePath.length > 0 ? src.filePath : observed.path
        const beforeContent = typeof src.originalFile === 'string' ? src.originalFile : null
        const afterContent = typeof src.content === 'string' ? src.content : undefined
        if (beforeContent === null && afterContent === undefined) return
        // turn 内累积（归因主源）：归并规则单源 ToolChangeJournal
        this.ctx.accumulator.record({ path, beforeContent, afterContent, toolName: observed.toolName })
        // afterContent 缺失（Edit 类只带 before）：异步读盘补全 turn 累积
        if (afterContent === undefined) this.scheduleAfterRead(path, observed.toolName)
    }

    /** 异步读盘补 afterContent：fire-and-forget；捕获所属 ctx——回读写进冻结的旧
     *  accumulator 无害（封口链在等它或已消费完），跨轮隔离由 ctx 换新天然保证；
     *  同 path 挂上串行链（见 readChains 注释）保证应用顺序 = 调度顺序 */
    private scheduleAfterRead(path: string, toolName: string): void {
        const ctx = this.ctx
        const prior = ctx.readChains.get(path) ?? Promise.resolve()
        const task = prior
            .then(() => readFile(path, 'utf8'))
            .then((content) => {
                ctx.accumulator.recordAfter(path, content, toolName)
            })
            .catch(() => undefined) // 读失败（文件已删/不可读）：保持占位 null；链上吞错不断链
            .finally(() => ctx.pendingReads.delete(task))
        const chained = task.finally(() => {
            if (ctx.readChains.get(path) === chained) ctx.readChains.delete(path)
        })
        ctx.pendingReads.add(task)
        ctx.readChains.set(path, chained)
    }

    /** sidechain 兜底预读（before 侧唯一来源）：tool_use 观测到落笔前，磁盘即编辑前
     *  内容；同 path 首次为准（journal before 取首次同构）；读失败 = 新建语义 null */
    private schedulePreRead(path: string): void {
        if (this.ctx.preReads.has(path)) return
        this.ctx.preReads.set(path, readFile(path, 'utf8').catch(() => null))
    }

    /**
     * sidechain 兜底采集：tool_result 无 toolUseResult 时的内容对补全——before 取
     * tool_use 观测时的预读、after 读盘（落笔后的磁盘内容）。有预读的编辑族 result
     * 才兜底；is_error（失败的编辑盘上无变更）与 before/after 相同（零变更）不入账。
     * 回写捕获所属 ctx（跨轮隔离由 ctx 换新保证），挂 pendingReads（封口收口）。
     */
    private captureUnattributedWrites(results: ReadonlyArray<{ type: 'tool_result'; tool_use_id: string }>): void {
        const ctx = this.ctx
        for (const result of results) {
            if ((result as { is_error?: unknown }).is_error === true) continue
            const observed = ctx.toolFilePaths.get(result.tool_use_id)
            if (!observed) continue
            const preRead = ctx.preReads.get(observed.path)
            if (!preRead) continue
            const task = preRead
                .then((before) => readFile(observed.path, 'utf8').then((after) => ({ before, after })).catch(() => ({ before, after: null })))
                .then(({ before, after }) => {
                    if (after === null || after === before) return
                    ctx.accumulator.record({ path: observed.path, beforeContent: before, toolName: observed.toolName })
                    ctx.accumulator.recordAfter(observed.path, after, observed.toolName)
                })
                .catch(() => undefined)
                .finally(() => ctx.pendingReads.delete(task))
            ctx.pendingReads.add(task)
        }
    }

    /** structuredPatch（unified diff hunk 数组）行数累加进投影（容错：形状不符不计） */
    private applyStructuredPatch(filePath: string, patchSource: unknown): void {
        const counts = countStructuredPatch(patchSource)
        if (!counts) return
        const agg = this.ctx.projected.get(filePath) ?? { additions: 0, deletions: 0 }
        agg.additions += counts.additions
        agg.deletions += counts.deletions
        this.ctx.projected.set(filePath, agg)
    }

    /**
     * result 消息到达时调用：**同步冻结**本轮采集上下文（后续 observe 落在新轮，
     * 与封口互不干扰），封口入串行队列后台执行。resultNativeId 是本轮 result 消息的
     * uuid（落库 localId 同源）——卡片位置声明按它锚定归属 result 行。返回封口完成的
     * promise——launcher void 调用不等待（不阻塞 turn 完成），测试 await 保确定性；
     * 失败只记日志。
     */
    onTurnEnd(resultNativeId?: string): Promise<void> {
        const sealed = this.ctx
        this.ctx = createTurnContext()
        const task = this.sealQueue.then(() => this.sealTurn(sealed, resultNativeId))
        // 链上吞错（单轮封口失败不断后续轮）；返回值同样吞错（launcher void 调用无
        // rejection 处理方）
        this.sealQueue = task.then(() => undefined, () => undefined)
        return task.catch((e) => {
            logger.debug('[TurnDiffReporter] seal failed', e)
        })
    }

    /** 单轮封口：在途读盘收口 → 合成 → 卡片入流 → 归档封口（后台串行） */
    private async sealTurn(ctx: TurnContext, resultNativeId?: string): Promise<void> {
        // 在途读盘补全先收口（afterContent 就绪后再合成/封口，保证确定性）
        await Promise.all([...ctx.pendingReads])
        const files = (await this.composeFromTurnAccumulation(ctx)) ?? await this.composeFromProjection(ctx)
        if (files.files.length === 0) return
        // 卡片先发：wire 载荷纯内存可算，不等归档 IO——排队消息场景下保证卡片
        // 落库在下一轮用户消息之前（result → 卡片 → 下一轮 user）
        const payload = TurnDiffPayloadSchema.parse({
            turnIndex: files.turnIndex,
            baseTurnIndex: files.baseTurnIndex,
            stats: summarizeTurnDiffFiles(files.files),
            files: files.files,
            git: files.git,
        })
        this.sendEnvelope(payload, resultNativeId)
        // journal 口径：封口归档（历史轮回看的事实源），失败吞错（消费端走兜底）。
        // hydration：全文镜像落 a/b 目录（turnFulltextStore），patch 由目录模式单次
        // diff 合成，归档条目带 ref；无全文产出（旧构造/路径逃逸/落盘失败）走单文件兜底
        if (files.source === 'journal' && this.archive) {
            try {
                // 内容对取自冻结累积器快照；counts 复用 files.files 已算结果（同源同时刻
                // 同判定，不重跑 reviewEntryFromContents——判定单源 + 每文件省一遍全文 diff）
                const accumulated = ctx.accumulator.snapshot().files
                // hydration：全文落 a/b 目录 + 单次目录模式 diff 合成整轮 patch（失败的
                // 整体降级 = 全文件走单文件兜底，归档照常封口）
                let fulltext: Map<string, TurnFulltextSealed> | null = null
                if (this.fulltext) {
                    try {
                        fulltext = await this.fulltext.sealFiles(
                            files.turnIndex,
                            Object.entries(accumulated).map(([path, f]) => ({ path, beforeContent: f.beforeContent, afterContent: f.afterContent })),
                        )
                    } catch (e) {
                        logger.debug('[TurnDiffReporter] fulltext seal failed, fallback to per-file synth', e)
                    }
                }
                const sealedFiles = await Promise.all(files.files.map(async (e) => {
                    const f = accumulated[e.path]
                    if (!f) return []
                    // patch 优先取全文目录模式的整轮产出；无全文产出（旧构造 / 路径逃逸 /
                    // 落盘失败）单文件兜底合成（无 ref）
                    const viaFulltext = fulltext?.get(e.path)
                    const raw = viaFulltext?.patch ?? await synthesizeContentsPatch(git, e.path, f.beforeContent, f.afterContent)
                    const oversizedPatch = viaFulltext ? viaFulltext.oversized : textLineCount(raw) > OVERSIZE_DIFF_LINES
                    return [{
                        path: e.path,
                        kind: e.kind,
                        additions: e.additions,
                        deletions: e.deletions,
                        writeCount: f.writeCount,
                        toolNames: [...f.toolNames],
                        patch: oversizedPatch ? '' : raw,
                        oversizedPatch,
                        ...(viaFulltext?.ref ? { ref: viaFulltext.ref } : {}),
                    }]
                }))
                await this.archive.seal({
                    turnIndex: files.turnIndex,
                    baseTurnIndex: files.baseTurnIndex,
                    sealedAt: Date.now(),
                    files: sealedFiles.flat(),
                })
                // 全文存储治理在 seal 成功后（seal 失败时旧全文目录仍被归档 ref 引用，
                // 提前 prune 会悬空 ref）；滚动单条下 prune 删的是上一轮目录
                if (this.fulltext) await this.fulltext.prune()
            } catch (e) {
                logger.debug('[TurnDiffReporter] archive seal failed', e)
            }
        }
    }

    /** turn-diff 自定义事件入流（卡片时间线在 result 之后） */
    private sendEnvelope(payload: TurnDiffPayload, resultNativeId?: string): void {
        const envelope: CustomEventEnvelope = {
            mobiCustomEvent: true,
            role: 'custom',
            content: [{ type: 'custom-event', name: TURN_DIFF_EVENT, value: payload }],
            positionBeforeResultId: resultNativeId,
        }
        this.send(envelope as unknown as RawJSONLines)
    }

    /** 归因口径（主源）：turn 内 journal 累积 → 内容对行数（会话私有，免疫并发污染）。
     *  kind/counts 判定单源 contentsChangeOf（数字恒非 null，wire 的 nullable 仅是
     *  ReviewFileEntry 协议形状） */
    private async composeFromTurnAccumulation(ctx: TurnContext): Promise<ComposedFiles | null> {
        const accumulated = ctx.accumulator.snapshot().files
        const paths = Object.keys(accumulated)
        if (paths.length === 0) return null
        // 基线轮 = 归档最新档（本轮封口前读，封口后本轮即成最新）；turnIndex 接续 =
        // 归档最新轮 + 1（删内存自增的跨重启断档：重启后从归档事实接续）。封口串行
        // 队列保证读归档时上一轮已 seal 完毕，链路无竞态
        let baseTurnIndex: number | null = null
        if (this.archive) {
            try {
                baseTurnIndex = (await this.archive.loadLatest())?.turnIndex ?? null
            } catch (e) {
                logger.debug('[TurnDiffReporter] archive loadLatest failed', e)
            }
        }
        const files: TurnDiffFileEntry[] = paths
            .sort((a, b) => a.localeCompare(b))
            .map((path) => {
                const f = accumulated[path]!
                const change = contentsChangeOf(f.beforeContent, f.afterContent)
                return { path, ...change }
            })
        return {
            turnIndex: baseTurnIndex !== null ? baseTurnIndex + 1 : 1,
            baseTurnIndex,
            files,
            git: null,
            source: 'journal',
        }
    }

    /** 投影口径（降级档）：工具事件累加，Bash/subagent 写入不在内。turnIndex 与
     *  journal 口径共用同一序号空间——归档在则同样从归档接续（重启后投影轮不再与
     *  journal 轮撞号/断档），归档缺省才退内存计数 */
    private async composeFromProjection(ctx: TurnContext): Promise<ComposedFiles> {
        const files: TurnDiffFileEntry[] = [...ctx.projected.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([path, agg]) => ({
                path,
                kind: 'modify' as const,
                additions: agg.additions,
                deletions: agg.deletions,
            }))
        if (this.archive) {
            try {
                const latest = await this.archive.loadLatest()
                return { turnIndex: (latest?.turnIndex ?? 0) + 1, baseTurnIndex: latest?.turnIndex ?? null, files, git: null, source: 'projection' }
            } catch (e) {
                logger.debug('[TurnDiffReporter] archive loadLatest failed', e)
            }
        }
        return { turnIndex: ++this.turnCounter, baseTurnIndex: null, files, git: null, source: 'projection' }
    }
}

/** structuredPatch（unified diff hunk 数组）行数统计（纯函数；形状不符返回 null） */
function countStructuredPatch(patchSource: unknown): { additions: number; deletions: number } | null {
    const structuredPatch = (patchSource as { structuredPatch?: unknown } | undefined)?.structuredPatch
    if (!Array.isArray(structuredPatch)) return null
    let additions = 0
    let deletions = 0
    for (const hunk of structuredPatch as Array<{ lines?: unknown }>) {
        if (!Array.isArray(hunk?.lines)) continue
        for (const line of hunk.lines) {
            if (typeof line !== 'string') continue
            if (line.startsWith('+')) additions += 1
            else if (line.startsWith('-')) deletions += 1
        }
    }
    return { additions, deletions }
}
