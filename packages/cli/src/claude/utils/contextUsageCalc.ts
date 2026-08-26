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

import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ContextUsage } from '@mobi/shared/types'

/**
 * 上下文用量本地组装（零额外 API）——把 SDK 消息里的 usage 字段换算成 ContextUsage，
 * 供 launcher 上报。抽成纯函数便于单测。
 *
 * 返回 null 表示本次不可靠（渠道零值 / 窗口未知 / post_tokens 缺失），调用方应跳过、
 * 保持上一轮读数，等下一次可靠来源修正。
 */

/**
 * assistant usage 四项子集（message_start 三项输入 + message_delta 累计 output）。
 * 各项允许 null——SDK BetaUsage 的 cache 项类型为 number | null，`?? 0` 统一归一。
 */
export type AssistantUsage = {
    input_tokens?: number | null
    cache_creation_input_tokens?: number | null
    cache_read_input_tokens?: number | null
    output_tokens?: number | null
}

/**
 * 从主线 assistant 消息的 usage 组装**瞬时水位**（该条消息完成后的实际窗口占用）。
 * totalTokens = input + cache_creation + cache_read + output——前三项是该次请求的完整输入
 * （message_start），output 是本条消息输出（message_delta 累计，缺失时回退三项和）。
 * 返回 null 表示本次不可靠（渠道零值 / 窗口未知），调用方跳过、保持上一轮读数。
 */
export function calcContextUsageFromAssistant(
    usage: AssistantUsage | undefined,
    lastMaxTokens: number,
    lastCostUsd: number,
): ContextUsage | null {
    if (!hasAssistantUsage(usage)) return null
    const inputTokens = usage!.input_tokens ?? 0
    const cacheCreationTokens = usage!.cache_creation_input_tokens ?? 0
    const cacheReadTokens = usage!.cache_read_input_tokens ?? 0
    const outputTokens = usage!.output_tokens ?? 0
    const totalTokens = inputTokens + cacheCreationTokens + cacheReadTokens + outputTokens
    if (lastMaxTokens === 0) return null
    return {
        totalTokens,
        maxTokens: lastMaxTokens,
        percentage: (totalTokens / lastMaxTokens) * 100,
        costUsd: lastCostUsd,
        // 四项细分随水位上报（web Popover 展示 + 缓存命中率计算）
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
    }
}

/** calcContextUsageFromResult 的返回：兜底上报用水位 + 需要刷新的记忆 */
export interface ResultUsageRefresh {
    /** 兜底上报用水位；null = 本次不报（无可靠 assistant usage），保持上一轮读数 */
    usage: ContextUsage | null
    /** 本次窗口大小（result 新值 || 调用方旧记忆；0 = 未知，调用方不应采纳） */
    maxTokens: number
    /** 本次累计成本；undefined = result 未携带（如部分错误 result），调用方应保持旧记忆 */
    costUsd: number | undefined
}

/**
 * assistant usage 是否有效（四项和 > 0；渠道零值/缺失 → false）。
 * calcContextUsageFromAssistant 的零值守卫与 launcher 的实时上报前置判据同源于此——
 * 水位口径若调整只改这里，勿在调用方内联重算（口径漂移源头）。
 */
export function hasAssistantUsage(usage: AssistantUsage | undefined): boolean {
    if (!usage) return false
    return (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
        + (usage.cache_read_input_tokens ?? 0) + (usage.output_tokens ?? 0) > 0
}

/**
 * 从 turn 的 result 消息刷新窗口/成本记忆，并用「本 turn 最后一条主线 assistant 的 usage」
 * 兜底组装一次瞬时水位。
 *
 * ⚠️ 口径铁律：result.usage 是 turn 内主循环所有请求的**逐项累计**（实测 255232 = 127488+127744），
 * 不是瞬时窗口占用——**绝不**用 result.usage 的三项和当 totalTokens。
 * maxTokens / costUsd 只在此消息（modelUsage 主模型 contextWindow / total_cost_usd）。
 */
export function calcContextUsageFromResult(
    resultMsg: SDKResultMessage,
    lastAssistantUsage: AssistantUsage | undefined,
    lastMaxTokens: number,
    lastCostUsd: number,
): ResultUsageRefresh {
    const entries = Object.values(resultMsg.modelUsage ?? {})
    // 主模型：取累计 inputTokens 最大的（fallback/subagent 可能有多个，主对话占大头）
    const main = entries.length > 0
        ? entries.reduce((a, b) => (b.inputTokens > a.inputTokens ? b : a))
        : null
    const maxTokens = main?.contextWindow || lastMaxTokens
    const costUsd = resultMsg.total_cost_usd
    return {
        // 兜底水位的成本用「最新已知」值（result 值 ?? 调用方旧记忆），避免缺字段时报 $0.00
        usage: calcContextUsageFromAssistant(lastAssistantUsage, maxTokens, costUsd ?? lastCostUsd),
        maxTokens,
        costUsd,
    }
}

/**
 * 从 compact_boundary 的 post_tokens 组装压缩后用量，复用上次真实 turn 记忆的窗口大小与成本。
 * post_tokens 缺失（压缩失败等，字段可选）或尚无窗口大小记忆 → 返回 null，保持上一轮读数。
 */
export function calcContextUsageFromCompact(
    postTokens: number | undefined,
    lastMaxTokens: number,
    lastCostUsd: number,
): ContextUsage | null {
    if (postTokens === undefined) return null
    if (lastMaxTokens === 0) return null
    return {
        totalTokens: postTokens,
        maxTokens: lastMaxTokens,
        percentage: (postTokens / lastMaxTokens) * 100,
        costUsd: lastCostUsd,
    }
}
