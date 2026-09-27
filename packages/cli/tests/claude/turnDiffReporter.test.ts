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
 * TurnDiffReporter 合成契约：观测序列 → 载荷断言。git 口径用内存 fake store
 * （seam 契约见 turnSnapshotStore.test.ts），投影口径直接喂 RawJSONLines 消息序列。
 */

import { describe, it, expect, vi } from 'vitest'
import type { RawJSONLines } from '@/claude/types'
import { TURN_DIFF_EVENT, TurnDiffPayloadSchema, type TurnDiffPayload } from '@mobi/shared'
import { TurnDiffReporter } from '@/claude/turnDiffReporter'
import { createInMemoryTurnSnapshotStore } from '@/modules/common/git/turnSnapshotStore'

const SID = 's-1'

/** 构造 assistant tool_use 消息（RawJSONLines 形态，观测所需的最小字段） */
function assistantToolUse(toolUseId: string, name: string, filePath: string): RawJSONLines {
    return {
        type: 'assistant',
        message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: toolUseId, name, input: { file_path: filePath } }],
        },
    } as unknown as RawJSONLines
}

/** 构造 user tool_result 消息（带 structuredPatch 行数） */
function userToolResult(toolUseId: string, patchLines: string[]): RawJSONLines {
    return {
        type: 'user',
        message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: toolUseId }],
        },
        toolUseResult: { structuredPatch: [{ lines: patchLines }] },
    } as unknown as RawJSONLines
}

function sentPayloads(send: ReturnType<typeof vi.fn>): TurnDiffPayload[] {
    return send.mock.calls.map(([raw]) => {
        const envelope = raw as unknown as { mobiCustomEvent: boolean; role: string; content: Array<{ type: string; name: string; value: TurnDiffPayload }> }
        expect(envelope.mobiCustomEvent).toBe(true)
        expect(envelope.role).toBe('custom')
        const block = envelope.content[0]!
        expect(block.type).toBe('custom-event')
        expect(block.name).toBe(TURN_DIFF_EVENT)
        // 协议边界保险丝的实证：入流载荷必过 schema
        expect(() => TurnDiffPayloadSchema.parse(block.value)).not.toThrow()
        return block.value
    })
}

describe('TurnDiffReporter（git 快照口径）', () => {
    it('观测 Edit 观测不产出消息；result 时以相邻快照 diff 合成', async () => {
        const store = createInMemoryTurnSnapshotStore({
            trees: {
                'fake-head-tree': { 'a.ts': ['const a = 1'] },
                'fake-tree-1': { 'a.ts': ['const a = 1', 'const b = 2'], 'new.ts': ['x'] },
            },
        })
        const send = vi.fn()
        const reporter = new TurnDiffReporter(SID, store, send)

        reporter.observe(assistantToolUse('t1', 'Edit', '/repo/a.ts'))
        await reporter.onTurnEnd()

        const [payload] = sentPayloads(send)
        expect(payload!.turnIndex).toBe(1)
        expect(payload!.baseTurnIndex).toBeNull() // 链空，基线 = HEAD 树
        expect(payload!.git).toEqual({ baseTree: 'fake-head-tree', headTree: 'fake-tree-1' })
        expect(payload!.stats).toEqual({ files: 2, additions: 2, deletions: 0 })
        expect(payload!.files.map((f) => f.path)).toEqual(['a.ts', 'new.ts'])
        // 快照已入链
        expect(await store.listChain(SID)).toHaveLength(1)
    })

    it('第二轮：基线 = 上一快照，baseTurnIndex 接续', async () => {
        const store = createInMemoryTurnSnapshotStore({
            chains: { [SID]: [{ index: 4, tree: 't4' }] },
            trees: {
                t4: { 'a.ts': ['one'] },
                // fake 的 capture 树名按链长生成：链长 1 → fake-tree-2
                'fake-tree-2': { 'a.ts': ['one', 'two'] },
            },
        })
        const send = vi.fn()
        const reporter = new TurnDiffReporter(SID, store, send)
        await reporter.onTurnEnd()

        const [payload] = sentPayloads(send)
        expect(payload!.turnIndex).toBe(5)
        expect(payload!.baseTurnIndex).toBe(4)
        expect(payload!.git).toEqual({ baseTree: 't4', headTree: 'fake-tree-2' })
    })

    it('本轮无文件变化：不出卡（不合成空消息）', async () => {
        const store = createInMemoryTurnSnapshotStore()
        const send = vi.fn()
        const reporter = new TurnDiffReporter(SID, store, send)
        await reporter.onTurnEnd()
        expect(send).not.toHaveBeenCalled()
    })

    it('store 合成失败：吞错不抛出（turn 完成不受阻），turn 状态照常重置', async () => {
        const store = createInMemoryTurnSnapshotStore()
        const broken = {
            capture: store.capture.bind(store),
            listChain: async () => { throw new Error('git exploded') },
            headTree: store.headTree.bind(store),
            diffTrees: store.diffTrees.bind(store),
            clearSession: store.clearSession.bind(store),
        }
        const send = vi.fn()
        const reporter = new TurnDiffReporter(SID, broken, send)
        await expect(reporter.onTurnEnd()).resolves.toBeUndefined()
        expect(send).not.toHaveBeenCalled()
    })

    it('空仓库首轮（链空且无 HEAD 树）：降级投影口径，快照照打', async () => {
        const store = createInMemoryTurnSnapshotStore({ headTree: null })
        const send = vi.fn()
        const reporter = new TurnDiffReporter(SID, store, send)
        reporter.observe(assistantToolUse('t1', 'Write', '/repo/fresh.ts'))
        await reporter.onTurnEnd()

        expect(await store.listChain(SID)).toHaveLength(1) // 基线快照已打
        const [payload] = sentPayloads(send)
        expect(payload!.git).toBeNull()
        expect(payload!.files).toEqual([{ path: '/repo/fresh.ts', kind: 'modify', additions: 0, deletions: 0 }])
    })
})

describe('TurnDiffReporter（非 git 投影降级口径）', () => {
    it('store 为 null：structuredPatch 行数累加，同文件合并，git: null', async () => {
        const send = vi.fn()
        const reporter = new TurnDiffReporter(SID, null, send)
        reporter.observe(assistantToolUse('t1', 'Edit', '/proj/a.ts'))
        reporter.observe(userToolResult('t1', [' ctx', '+added', '-removed']))
        reporter.observe(assistantToolUse('t2', 'Edit', '/proj/a.ts')) // 同文件第二笔
        reporter.observe(userToolResult('t2', ['+more']))
        reporter.observe(assistantToolUse('t3', 'Bash', '/proj/na')) // 非编辑族：不观测
        await reporter.onTurnEnd()

        const [payload] = sentPayloads(send)
        expect(payload!.git).toBeNull()
        expect(payload!.turnIndex).toBe(1)
        expect(payload!.baseTurnIndex).toBeNull()
        expect(payload!.files).toEqual([{ path: '/proj/a.ts', kind: 'modify', additions: 2, deletions: 1 }])
        expect(payload!.stats).toEqual({ files: 1, additions: 2, deletions: 1 })
    })

    it('本轮无编辑观测：不出卡；下一轮计数接续', async () => {
        const send = vi.fn()
        const reporter = new TurnDiffReporter(SID, null, send)
        await reporter.onTurnEnd()
        expect(send).not.toHaveBeenCalled()

        reporter.observe(assistantToolUse('t1', 'MultiEdit', '/b.ts'))
        await reporter.onTurnEnd()
        const [payload] = sentPayloads(send)
        expect(payload!.turnIndex).toBe(2) // 计数只在合成时递增
    })
})
