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

import type { SDKAssistantMessage, SDKPartialAssistantMessage } from '@anthropic-ai/claude-agent-sdk'

/**
 * stream_event → assistant 消息的 usage 跨通道摆渡。
 *
 * SDK includePartialMessages 下一次 API 响应拆两条平行通道：stream_event（message_start 带
 * 真实 usage，先到）与按 block 拆分的 assistant 消息（envelope 的 message.usage 为 {0,0} 占位，
 * 后到、随装配落库）。本类按 message.id 暂存前者，装配 flush 时注入后者——抹平两条通道的
 * 到达时间差（秒级）。
 *
 * message_delta 无 message.id（Anthropic 流式协议同一时刻仅一条 message 在流），关联最近一次
 * message_start 的 id——与 StreamSnapshotSender 的单流假设一致。
 */
export interface StreamUsage {
    input_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    output_tokens?: number
}

export class StreamUsageCapture {
    private pending = new Map<string, StreamUsage>()
    private lastMessageId: string | undefined

    /** 从 stream_event 提取 usage：message_start 存输入三项，message_delta 补累计 output */
    capture(message: SDKPartialAssistantMessage): void {
        const event = message.event as { type: string; message?: { id: string; usage?: StreamUsage }; usage?: StreamUsage }
        if (event.type === 'message_start' && event.message) {
            this.lastMessageId = event.message.id
            const u = event.message.usage
            if (!u) return
            this.pending.set(event.message.id, {
                input_tokens: u.input_tokens ?? 0,
                cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
                cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
            })
        } else if (event.type === 'message_delta' && this.lastMessageId) {
            const existing = this.pending.get(this.lastMessageId)
            if (!existing) return
            const u = event.usage
            if (!u) return
            // delta 回填非空 input 三项 → 覆盖（累计终值更权威；SDK 类型 BetaMessageDeltaUsage
            // 三项为 number|null，服务端实践常态是 null 不回填）
            if (typeof u.input_tokens === 'number' && u.input_tokens > 0) existing.input_tokens = u.input_tokens
            if (typeof u.cache_creation_input_tokens === 'number' && u.cache_creation_input_tokens > 0) existing.cache_creation_input_tokens = u.cache_creation_input_tokens
            if (typeof u.cache_read_input_tokens === 'number' && u.cache_read_input_tokens > 0) existing.cache_read_input_tokens = u.cache_read_input_tokens
            // output 只认 delta 的累计值（message_start 里的 output 是初始占位，不准）
            if (typeof u.output_tokens === 'number' && u.output_tokens > 0) existing.output_tokens = u.output_tokens
        }
    }

    /** 取走并删除该 message 的捕获值（消息已 flush，条目无用） */
    take(messageId: string): StreamUsage | undefined {
        const u = this.pending.get(messageId)
        this.pending.delete(messageId)
        return u
    }
}

/**
 * 把捕获的 usage 注入装配后的 assistant 消息。
 * 守卫：仅当 envelope usage 缺失或全 0，且捕获三项和 > 0 时注入——若未来 SDK 在 envelope
 * 带真实 usage，以 envelope 为准；渠道零值不注入。
 * 返回是否注入。
 */
export function injectUsageFromStream(msg: SDKAssistantMessage, capture: StreamUsageCapture): boolean {
    const messageId = msg.message?.id
    if (!messageId) return false
    const captured = capture.take(messageId)
    const envelope = msg.message?.usage
    const envelopeValid = !!envelope
        && ((envelope.input_tokens ?? 0) + (envelope.cache_creation_input_tokens ?? 0)
            + (envelope.cache_read_input_tokens ?? 0) + (envelope.output_tokens ?? 0)) > 0
    const capturedValid = !!captured
        && ((captured.input_tokens ?? 0) + (captured.cache_creation_input_tokens ?? 0)
            + (captured.cache_read_input_tokens ?? 0)) > 0
    if (envelopeValid || !capturedValid) return false
    msg.message!.usage = { ...envelope, ...captured }
    return true
}
