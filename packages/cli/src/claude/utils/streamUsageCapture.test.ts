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
import { StreamUsageCapture, injectUsageFromStream } from './streamUsageCapture'
import type { SDKAssistantMessage, SDKPartialAssistantMessage } from '@anthropic-ai/claude-agent-sdk'

/** 构造 stream_event 消息（只填被测字段，其余 as 断言） */
function streamEvent(event: unknown): SDKPartialAssistantMessage {
    return { type: 'stream_event', event, uuid: 'u', session_id: 's', parent_tool_use_id: null } as unknown as SDKPartialAssistantMessage
}

function assistantMsg(id: string, usage: unknown): SDKAssistantMessage {
    return {
        type: 'assistant', uuid: 'u', session_id: 's', parent_tool_use_id: null,
        message: { id, type: 'message', role: 'assistant', content: [], usage },
    } as unknown as SDKAssistantMessage
}

describe('StreamUsageCapture', () => {
    it('message_start 捕获输入三项', () => {
        const c = new StreamUsageCapture()
        c.capture(streamEvent({
            type: 'message_start',
            message: { id: 'msg_1', usage: { input_tokens: 310, cache_creation_input_tokens: 0, cache_read_input_tokens: 127488 } },
        }))
        expect(c.take('msg_1')).toEqual({ input_tokens: 310, cache_creation_input_tokens: 0, cache_read_input_tokens: 127488 })
    })

    it('message_delta 补累计 output_tokens（无 message.id，关联最近 message_start）', () => {
        const c = new StreamUsageCapture()
        c.capture(streamEvent({ type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 5 } } }))
        c.capture(streamEvent({ type: 'message_delta', delta: {}, usage: { output_tokens: 42 } }))
        // message_start 归一化：未提供的 cache 项 materialize 为 0
        expect(c.take('msg_1')).toEqual({ input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 42 })
    })

    it('message_delta 回填非空 input 三项时覆盖（累计终值更权威，SDK 类型 BetaMessageDeltaUsage 三项可回填）', () => {
        const c = new StreamUsageCapture()
        c.capture(streamEvent({ type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 5 } } }))
        c.capture(streamEvent({ type: 'message_delta', delta: {}, usage: { input_tokens: 310, cache_read_input_tokens: 127488, output_tokens: 42 } }))
        expect(c.take('msg_1')).toEqual({ input_tokens: 310, cache_creation_input_tokens: 0, cache_read_input_tokens: 127488, output_tokens: 42 })
    })

    it('message_delta 的 input 三项为 null（服务端实践常态）→ 不覆盖已有值', () => {
        const c = new StreamUsageCapture()
        c.capture(streamEvent({ type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 5, cache_read_input_tokens: 100 } } }))
        c.capture(streamEvent({ type: 'message_delta', delta: {}, usage: { input_tokens: null, cache_creation_input_tokens: null, cache_read_input_tokens: null, output_tokens: 7 } }))
        expect(c.take('msg_1')).toEqual({ input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 100, output_tokens: 7 })
    })

    it('take 后条目删除（防泄漏）', () => {
        const c = new StreamUsageCapture()
        c.capture(streamEvent({ type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 5 } } }))
        c.take('msg_1')
        expect(c.take('msg_1')).toBeUndefined()
    })

    it('交错消息各自成槽（不同 message.id）', () => {
        const c = new StreamUsageCapture()
        c.capture(streamEvent({ type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 5 } } }))
        c.capture(streamEvent({ type: 'message_start', message: { id: 'msg_2', usage: { input_tokens: 9 } } }))
        c.capture(streamEvent({ type: 'message_delta', delta: {}, usage: { output_tokens: 7 } }))
        expect(c.take('msg_1')).toEqual({ input_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 })
        expect(c.take('msg_2')).toEqual({ input_tokens: 9, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 7 })
    })
})

describe('injectUsageFromStream', () => {
    it('envelope 全 0 且捕获有效 → 注入并保留 output', () => {
        const c = new StreamUsageCapture()
        c.capture(streamEvent({ type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 310, cache_read_input_tokens: 127488 } } }))
        c.capture(streamEvent({ type: 'message_delta', delta: {}, usage: { output_tokens: 42 } }))
        const msg = assistantMsg('msg_1', { input_tokens: 0, output_tokens: 0 })
        expect(injectUsageFromStream(msg, c)).toBe(true)
        expect(msg.message.usage).toEqual({ input_tokens: 310, cache_creation_input_tokens: 0, cache_read_input_tokens: 127488, output_tokens: 42 })
    })

    it('envelope 自带非零 usage → 信任 envelope，不注入', () => {
        const c = new StreamUsageCapture()
        c.capture(streamEvent({ type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 310 } } }))
        const msg = assistantMsg('msg_1', { input_tokens: 999, output_tokens: 1 })
        expect(injectUsageFromStream(msg, c)).toBe(false)
        expect(msg.message.usage).toEqual({ input_tokens: 999, output_tokens: 1 })
    })

    it('捕获三项和为 0（渠道不返回）→ 不注入', () => {
        const c = new StreamUsageCapture()
        c.capture(streamEvent({ type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 0 } } }))
        const msg = assistantMsg('msg_1', { input_tokens: 0, output_tokens: 0 })
        expect(injectUsageFromStream(msg, c)).toBe(false)
    })
})
