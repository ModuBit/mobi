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
 * 轮次变更合成器（ADR 0008 / spec .scratch/turn-diff）：result 消息处理点后置任务——
 * 打轮次快照 → 相邻快照 diff → 合成 turn-diff 自定义事件消息入流（local / remote
 * 两模式共用，模式同 GoalStatusHandler）。
 *
 * 口径（唯一权威）：git 模式文件清单与统计 = 相邻两快照 diff，天然覆盖 Bash 写文件、
 * subagent 编辑（工具事件投影的盲区）与同文件多次编辑合并；store 为 null（非 git 目录）
 * 或无基线（空仓库首轮）时降级为工具事件投影近似，`git: null` 显式标记。
 *
 * 时序：result 是本轮最后一条消息，合成异步执行、完成后经注入的 send 通道入列
 * （remote 传 messageQueue.enqueue 保 FIFO；local 顺序流直发）。下一轮用户消息快于
 * 合成完成时可能反超——合成是毫秒级快路径，接受此窗口。
 *
 * 投影口径（降级档）只覆盖 Edit/Write/MultiEdit/NotebookEdit：从 tool_use 的 file_path
 * 与 tool_result 的 structuredPatch 行数累加，同文件多工具自然合并；Bash/subagent 的
 * 写入不在内——这是降级档的已知边界（快照口径没有）。
 */

import type { RawJSONLines } from '@/claude/types'
import { TURN_DIFF_EVENT, getField, summarizeTurnDiffFiles, TurnDiffPayloadSchema, type TurnDiffFileEntry } from '@mobi/shared'
import type { TurnSnapshotStore } from '@/modules/common/git/turnSnapshotStore'
import type { PersistentToolChangeJournal } from '@/modules/common/git/toolChangeJournal'
import { logger } from '@/ui/logger'

/**
 * 会话启动基线快照（口径修正，dev 实证 2026-09-27）：链空时打一颗 baseline——
 * 否则首卡基线是 HEAD 树，会把目录里历史未提交改动全部算进首卡（demo 实证：
 * 只改 1 个文件出卡 52 个）。baseline 后首卡基线 = 会话起点，「上一轮」语义
 * 收窄为「本会话造成的变更」；空仓库也照打（空树），顺带让空仓库首轮即走 git 口径。
 * 失败吞错：回退旧的 HEAD 树语义，不阻塞会话启动。
 */
export async function ensureBaselineSnapshot(store: TurnSnapshotStore, sessionId: string): Promise<void> {
    try {
        const chain = await store.listChain(sessionId)
        if (chain.length === 0) await store.capture(sessionId)
    } catch (e) {
        logger.debug('[TurnDiffReporter] baseline capture failed, fallback to HEAD tree', e)
    }
}

/** 记变更的编辑族工具（工具名 → 是否取 input.file_path；名单即投影口径边界） */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** 合成事件信封（mobiCustomEvent 标记由 apiSession 咽喉点识别，custom role 原样落库） */
type CustomEventEnvelope = { mobiCustomEvent: true; role: 'custom'; content: unknown[] }

export class TurnDiffReporter {
    /** toolUseId → file_path + 工具名（assistant tool_use 观测，供 tool_result 的 patch 归位与 journal 归因） */
    private readonly toolFilePaths = new Map<string, { path: string; toolName: string }>()
    /** 投影口径：path → 行数累加（降级档的数据源） */
    private readonly projected = new Map<string, { additions: number; deletions: number }>()
    /** 非 git 模式的轮次计数（git 模式用快照链序，不用它） */
    private turnCounter = 0

    constructor(
        private readonly sessionId: string,
        private readonly store: TurnSnapshotStore | null,
        private readonly send: (raw: RawJSONLines) => void,
        /** 工具层变更记录（spec 2.1 兜底源，票 04 消费）；缺省 = 不采集 */
        private readonly journal?: PersistentToolChangeJournal,
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
                // 全文对采集（兜底源）：与行数投影同一遍历，形状不符静默跳过
                this.recordJournalChange(observed, patchSource)
            }
        }
    }

    /**
     * toolUseResult 的全文对采集（spec 2.1 兜底源）：Edit/MultiEdit 类结果带
     * originalFile（编辑前全文）、Write 类带 content（写入后全文）；两者都缺
     * （Bash 等非编辑族结果）跳过。path 优先取结果自带的 filePath，缺省回退
     * tool_use 的 file_path。缺 content 只记 before 占位（journal 归并规则自理）
     */
    private recordJournalChange(observed: { path: string; toolName: string }, patchSource: unknown): void {
        if (!this.journal) return
        const src = patchSource as { filePath?: unknown; originalFile?: unknown; content?: unknown } | undefined
        if (!src || typeof src !== 'object') return
        const path = typeof src.filePath === 'string' && src.filePath.length > 0 ? src.filePath : observed.path
        const beforeContent = typeof src.originalFile === 'string' ? src.originalFile : null
        const afterContent = typeof src.content === 'string' ? src.content : undefined
        if (beforeContent === null && afterContent === undefined) return
        try {
            this.journal.record({ path, beforeContent, afterContent, toolName: observed.toolName })
        } catch (e) {
            logger.debug('[TurnDiffReporter] journal record failed', e)
        }
    }

    /** structuredPatch（unified diff hunk 数组）行数累加进投影（容错：形状不符不计） */
    private applyStructuredPatch(filePath: string, patchSource: unknown): void {
        const structuredPatch = (patchSource as { structuredPatch?: unknown } | undefined)?.structuredPatch
        if (!Array.isArray(structuredPatch)) return
        const agg = this.projected.get(filePath) ?? { additions: 0, deletions: 0 }
        for (const hunk of structuredPatch as Array<{ lines?: unknown }>) {
            if (!Array.isArray(hunk?.lines)) continue
            for (const line of hunk.lines) {
                if (typeof line !== 'string') continue
                if (line.startsWith('+')) agg.additions += 1
                else if (line.startsWith('-')) agg.deletions += 1
            }
        }
        this.projected.set(filePath, agg)
    }

    /** result 消息到达时调用：合成并投递本轮变更消息；失败只记日志，不阻塞 turn 完成 */
    async onTurnEnd(): Promise<void> {
        try {
            await this.composeAndSend()
        } catch (e) {
            logger.debug('[TurnDiffReporter] compose failed', e)
        } finally {
            this.toolFilePaths.clear()
            this.projected.clear()
        }
    }

    private async composeAndSend(): Promise<void> {
        // git 口径无基线（链空且空仓库）时回落投影口径（composeFromSnapshots 返回 null 表达）
        const files = (this.store ? await this.composeFromSnapshots() : null) ?? this.composeFromProjection()
        if (files.files.length === 0) return

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

    /** 快照口径：capture 后取「上一轮 = 相邻快照之差」（口径单源在 store）。返回 null =
     *  拿不到上一轮（链不足两颗：无 baseline / 空仓库无链），本轮走投影降级——快照已
     *  入链，后续轮次链自建。HEAD 兜底已删（632048b2：不裹挟历史未提交变更） */
    private async composeFromSnapshots(): Promise<{
        turnIndex: number
        baseTurnIndex: number | null
        files: TurnDiffFileEntry[]
        git: { baseTree: string; headTree: string } | null
    } | null> {
        const store = this.store!
        const head = await store.capture(this.sessionId)
        const last = await store.lastTurnDiff(this.sessionId)
        if (!last) return null

        return {
            turnIndex: head.index,
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
        }
    }

    /** 投影口径（降级档）：工具事件累加，Bash/subagent 写入不在内 */
    private composeFromProjection(): {
        turnIndex: number
        baseTurnIndex: number | null
        files: TurnDiffFileEntry[]
        git: null
    } {
        const files: TurnDiffFileEntry[] = [...this.projected.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([path, agg]) => ({
                path,
                kind: 'modify' as const,
                additions: agg.additions,
                deletions: agg.deletions,
            }))
        return { turnIndex: ++this.turnCounter, baseTurnIndex: null, files, git: null }
    }
}
