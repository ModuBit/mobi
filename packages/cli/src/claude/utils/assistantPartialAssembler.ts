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
 * SDK 开启 includePartialMessages 时，同一条 Anthropic message（共享 message.id）的多个 content
 * block 会被拆成多条 SDK assistant 消息分别 emit。本装配器按 message.id 累积同一条 message 的
 * 所有 block，在 message 边界（非 assistant 消息 / 迭代结束）时输出一条完整 assistant 消息，
 * 使下游始终收到完整 message（一条 message 对应一个 uuid），Hub 去重语义单一。
 *
 * 用 `Map<msgId, Pending>` 而非单槽：**不依赖 SDK「同 message 的 partial 连续 emit」假设**——
 * 即使 SDK 交错 emit 不同 message 的 partial，各自累积到自己的槽，输出时按 message_start 顺序
 * （Map 插入序），不会把未完成的 message 提前 flush。
 *
 * flushAll 时机：非 assistant 消息（user/tool_result/result 等 = message 边界）或迭代结束。
 * 一个 turn 的消息序列里，assistant partial 总被随后的非 assistant 或 turn 结束分隔，故
 * flushAll 在这些边界输出所有已累积完整的 message。
 *
 * 流式逐字渲染走独立的 stream_event / snapshot 通道，不经过此处，不受影响。
 *
 * ## 取舍（为何暂时保留 assembler）
 *
 * 前端 `dedupeSnapshotBlocks` 按 `(messageId, type)` 过滤**单独就能解决 thinking 双气泡**
 * （snapshot 被覆盖的 block 不渲染）+ text 不中断（snapshot 的 text block 渲染到 text-full）。
 * assembler 的额外价值是「双保险」：让 `resolveMessageCache` 的 parentUuid 清理可靠（full 聚合
 * 一条 → 1-vs-1 → parentUuid 不漂移），且聚合 full 含完整 text，避免 parentUuid 清理误删
 * snapshot 导致的 text 中断。
 *
 * **代价**：assembler 累积到 flushAll（非 assistant / 结束）才输出，**后台 complete message
 * （无后续非 assistant 分隔）延迟到 turn 结束才落库**。后台 agent 多数有 stream_event
 * （snapshot 实时显示），complete message 少数延迟。
 *
 * 暂时保留 assembler（双保险）；若未来后台延迟成问题，可删 assembler + 删 parentUuid 清理，
 * 只留 type 过滤（见 streaming.md 关键设计 1 的双保险说明）。
 */
export class AssistantPartialAssembler {
    private pending = new Map<string, { blocks: unknown[]; template: SDKAssistantMessage }>()

    constructor(private readonly emit: (message: SDKMessage) => void) {}

    /**
     * 提交一条 SDK 消息：
     * - 非 assistant：先 flushAll（message 边界，输出所有待装配），再原样透传
     * - assistant 有 message.id：累积到 Map[msgId]（同 id 合并 block，更新 template）
     * - assistant 缺 message.id：无法判定归属，flushAll 后透传并告警
     */
    submit(message: SDKMessage): void {
        // 非 assistant：先 flush 所有待装配 message（message 边界），再透传
        if (message.type !== 'assistant') {
            this.flushAll()
            this.emit(message)
            return
        }

        const am = message as SDKAssistantMessage
        const msgId = am.message?.id
        if (!msgId) {
            logger.warn('[AssistantPartialAssembler] assistant 消息缺少 message.id，跳过装配直接透传（同 uuid 的 partial 可能被下游去重覆盖）')
            this.flushAll()
            this.emit(message)
            return
        }

        const inBlocks = Array.isArray(am.message.content) ? am.message.content : []
        const existing = this.pending.get(msgId)
        if (existing) {
            // 同 message.id：累积 block，metadata 模板更新为最新 partial
            existing.blocks.push(...inBlocks)
            existing.template = am
        } else {
            this.pending.set(msgId, { blocks: [...inBlocks], template: am })
        }
    }

    /** 输出所有待装配的完整 assistant 消息（按 message_start 顺序，即 Map 插入序），清空 pending */
    flushAll(): void {
        if (this.pending.size === 0) return
        for (const [, p] of this.pending) {
            // 以最新 partial 为信封，替换 content 为累积的全部 block（不 mutate template）
            this.emit({
                ...p.template,
                message: { ...p.template.message, content: p.blocks as SDKAssistantMessage['message']['content'] },
            })
        }
        this.pending.clear()
    }
}
