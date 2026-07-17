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

import type { SDKMessage, SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@/lib'

/**
 * 装配 SDK includePartialMessages 拆分的 assistant partial 消息
 *
 * SDK 0.3.211+ 开启 includePartialMessages 时，同一条 Anthropic message
 * （共享 message.id）的多个 content block 会被拆成多条 SDK assistant 消息分别 emit。
 * 若直接下游（converter → Hub）用 message.uuid 作去重 localId，后到的 partial 会覆盖先到的，
 * 导致 thinking 等先到 block 丢失。
 *
 * 本装配器按 message.id 累积同一条 message 的所有 block，在遇到「不同 message.id /
 * 非 assistant 消息 / 显式 flush」时输出一条完整 assistant 消息，使下游始终收到完整 message
 * （一条 message 对应一个 uuid），Hub 去重语义保持单一、无需为 partial 打补丁。
 *
 * 流式逐字渲染走独立的 stream_event / snapshot 通道，不经过此处，不受影响。
 *
 * 注意：装配依赖 SDK 对同一条 message 的多条 partial **连续 emit**（不与其他 message 交错）
 * ——当前 SDK 行为如此。若未来 SDK 改为交错 emit，需把 pending 由单槽改为 Map<msgId, Pending>。
 */
export class AssistantPartialAssembler {
    private pending: {
        msgId: string
        /** 累积的 content blocks（按 SDK 到达顺序），独立数组，不 mutate SDK 原对象 */
        blocks: unknown[]
        /** 最新一条 partial 作为 metadata 模板（stop_reason / usage / uuid 等） */
        template: SDKAssistantMessage
    } | null = null

    constructor(private readonly emit: (message: SDKMessage) => void) {}

    /**
     * 提交一条 SDK 消息：
     * - 非 assistant：先 flush 待装配消息，再原样透传
     * - assistant 有 message.id：按 message.id 累积 block（同 id）或先 flush 上一条（不同 id）
     * - assistant 缺 message.id：无法判定归属，flush 后透传并告警（仍可能被下游同 uuid 去重覆盖）
     */
    submit(message: SDKMessage): void {
        // 非 assistant：先 flush 待装配消息，再原样透传
        if (message.type !== 'assistant') {
            this.flush()
            this.emit(message)
            return
        }

        const am = message as SDKAssistantMessage
        const msgId = am.message?.id
        if (!msgId) {
            logger.warn('[AssistantPartialAssembler] assistant 消息缺少 message.id，跳过装配直接透传（同 uuid 的 partial 可能被下游去重覆盖）')
            this.flush()
            this.emit(message)
            return
        }

        const inBlocks = Array.isArray(am.message.content) ? am.message.content : []

        // 不同 message.id 标志上一条 message 的 partial 已到齐 → 先 flush
        // （依赖 SDK 同 message 的 partial 连续到达、不交错，见类注释）
        if (this.pending && this.pending.msgId !== msgId) {
            this.flush()
        }

        if (this.pending) {
            // 同 message.id：累积 block，metadata 模板更新为最新 partial
            this.pending.blocks.push(...inBlocks)
            this.pending.template = am
        } else {
            this.pending = { msgId, blocks: [...inBlocks], template: am }
        }
    }

    /** 输出待装配的完整 assistant 消息（若有） */
    flush(): void {
        if (!this.pending) return
        const { template, blocks } = this.pending
        this.pending = null
        // 以最新 partial 为信封，替换 content 为累积的全部 block（不 mutate template）
        this.emit({
            ...template,
            message: { ...template.message, content: blocks as SDKAssistantMessage['message']['content'] },
        })
    }
}
