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
 *   ZCode per-turn 快照同款机制）；git: null（web 端 ≈ 近似标记）。合成后封口归档
 *   （turnArchiveStore，历史轮回看的精确性基础）。
 * - 投影层（降级档）：累积为空时用工具事件行数累加（Bash/subagent 写入不在内），
 *   `git: null` 显式标记。
 *
 * 时序：result 是本轮最后一条消息，合成异步执行、完成后经注入的 send 通道入列
 * （remote 传 messageQueue.enqueue 保 FIFO；local 顺序流直发）。下一轮用户消息快于
 * 合成完成时可能反超——合成是毫秒级快路径，接受此窗口。
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
import { OVERSIZE_DIFF_LINES, TURN_DIFF_EVENT, getField, summarizeTurnDiffFiles, TurnDiffPayloadSchema, type TurnDiffFileEntry } from '@mobi/shared'
import { git } from '@/modules/common/git/gitExec'
import { ToolChangeJournal } from '@/modules/common/git/toolChangeJournal'
import { contentsChangeOf } from '@/modules/common/git/reviewEntry'
import { synthesizeContentsPatch } from '@/modules/common/git/contentsPatch'
import type { TurnFulltextRef, TurnFulltextSealed } from '@/modules/common/git/turnFulltextStore'
import type { TurnArchiveStore } from '@/modules/common/git/turnArchiveStore'
import { logger } from '@/ui/logger'

/** 记变更的编辑族工具（工具名 → 是否取 input.file_path；名单即采集口径边界） */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** 合成事件信封（mobiCustomEvent 标记由 apiSession 咽喉点识别，custom role 原样落库） */
type CustomEventEnvelope = { mobiCustomEvent: true; role: 'custom'; content: unknown[] }

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

export class TurnDiffReporter {
    /** toolUseId → file_path + 工具名（assistant tool_use 观测，供 tool_result 的 patch 归位与 journal 归因） */
    private readonly toolFilePaths = new Map<string, { path: string; toolName: string }>()
    /** 投影口径：path → 行数累加（末位降级档的数据源） */
    private readonly projected = new Map<string, { additions: number; deletions: number }>()
    /** 归因口径：turn 内按 path 累积的内容对（主源；归并规则单源 ToolChangeJournal，
     *  onTurnEnd 封口归档后换新实例清空） */
    private turnAccumulator = new ToolChangeJournal()
    /** turn 纪元：清空 turnFiles 后作废在途的异步读盘补全（防泄漏进下一轮） */
    private turnEpoch = 0
    /** 在途异步读盘补全（onTurnEnd 合成前 await，保测试与封口的确定性） */
    private readonly pendingReads = new Set<Promise<void>>()
    /** 同 path 补读的串行链：并发读的 resolve 顺序不保证，乱序 recordAfter 会把中间态
     *  内容当末次写进 journal/累积（turn 封口与审查供数随之失真）——按调度序串行应用，
     *  后调度的读反映更新的磁盘状态，afterContent 单调前进 */
    private readonly readChains = new Map<string, Promise<void>>()
    /** sidechain 兜底的盘上预读（path → before 侧全文；读失败 = 新建语义 null）：
     *  sidechain tool_use 观测时落，对应 tool_result 无 toolUseResult 时消费。
     *  同 path 首次预读为准（journal before 取首次同构），onTurnEnd 清空 */
    private readonly preReads = new Map<string, Promise<string | null>>()
    /** 投影口径的轮次计数（journal 口径的 turnIndex 改从归档接续，不走它） */
    private turnCounter = 0

    constructor(
        private readonly send: (raw: RawJSONLines) => void,
        /** turn 封口归档（历史轮回看的事实源）；缺省 = 不封口 */
        private readonly archive?: TurnArchiveStore,
        /** 全文目录存储（hydration）：封口落 a/b 全文 + 目录模式合成 patch + 归档带
         *  ref；缺省 = 归档条目无 ref（patch 走单文件兜底合成，行为同 B 方案） */
        private readonly fulltext?: { sealFiles(turnIndex: number, files: ReadonlyArray<{ path: string; beforeContent: string | null; afterContent: string | null }>): Promise<Map<string, TurnFulltextSealed & { ref?: TurnFulltextRef }>> },
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
                    this.toolFilePaths.set(block.id, { path: filePath, toolName: block.name })
                    // sidechain 不进投影：其结果永不带 structuredPatch，只会产 0/0 噪声条目
                    if (!sidechain && !this.projected.has(filePath)) this.projected.set(filePath, { additions: 0, deletions: 0 })
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
                const observed = this.toolFilePaths.get(result.tool_use_id)
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
        this.turnAccumulator.record({ path, beforeContent, afterContent, toolName: observed.toolName })
        // afterContent 缺失（Edit 类只带 before）：异步读盘补全 turn 累积
        if (afterContent === undefined) this.scheduleAfterRead(path, observed.toolName)
    }

    /** 异步读盘补 afterContent：fire-and-forget，turn 纪元守卫防泄漏进下一轮；
     *  同 path 挂上串行链（见 readChains 注释）保证应用顺序 = 调度顺序 */
    private scheduleAfterRead(path: string, toolName: string): void {
        const epoch = this.turnEpoch
        const prior = this.readChains.get(path) ?? Promise.resolve()
        const task = prior
            .then(() => readFile(path, 'utf8'))
            .then((content) => {
                if (epoch !== this.turnEpoch) return
                this.turnAccumulator.recordAfter(path, content, toolName)
            })
            .catch(() => undefined) // 读失败（文件已删/不可读）：保持占位 null；链上吞错不断链
            .finally(() => this.pendingReads.delete(task))
        const chained = task.finally(() => {
            if (this.readChains.get(path) === chained) this.readChains.delete(path)
        })
        this.pendingReads.add(task)
        this.readChains.set(path, chained)
    }

    /** sidechain 兜底预读（before 侧唯一来源）：tool_use 观测到落笔前，磁盘即编辑前
     *  内容；同 path 首次为准（journal before 取首次同构）；读失败 = 新建语义 null */
    private schedulePreRead(path: string): void {
        if (this.preReads.has(path)) return
        this.preReads.set(path, readFile(path, 'utf8').catch(() => null))
    }

    /**
     * sidechain 兜底采集：tool_result 无 toolUseResult 时的内容对补全——before 取
     * tool_use 观测时的预读、after 读盘（落笔后的磁盘内容）。有预读的编辑族 result
     * 才兜底；is_error（失败的编辑盘上无变更）与 before/after 相同（零变更）不入账。
     * 挂 pendingReads（onTurnEnd 收口）+ turn 纪元守卫（防泄漏进下一轮）。
     */
    private captureUnattributedWrites(results: ReadonlyArray<{ type: 'tool_result'; tool_use_id: string }>): void {
        for (const result of results) {
            if ((result as { is_error?: unknown }).is_error === true) continue
            const observed = this.toolFilePaths.get(result.tool_use_id)
            if (!observed) continue
            const preRead = this.preReads.get(observed.path)
            if (!preRead) continue
            const epoch = this.turnEpoch
            const task = preRead
                .then((before) => readFile(observed.path, 'utf8').then((after) => ({ before, after })).catch(() => ({ before, after: null })))
                .then(({ before, after }) => {
                    if (epoch !== this.turnEpoch) return
                    if (after === null || after === before) return
                    this.turnAccumulator.record({ path: observed.path, beforeContent: before, toolName: observed.toolName })
                    this.turnAccumulator.recordAfter(observed.path, after, observed.toolName)
                })
                .catch(() => undefined)
                .finally(() => this.pendingReads.delete(task))
            this.pendingReads.add(task)
        }
    }

    /** structuredPatch（unified diff hunk 数组）行数累加进投影（容错：形状不符不计） */
    private applyStructuredPatch(filePath: string, patchSource: unknown): void {
        const counts = countStructuredPatch(patchSource)
        if (!counts) return
        const agg = this.projected.get(filePath) ?? { additions: 0, deletions: 0 }
        agg.additions += counts.additions
        agg.deletions += counts.deletions
        this.projected.set(filePath, agg)
    }

    /** result 消息到达时调用：合成并投递本轮变更消息；失败只记日志，不阻塞 turn 完成 */
    async onTurnEnd(): Promise<void> {
        try {
            // 在途读盘补全先收口（afterContent 就绪后再合成/封口，保证确定性）
            await Promise.all([...this.pendingReads])
            await this.composeAndSend()
        } catch (e) {
            logger.debug('[TurnDiffReporter] compose failed', e)
        } finally {
            this.turnEpoch += 1
            this.toolFilePaths.clear()
            this.projected.clear()
            this.preReads.clear()
            // 换新实例清空 turn 累积（turnEpoch 守卫已作废在途读盘，无泄漏窗口）
            this.turnAccumulator = new ToolChangeJournal()
        }
    }

    private async composeAndSend(): Promise<void> {
        const files = (await this.composeFromTurnAccumulation()) ?? this.composeFromProjection()
        if (files.files.length === 0) return
        // journal 口径：封口归档（历史轮回看的事实源），失败吞错（消费端走兜底）。
        // hydration：全文镜像落 a/b 目录（turnFulltextStore），patch 由目录模式单次
        // diff 合成，归档条目带 ref；无全文产出（旧构造/路径逃逸/落盘失败）走单文件兜底
        if (files.source === 'journal' && this.archive) {
            try {
                // 内容对取自本轮累积器快照；counts 复用 files.files 已算结果（同源同时刻
                // 同判定，不重跑 reviewEntryFromContents——判定单源 + 每文件省一遍全文 diff）
                const accumulated = this.turnAccumulator.snapshot().files
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
                    const viaFulltext = fulltext?.get(e.path)
                    if (viaFulltext) {
                        return [{
                            path: e.path,
                            kind: e.kind,
                            additions: e.additions,
                            deletions: e.deletions,
                            writeCount: f.writeCount,
                            toolNames: [...f.toolNames],
                            patch: viaFulltext.patch,
                            oversizedPatch: viaFulltext.oversized,
                            ref: viaFulltext.ref,
                        }]
                    }
                    // 无全文产出（旧构造 / 路径逃逸 / 落盘失败）：单文件兜底合成，无 ref
                    const raw = await synthesizeContentsPatch(git, e.path, f.beforeContent, f.afterContent)
                    const oversized = raw.split('\n').length > OVERSIZE_DIFF_LINES
                    return [{
                        path: e.path,
                        kind: e.kind,
                        additions: e.additions,
                        deletions: e.deletions,
                        writeCount: f.writeCount,
                        toolNames: [...f.toolNames],
                        patch: oversized ? '' : raw,
                        oversizedPatch: oversized,
                    }]
                }))
                await this.archive.seal({
                    turnIndex: files.turnIndex,
                    baseTurnIndex: files.baseTurnIndex,
                    sealedAt: Date.now(),
                    files: sealedFiles.flat(),
                })
            } catch (e) {
                logger.debug('[TurnDiffReporter] archive seal failed', e)
            }
        }

        const payload = TurnDiffPayloadSchema.parse({
            turnIndex: files.turnIndex,
            baseTurnIndex: files.baseTurnIndex,
            stats: summarizeTurnDiffFiles(files.files),
            files: files.files,
            git: files.git,
        })

        const envelope: CustomEventEnvelope = {
            mobiCustomEvent: true,
            role: 'custom',
            content: [{ type: 'custom-event', name: TURN_DIFF_EVENT, value: payload }],
        }
        this.send(envelope as unknown as RawJSONLines)
    }

    /** 归因口径（主源）：turn 内 journal 累积 → 内容对行数（会话私有，免疫并发污染）。
     *  kind/counts 判定单源 contentsChangeOf（数字恒非 null，wire 的 nullable 仅是
     *  ReviewFileEntry 协议形状） */
    private async composeFromTurnAccumulation(): Promise<ComposedFiles | null> {
        const accumulated = this.turnAccumulator.snapshot().files
        const paths = Object.keys(accumulated)
        if (paths.length === 0) return null
        // 基线轮 = 归档最新档（本轮封口前读，封口后本轮即成最新）；turnIndex 接续 =
        // 归档最新轮 + 1（删内存自增的跨重启断档：重启后从归档事实接续）
        let baseTurnIndex: number | null = null
        if (this.archive) {
            try {
                baseTurnIndex = (await this.archive.listTurns()).at(-1)?.turnIndex ?? null
            } catch (e) {
                logger.debug('[TurnDiffReporter] archive listTurns failed', e)
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

    /** 投影口径（降级档）：工具事件累加，Bash/subagent 写入不在内 */
    private composeFromProjection(): ComposedFiles {
        const files: TurnDiffFileEntry[] = [...this.projected.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([path, agg]) => ({
                path,
                kind: 'modify' as const,
                additions: agg.additions,
                deletions: agg.deletions,
            }))
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
