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
 * 轮次变更合成器（ADR 0008 / 审查 v3 供数反转）：result 消息处理点后置任务——
 * 快照照打（会话资产）→ 合成 turn-diff 自定义事件消息入流（local / remote 两模式
 * 共用，模式同 GoalStatusHandler）。
 *
 * 口径（v3 供数双轨，唯一权威）：「归因」与「实况」分层——
 * - 归因层（主源）：turn 内 journal 累积（本会话 Edit 族工具的内容对）。会话私有，
 *   天然免疫并发会话/用户手改/shell 改动的归因污染（Codex TurnDiffTracker /
 *   ZCode per-turn 快照同款机制）；git: null（web 端 ≈ 近似标记）。合成后封口归档
 *   （turnArchiveStore，历史轮回看的精确性基础）。
 * - 实况层（兜底）：累积为空时回落相邻快照 diff（旧会话/journal 不可用）——
 *   「工作区两时点之差」，并发场景会互相归因，故只作兜底不作主源。
 * - 投影层（末位）：store 为 null（非 git）且无累积时降级，`git: null` 显式标记。
 *
 * 快照照打：journal 口径命中也照常 capture——快照链是会话资产（审查 generation、
 * 历史兜底、checkpoint 接缝），不随供数反转断链。
 *
 * 时序：result 是本轮最后一条消息，合成异步执行、完成后经注入的 send 通道入列
 * （remote 传 messageQueue.enqueue 保 FIFO；local 顺序流直发）。下一轮用户消息快于
 * 合成完成时可能反超——合成是毫秒级快路径，接受此窗口。
 *
 * journal 采集边界：只覆盖 Edit/Write/MultiEdit/NotebookEdit 的 toolUseResult 全文对
 * （afterContent 落笔即读盘补全）；Bash/subagent 写入不在内——漏但不错归因（ZCode
 * 同行为）。投影口径（末位降级档）同此边界。
 */

import { readFile } from 'node:fs/promises'
import type { RawJSONLines } from '@/claude/types'
import { TURN_DIFF_EVENT, getField, summarizeTurnDiffFiles, TurnDiffPayloadSchema, type TurnDiffFileEntry } from '@mobi/shared'
import type { TurnSnapshotStore } from '@/modules/common/git/turnSnapshotStore'
import type { PersistentToolChangeJournal } from '@/modules/common/git/toolChangeJournal'
import { reviewEntryFromContents } from '@/modules/common/git/reviewEntry'
import type { TurnArchiveStore } from '@/modules/common/git/turnArchiveStore'
import { logger } from '@/ui/logger'

/**
 * 会话启动基线快照（口径修正，dev 实证 2026-09-27）：链空时打一颗 baseline——
 * 否则首卡基线是 HEAD 树，会把目录里历史未提交改动全部算进首卡（demo 实证：
 * 只改 1 个文件出卡 52 个）。baseline 后首卡基线 = 会话起点；空仓库也照打（空树），
 * 顺带让空仓库首轮即走 git 口径。失败吞错：不阻塞会话启动。
 */
export async function ensureBaselineSnapshot(store: TurnSnapshotStore, sessionId: string): Promise<void> {
    try {
        const chain = await store.listChain(sessionId)
        if (chain.length === 0) await store.capture(sessionId)
    } catch (e) {
        logger.debug('[TurnDiffReporter] baseline capture failed, fallback to HEAD tree', e)
    }
}

/** 记变更的编辑族工具（工具名 → 是否取 input.file_path；名单即采集口径边界） */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** 合成事件信封（mobiCustomEvent 标记由 apiSession 咽喉点识别，custom role 原样落库） */
type CustomEventEnvelope = { mobiCustomEvent: true; role: 'custom'; content: unknown[] }

/** turn 内累积的单文件内容对（归档 record files 的同款形状）。
 *  采集入口即要求全文对至少一侧非空（两者都缺的 toolUseResult 跳过），行数恒由
 *  reviewEntryFromContents 计算（判定单源），无需 hunk 兜底字段 */
type TurnAccumulatedFile = {
    path: string
    beforeContent: string | null
    afterContent: string | null
    writeCount: number
    toolNames: string[]
}

/** 合成结果（带供数源标签：journal 源需封口归档） */
type ComposedFiles = {
    turnIndex: number
    baseTurnIndex: number | null
    files: TurnDiffFileEntry[]
    git: { baseTree: string; headTree: string } | null
    source: 'journal' | 'snapshot' | 'projection'
}

export class TurnDiffReporter {
    /** toolUseId → file_path + 工具名（assistant tool_use 观测，供 tool_result 的 patch 归位与 journal 归因） */
    private readonly toolFilePaths = new Map<string, { path: string; toolName: string }>()
    /** 投影口径：path → 行数累加（末位降级档的数据源） */
    private readonly projected = new Map<string, { additions: number; deletions: number }>()
    /** 归因口径：turn 内按 path 累积的内容对（主源；onTurnEnd 封口归档后清空） */
    private readonly turnFiles = new Map<string, TurnAccumulatedFile>()
    /** turn 纪元：清空 turnFiles 后作废在途的异步读盘补全（防泄漏进下一轮） */
    private turnEpoch = 0
    /** 在途异步读盘补全（onTurnEnd 合成前 await，保测试与封口的确定性） */
    private readonly pendingReads = new Set<Promise<void>>()
    /** journal 模式的轮次计数（快照模式用链序，不用它） */
    private turnCounter = 0

    constructor(
        private readonly sessionId: string,
        private readonly store: TurnSnapshotStore | null,
        private readonly send: (raw: RawJSONLines) => void,
        /** 工具层变更记录（会话累计事实源，审查消费）；缺省 = 不采集 */
        private readonly journal?: PersistentToolChangeJournal,
        /** turn 封口归档（审查 v3 历史轮回看的事实源）；缺省 = 不封口 */
        private readonly archive?: TurnArchiveStore,
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
                    this.toolFilePaths.set(block.id, { path: filePath, toolName: block.name })
                    if (!this.projected.has(filePath)) this.projected.set(filePath, { additions: 0, deletions: 0 })
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
            if (raw === undefined || raw === null) return
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
        try {
            this.journal?.record({ path, beforeContent, afterContent, toolName: observed.toolName })
        } catch (e) {
            logger.debug('[TurnDiffReporter] journal record failed', e)
        }
        // turn 内累积（归因主源，独立于 journal 是否启用）：before 取首次、after 取末次、writeCount 累加
        const existing = this.turnFiles.get(path)
        if (existing) {
            if (afterContent !== undefined) existing.afterContent = afterContent
            existing.writeCount += 1
            if (!existing.toolNames.includes(observed.toolName)) existing.toolNames.push(observed.toolName)
        } else {
            this.turnFiles.set(path, {
                path,
                beforeContent,
                afterContent: afterContent ?? null,
                writeCount: 1,
                toolNames: [observed.toolName],
            })
        }
        // afterContent 缺失（Edit 类只带 before）：异步读盘补全 journal 与 turn 累积
        if (afterContent === undefined) this.scheduleAfterRead(path, observed.toolName)
    }

    /** 异步读盘补 afterContent：fire-and-forget，turn 纪元守卫防泄漏进下一轮 */
    private scheduleAfterRead(path: string, toolName: string): void {
        const epoch = this.turnEpoch
        const task = readFile(path, 'utf8')
            .then((content) => {
                if (epoch !== this.turnEpoch) return
                // journal 只补 after 不计写入次数（写入计数归属本次 tool_result，已在同步路径 +1）
                try {
                    this.journal?.recordAfter(path, content, toolName)
                } catch (e) {
                    logger.debug('[TurnDiffReporter] journal recordAfter failed', e)
                }
                const tf = this.turnFiles.get(path)
                if (tf) tf.afterContent = content
            })
            .catch(() => undefined) // 读失败（文件已删/不可读）：保持占位 null
            .finally(() => this.pendingReads.delete(task))
        this.pendingReads.add(task)
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
            this.turnFiles.clear()
        }
    }

    private async composeAndSend(): Promise<void> {
        // 快照照打（会话资产，不随供数反转断链）：吞错，失败时兜底 diff 仍可从链尾取
        let headIndex: number | null = null
        if (this.store) {
            try {
                headIndex = (await this.store.capture(this.sessionId)).index
            } catch (e) {
                logger.debug('[TurnDiffReporter] turn capture failed', e)
            }
        }
        const files =
            (await this.composeFromTurnAccumulation()) ??
            (this.store ? await this.composeFromSnapshots(headIndex) : null) ??
            this.composeFromProjection()
        if (files.files.length === 0) return
        // journal 口径：封口归档（历史轮回看的事实源），失败吞错（消费端走兜底）
        if (files.source === 'journal' && this.archive) {
            try {
                await this.archive.seal({
                    turnIndex: files.turnIndex,
                    baseTurnIndex: files.baseTurnIndex,
                    sealedAt: Date.now(),
                    files: [...this.turnFiles.values()].map((f) => {
                        // kind/counts 判定单源（reviewEntryFromContents，审查 v3 收口）
                        const entry = reviewEntryFromContents(f.path, f.beforeContent, f.afterContent)
                        return {
                            path: f.path,
                            beforeContent: f.beforeContent,
                            afterContent: f.afterContent,
                            writeCount: f.writeCount,
                            toolNames: [...f.toolNames],
                            additions: entry.additions ?? 0,
                            deletions: entry.deletions ?? 0,
                        }
                    }),
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

    /** 归因口径（主源）：turn 内 journal 累积 → 内容对行数（会话私有，免疫并发污染） */
    private async composeFromTurnAccumulation(): Promise<ComposedFiles | null> {
        if (this.turnFiles.size === 0) return null
        // 基线轮 = 归档最新档（本轮封口前读，封口后本轮即成最新）
        let baseTurnIndex: number | null = null
        if (this.archive) {
            try {
                baseTurnIndex = (await this.archive.listTurns()).at(-1)?.turnIndex ?? null
            } catch (e) {
                logger.debug('[TurnDiffReporter] archive listTurns failed', e)
            }
        }
        const files: TurnDiffFileEntry[] = [...this.turnFiles.keys()]
            .sort((a, b) => a.localeCompare(b))
            .map((path) => {
                const f = this.turnFiles.get(path)!
                // kind/counts 判定单源（reviewEntryFromContents，审查 v3 收口）
                const entry = reviewEntryFromContents(path, f.beforeContent, f.afterContent)
                return { path, kind: entry.kind, additions: entry.additions ?? 0, deletions: entry.deletions ?? 0 }
            })
        return {
            turnIndex: ++this.turnCounter,
            baseTurnIndex,
            files,
            git: null,
            source: 'journal',
        }
    }

    /** 实况口径（兜底）：「上一轮 = 相邻快照之差」（capture 已在 composeAndSend 统一执行）。
     *  返回 null = 拿不到上一轮（链不足两颗：无 baseline / 空仓库无链），本轮走投影降级。
     *  HEAD 兜底已删（632048b2：不裹挟历史未提交变更） */
    private async composeFromSnapshots(headIndex: number | null): Promise<ComposedFiles | null> {
        const last = await this.store!.lastTurnDiff(this.sessionId)
        if (!last) return null

        return {
            turnIndex: headIndex ?? last.head.index,
            baseTurnIndex: last.base.index,
            files: last.files.map((e) => ({
                path: e.path,
                kind: e.kind,
                additions: e.additions,
                deletions: e.deletions,
                ...(e.previousPath !== undefined && { previousPath: e.previousPath }),
                ...(e.binary && { binary: true }),
            })),
            git: { baseTree: last.base.tree, headTree: last.head.tree },
            source: 'snapshot',
        }
    }

    /** 投影口径（末位降级档）：工具事件累加，Bash/subagent 写入不在内 */
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
