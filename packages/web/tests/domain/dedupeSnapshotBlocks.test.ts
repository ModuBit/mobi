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

import { describe, it, expect } from 'vitest'
import { dedupeSnapshotBlocks } from '@/domain/chat/reducer'
import type { NormalizedMessage, NormalizedAgentContent } from '@/domain/chat/types'

/** 构造 agent NormalizedMessage（snapshot 或 full），content 为 reasoning/text block */
function makeAgentMsg(
    id: string,
    messageId: string | undefined,
    snapshot: boolean,
    blocks: { type: 'reasoning' | 'text'; text: string }[],
): NormalizedMessage {
    return {
        id,
        localId: id,
        createdAt: 1,
        isSidechain: false,
        role: 'agent',
        content: blocks.map((b, i) => ({
            type: b.type,
            text: b.text,
            uuid: `${id}:${i}`,
            parentUUID: null,
        })) as NormalizedAgentContent[],
        snapshot,
        messageId,
    } as NormalizedMessage
}

describe('dedupeSnapshotBlocks（双保险第二道：按 (messageId, type) 去重）', () => {
    it('snapshot 的 block 被同 (messageId, type) 的 full 覆盖则移除，未覆盖的保留', () => {
        // thinking-full 到达，text-full 未到：snapshot 的 reasoning 移除，text 保留（流式中）
        const snap = makeAgentMsg('snap-1', 'msgX', true, [
            { type: 'reasoning', text: '思考' },
            { type: 'text', text: '回复' },
        ])
        const thinkingFull = makeAgentMsg('full-t', 'msgX', false, [{ type: 'reasoning', text: '思考' }])

        const result = dedupeSnapshotBlocks([snap, thinkingFull])
        const snapResult = result.find(m => m.id === 'snap-1')!
        expect(snapResult.content).toEqual([
            expect.objectContaining({ type: 'text', text: '回复' }),
        ])
    })

    it('snapshot 全被 full 覆盖则整条移除', () => {
        const snap = makeAgentMsg('snap-1', 'msgX', true, [
            { type: 'reasoning', text: '思考' },
            { type: 'text', text: '回复' },
        ])
        const thinkingFull = makeAgentMsg('full-t', 'msgX', false, [{ type: 'reasoning', text: '思考' }])
        const textFull = makeAgentMsg('full-x', 'msgX', false, [{ type: 'text', text: '回复' }])

        const result = dedupeSnapshotBlocks([snap, thinkingFull, textFull])
        expect(result.find(m => m.id === 'snap-1')).toBeUndefined()
    })

    it('无 full 时 snapshot 原样保留（引用不变）', () => {
        const snap = makeAgentMsg('snap-1', 'msgX', true, [{ type: 'reasoning', text: '思考' }])
        const input = [snap]
        const result = dedupeSnapshotBlocks(input)
        expect(result).toBe(input)  // 同引用，未改
    })

    it('不同 messageId 的 full 不覆盖别的 snapshot', () => {
        const snap = makeAgentMsg('snap-1', 'msgX', true, [{ type: 'reasoning', text: '思考X' }])
        const full = makeAgentMsg('full-1', 'msgY', false, [{ type: 'reasoning', text: '思考Y' }])

        const result = dedupeSnapshotBlocks([snap, full])
        expect(result.find(m => m.id === 'snap-1')!.content).toHaveLength(1)
    })

    it('兜底 parentUuid 边界：snapshot 和 full 共享 messageId 即去重（即使 parentUuid 漂移）', () => {
        // 第一道 parentUuid 清理在此场景会漏（parentUuid 漂移：snapshot 走主链 lastUuid、
        // full 走各自 parent_tool_use_id 路径），第二道按 messageId 兜底，snapshot 不残留
        const snap = makeAgentMsg('snap-1', 'msgX', true, [{ type: 'reasoning', text: '思考' }])
        const full = makeAgentMsg('full-1', 'msgX', false, [{ type: 'reasoning', text: '思考' }])

        const result = dedupeSnapshotBlocks([snap, full])
        expect(result.find(m => m.id === 'snap-1')).toBeUndefined()
    })

    it('snapshot 无 messageId 时不参与去重（兼容旧 CLI snapshot）', () => {
        const snap = makeAgentMsg('snap-1', undefined, true, [{ type: 'reasoning', text: '思考' }])
        const full = makeAgentMsg('full-1', 'msgX', false, [{ type: 'reasoning', text: '思考' }])

        const result = dedupeSnapshotBlocks([snap, full])
        expect(result.find(m => m.id === 'snap-1')!.content).toHaveLength(1)
    })

    it('tool-call 按 (messageId, id) 精确去重：并行多 tool_use，full 只到一条时不误删其余', () => {
        // 同一 message 含两个并行 tool-call（不同 tool_use_id）。full 暂只覆盖第一条时，
        // snapshot 的第二条不应被按 type 一起误删（这是修复并行工具 running 中间态丢失的关键）
        const snap = {
            id: 'snap-1', localId: 'snap-1', createdAt: 1, isSidechain: false,
            role: 'agent' as const,
            content: [
                { type: 'tool-call' as const, id: 'toolu_A', name: 'Bash', input: { command: 'ls' }, description: null, uuid: 'u-a', parentUUID: null },
                { type: 'tool-call' as const, id: 'toolu_B', name: 'Read', input: { path: 'x' }, description: null, uuid: 'u-b', parentUUID: null },
            ],
            snapshot: true, messageId: 'msgX',
        } as unknown as NormalizedMessage
        const fullA = {
            id: 'full-a', localId: 'full-a', createdAt: 1, isSidechain: false,
            role: 'agent' as const,
            content: [
                { type: 'tool-call' as const, id: 'toolu_A', name: 'Bash', input: { command: 'ls' }, description: null, uuid: 'u-a', parentUUID: null },
            ],
            snapshot: false, messageId: 'msgX',
        } as unknown as NormalizedMessage

        const result = dedupeSnapshotBlocks([snap, fullA])
        const snapResult = result.find(m => m.id === 'snap-1')!
        // toolu_A 被 full 覆盖移除；toolu_B 保留（未误删）
        expect(snapResult.content).toEqual([
            expect.objectContaining({ type: 'tool-call', id: 'toolu_B' }),
        ])
    })
})
