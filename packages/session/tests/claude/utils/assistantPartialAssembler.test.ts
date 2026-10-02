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

import { describe, test, expect } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { AssistantPartialAssembler } from '@/claude/utils/assistantPartialAssembler'

function asst(id: string, blocks: unknown[]): SDKMessage {
    return {
        type: 'assistant',
        uuid: `u-${id}`,
        parent_tool_use_id: undefined,
        message: { id, type: 'message', role: 'assistant', content: blocks },
    } as unknown as SDKMessage
}

function blocksOf(msg: SDKMessage): unknown[] {
    return (msg as { message?: { content?: unknown[] } }).message?.content ?? []
}

describe('AssistantPartialAssembler', () => {
    test('同 message.id 的 thinking + tool_use 装配成一条完整消息', () => {
        const out: SDKMessage[] = []
        const a = new AssistantPartialAssembler(m => out.push(m))
        a.submit(asst('m1', [{ type: 'thinking', thinking: 't', signature: 's' }]))
        a.submit(asst('m1', [{ type: 'tool_use', id: 'tu1', name: 'x', input: {} }]))
        expect(out).toEqual([]) // 仍在装配
        a.submit({ type: 'result', subtype: 'success' } as unknown as SDKMessage)
        expect(out).toHaveLength(2) // 装配的 assistant + result
        expect(out[0]!.type).toBe('assistant')
        expect(blocksOf(out[0]!)).toEqual([
            { type: 'thinking', thinking: 't', signature: 's' },
            { type: 'tool_use', id: 'tu1', name: 'x', input: {} },
        ])
    })

    test('不同 message.id 各自独立装配，flushAll 按插入序输出', () => {
        const out: SDKMessage[] = []
        const a = new AssistantPartialAssembler(m => out.push(m))
        a.submit(asst('m1', [{ type: 'thinking', thinking: 'a' }]))
        a.submit(asst('m2', [{ type: 'text', text: 'b' }])) // 不同 id：Map 各自累积（不提前 flush）
        a.flushAll()
        expect(out).toHaveLength(2)
        expect(blocksOf(out[0]!)[0]).toMatchObject({ thinking: 'a' })
        expect(blocksOf(out[1]!)[0]).toMatchObject({ text: 'b' })
    })

    test('交错 emit 不同 message 的 partial 也能各自完整累积（消除连续 emit 假设）', () => {
        // Map 版本的核心价值：单槽会在 m2 到达时提前 flush m1（仅 b1，缺 b2）→ 不完整。
        // Map 各自累积，flushAll 时 m1 完整（b1+b2）。
        const out: SDKMessage[] = []
        const a = new AssistantPartialAssembler(m => out.push(m))
        a.submit(asst('m1', [{ type: 'thinking', thinking: 'm1a' }]))
        a.submit(asst('m2', [{ type: 'text', text: 'm2a' }]))
        a.submit(asst('m1', [{ type: 'text', text: 'm1b' }])) // m1 的第二个 partial，交错到达
        a.flushAll()
        expect(out).toHaveLength(2)
        // 按插入序（m1 先 message_start）：m1 完整两个 block，m2 一个 block
        expect(blocksOf(out[0]!)).toEqual([
            { type: 'thinking', thinking: 'm1a' },
            { type: 'text', text: 'm1b' },
        ])
        expect(blocksOf(out[1]!)).toEqual([{ type: 'text', text: 'm2a' }])
    })

    test('非 assistant 消息立即透传，并先 flushAll 待装配的 assistant', () => {
        const out: SDKMessage[] = []
        const a = new AssistantPartialAssembler(m => out.push(m))
        a.submit(asst('m1', [{ type: 'thinking', thinking: 'x' }]))
        const system = { type: 'system', subtype: 'init' } as unknown as SDKMessage
        a.submit(system)
        expect(out).toHaveLength(2) // 装配 assistant 在前，system 在后
        expect(out[0]!.type).toBe('assistant')
        expect(out[1]!).toBe(system)
    })

    test('同 message 多个同类型 block（如多 text）全部保留，不丢不并', () => {
        const out: SDKMessage[] = []
        const a = new AssistantPartialAssembler(m => out.push(m))
        a.submit(asst('m1', [{ type: 'text', text: 'a' }]))
        a.submit(asst('m1', [{ type: 'text', text: 'b' }]))
        a.flushAll()
        expect(blocksOf(out[0]!)).toEqual([
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
        ])
    })

    test('单条完整 assistant（未拆分）也能正常输出', () => {
        const out: SDKMessage[] = []
        const a = new AssistantPartialAssembler(m => out.push(m))
        a.submit(asst('m1', [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'hi' }]))
        a.flushAll()
        expect(out).toHaveLength(1)
        expect(blocksOf(out[0]!)).toHaveLength(2)
    })

    test('不 mutate SDK 传入的消息对象', () => {
        const out: SDKMessage[] = []
        const a = new AssistantPartialAssembler(m => out.push(m))
        const first = asst('m1', [{ type: 'thinking', thinking: 't' }])
        a.submit(first)
        a.submit(asst('m1', [{ type: 'text', text: 'y' }]))
        a.flushAll()
        // 原首条消息的 content 不应被污染
        expect(blocksOf(first)).toEqual([{ type: 'thinking', thinking: 't' }])
    })

    test('无 message.id 的 assistant 直接透传（无法判定归属）', () => {
        const out: SDKMessage[] = []
        const a = new AssistantPartialAssembler(m => out.push(m))
        const noId = { type: 'assistant', uuid: 'u-x', message: { content: [{ type: 'text', text: 'z' }] } } as unknown as SDKMessage
        a.submit(noId)
        expect(out).toHaveLength(1)
        expect(out[0]).toBe(noId)
    })

    test('flushAll 后 pending 清空（幂等，重复调用无输出）', () => {
        const out: SDKMessage[] = []
        const a = new AssistantPartialAssembler(m => out.push(m))
        a.submit(asst('m1', [{ type: 'text', text: 'a' }]))
        a.flushAll()
        expect(out).toHaveLength(1)
        a.flushAll() // 重复调用
        expect(out).toHaveLength(1) // 无新增
    })

    // SDK 契约：partial(stream_event) 只对主 session（parent_tool_use_id 恒 null）；
    // 子 agent 的消息是 complete message（parent_tool_use_id 非空），本就完整，无需聚合。
    // 累积它会延迟到下一条非 assistant 才 flush → 子 agent 工具调用延迟/丢失，前端看不到。
    test('子 agent complete（parent_tool_use_id 非空）立即透传，不累积', () => {
        const out: SDKMessage[] = []
        const a = new AssistantPartialAssembler(m => out.push(m))
        const sub = { ...asst('sub-1', [{ type: 'tool_use', id: 'tu-read', name: 'Read', input: {} }]), parent_tool_use_id: 'toolu-agent-1' }
        a.submit(sub)
        expect(out).toHaveLength(1) // 立即透传，无需 flushAll
        expect(out[0]).toBe(sub)
    })

    test('主线程装配中，子 agent complete 到达时先 flush 主线程再透传子 agent', () => {
        const out: SDKMessage[] = []
        const a = new AssistantPartialAssembler(m => out.push(m))
        a.submit(asst('main-1', [{ type: 'thinking', thinking: 'main' }]))
        expect(out).toEqual([]) // 主线程装配中
        const sub = { ...asst('sub-1', [{ type: 'tool_use', id: 'tu', name: 'Read', input: {} }]), parent_tool_use_id: 'toolu-agent-1' }
        a.submit(sub)
        expect(out).toHaveLength(2) // 主线程 flush 在前 + 子 agent 透传在后
        expect(out[0]!.type).toBe('assistant')
        expect(blocksOf(out[0]!)).toEqual([{ type: 'thinking', thinking: 'main' }])
        expect(out[1]).toBe(sub)
    })
})
