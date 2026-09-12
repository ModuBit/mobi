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
 * push-agent-message RPC handler（Hub → CLI 的跨会话消息投递）。
 *
 * 本模块是**本特性与既有投递路径的分界点**：消息从别的会话投来，本会话从没为它排过队，
 * 因此 handler 的三步里没有一步碰投递队列——
 *   ① 信封以首尾两个 text block 插在 blocks 外面（`withCrossSessionEnvelope`）
 *   ② 既有的 blocks→payload 转换（`buildPromptFromBlocks`，Web 用户消息在跑的同一个函数）
 *   ③ 直推 SDK input stream（注入的 sink）
 *
 * 这个「没有队列」不是靠纪律维持，是**构造上没有**：工厂只收一个 sink getter，
 * 拿不到 session / queue，想 steal 也无从下手。测试锁的就是这一点。
 *
 * 失败一律用返回值表达（见 shared 的 AgentMessagePushResult），不抛错：抛错会把
 * 回执变成连接故障，Hub 只能报一句与事实无关的「目标会话不可达」，而真相是
 * 「handler 跑了但没收下」。
 */

import { normalizeUserContent, UserMessageContentSchema, type AgentMessageDelivery, type AgentMessagePushResult } from '@mobi/shared'
import type { PromptPayload } from '@/utils/promptBuilder'
import { buildPromptFromBlocks } from '@/utils/promptBuilder'
import { withCrossSessionEnvelope } from './crossSessionEnvelope'

/** sink 未就绪 = 本轮 Query 的 input stream 没接上（重启/退出窗口） */
const NOT_ACCEPTING_REASON =
    'that session is not accepting input right now (its Claude Code process is restarting or shutting down).'

/** 推给 SDK 的 sink：返回 false 表示 input stream 已关，消息没进去 */
export type AgentMessageSink = (payload: PromptPayload) => boolean

/**
 * RPC 载荷 → 可投递的 delivery（形状不对返回 null）。
 *
 * Hub 是可信来源（它自己先用同一份词汇表校验过），这里仍要挡：**形状不对时抛错会把
 * RPC 变成连接故障**，Hub 只能报一句与事实无关的「目标会话不可达」，而真相是载荷坏了。
 * 返回 null 让调用方给出明确拒绝。
 *
 * 用 shared 的 `UserMessageContentSchema` 复核，而不是信任 `params` 的 cast：
 * blocks 要原样喂给 `buildPromptFromBlocks`，畸形 block 在那里会静默变成空串。
 */
export function parseAgentMessagePush(params: unknown): AgentMessageDelivery | null {
    if (typeof params !== 'object' || params === null) return null
    const { blocks, messageId, fromName, fromSessionId } = params as Partial<AgentMessageDelivery>

    if (typeof messageId !== 'string' || messageId.length === 0) return null
    // fromName 允许空串（发送方会话未命名），另两个标识必须有
    if (typeof fromName !== 'string') return null
    if (typeof fromSessionId !== 'string' || fromSessionId.length === 0) return null

    const parsedContent = UserMessageContentSchema.safeParse(blocks)
    if (!parsedContent.success) return null
    const normalized = normalizeUserContent(parsedContent.data)
    if (!normalized) return null

    return { blocks: normalized, messageId, fromName, fromSessionId }
}

/**
 * 造一个 handler（getSink 惰性取——sink 随每一轮 launch 注入/清空，不能在这里捕获）。
 */
export function createAgentMessagePushHandler(
    getSink: () => AgentMessageSink | null,
): (params: unknown) => Promise<AgentMessagePushResult> {
    return async (params: unknown): Promise<AgentMessagePushResult> => {
        const incoming = parseAgentMessagePush(params)
        if (!incoming) {
            return { status: 'rejected', reason: 'the message arrived in a shape this session cannot read.' }
        }

        const sink = getSink()
        // 明确拒绝，**不假装收下**：本路径没有队列可放，收下就再也没人会处理它
        if (!sink) {
            return { status: 'rejected', reason: NOT_ACCEPTING_REASON }
        }

        const payload = buildPromptFromBlocks(withCrossSessionEnvelope(incoming.blocks, incoming))
        return sink(payload)
            ? { status: 'delivered' }
            : { status: 'rejected', reason: 'that session closed its input stream before the message could be accepted.' }
    }
}
