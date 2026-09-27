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
import { TURN_DIFF_EVENT, summarizeTurnDiffFiles, TurnDiffPayloadSchema, type TurnDiffFileEntry } from '@mobi/shared'
import type { TurnSnapshotStore } from '@/modules/common/git/turnSnapshotStore'
import { logger } from '@/ui/logger'

/** 记变更的编辑族工具（工具名 → 是否取 input.file_path；名单即投影口径边界） */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

/** 合成事件信封（mobiCustomEvent 标记由 apiSession 咽喉点识别，custom role 原样落库） */
type CustomEventEnvelope = { mobiCustomEvent: true; role: 'custom'; content: unknown[] }

export class TurnDiffReporter {
    /** toolUseId → file_path（assistant tool_use 观测，供 tool_result 的 patch 归位） */
    private readonly toolFilePaths = new Map<string, string>()
    /** 投影口径：path → 行数累加（降级档的数据源） */
    private readonly projected = new Map<string, { additions: number; deletions: number }>()
    /** 非 git 模式的轮次计数（git 模式用快照链序，不用它） */
    private turnCounter = 0

    constructor(
        private readonly sessionId: string,
        private readonly store: TurnSnapshotStore | null,
        private readonly send: (raw: RawJSONLines) => void,
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
                    this.toolFilePaths.set(block.id, filePath)
                    if (!this.projected.has(filePath)) this.projected.set(filePath, { additions: 0, deletions: 0 })
                }
            }
            return
        }

        if (message.type === 'user') {
            // toolUseResult.structuredPatch：Edit/MultiEdit/Write 的原生 unified diff hunk
            const toolUseId = (msg.content as Array<{ type?: string; tool_use_id?: string }>)
                .find((c) => c?.type === 'tool_result')?.tool_use_id
            const filePath = toolUseId ? this.toolFilePaths.get(toolUseId) : undefined
            if (!filePath) return
            const structuredPatch = (message as { toolUseResult?: { structuredPatch?: unknown } }).toolUseResult
                ?.structuredPatch
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

    /** 快照口径：capture → 与链尾（或 HEAD 树）diff；返回 null = 无基线本轮降级 */
    private async composeFromSnapshots(): Promise<{
        turnIndex: number
        baseTurnIndex: number | null
        files: TurnDiffFileEntry[]
        git: { baseTree: string; headTree: string } | null
    } | null> {
        const store = this.store!
        const chain = await store.listChain(this.sessionId)
        const previous = chain.at(-1) ?? null
        const head = await store.capture(this.sessionId)
        const baseTree = previous?.tree ?? await store.headTree()

        // 无基线（链空且空仓库）：快照照打（后续轮次的基线），本轮走投影降级
        if (!baseTree) return null
        const entries = await store.diffTrees(baseTree, head.tree)

        return {
            turnIndex: head.index,
            baseTurnIndex: previous?.index ?? null,
            files: entries.map((e) => ({
                path: e.path,
                kind: e.kind,
                additions: e.additions,
                deletions: e.deletions,
                ...(e.previousPath !== undefined && { previousPath: e.previousPath }),
                ...(e.binary && { binary: true }),
            })),
            git: { baseTree, headTree: head.tree },
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
