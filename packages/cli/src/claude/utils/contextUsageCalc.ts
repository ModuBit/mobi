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
 * 上下文用量本地组装（零额外 API）——把 SDK result / compact_boundary 消息里的 usage 字段
 * 换算成 ContextUsage，供 launcher 上报。抽成纯函数便于单测。
 *
 * 两种来源：
 * - 真实 turn 的 result：usage 反映当前窗口占用；
 * - compact_boundary：post_tokens 反映压缩后占用，但该消息不带窗口大小/成本，需复用上次记忆。
 *
 * 返回 null 表示本次不可靠（本地命令 usage=0 / 窗口未知 / post_tokens 缺失），调用方应跳过、
 * 保持上一轮读数，等下一次可靠来源修正。
 */
export interface ContextUsageResult {
    usage: ContextUsage
    /** 本次主模型窗口大小，供 compact_boundary 复用记忆 */
    maxTokens: number
    /** 本次累计成本，供 compact_boundary 复用记忆 */
    costUsd: number
}

/**
 * 从真实 turn 的 result 消息组装用量。
 * - totalTokens = usage 的 input + cache_creation + cache_read（当前窗口占用）
 * - maxTokens = modelUsage 中累计 inputTokens 最大的主模型的 contextWindow
 * - costUsd = total_cost_usd（会话累计成本）
 *
 * 本地命令（/usage /cost /help 等不调主模型的指令）result.usage 为 0 → 返回 null。
 * 判据是 totalTokens===0 这个数据特征，不维护命令清单。
 */
export function calcContextUsageFromResult(resultMsg: SDKResultMessage): ContextUsageResult | null {
    const u = resultMsg.usage
    const totalTokens = u
        ? (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
        : 0
    // 本地命令 result.usage 为 0，不代表占用归零 → 跳过
    if (totalTokens === 0) return null
    const entries = Object.values(resultMsg.modelUsage ?? {})
    // 主模型：取累计 inputTokens 最大的（fallback/subagent 可能有多个，主对话占大头）
    const main = entries.length > 0
        ? entries.reduce((a, b) => (b.inputTokens > a.inputTokens ? b : a))
        : null
    const maxTokens = main?.contextWindow ?? 0
    // 窗口大小未知（异常/空 result 未填 modelUsage）→ 跳过，避免显示误导性的「0%」与「Xk/0」
    if (maxTokens === 0) return null
    const costUsd = resultMsg.total_cost_usd ?? 0
    return {
        usage: {
            totalTokens,
            maxTokens,
            percentage: (totalTokens / maxTokens) * 100,
            costUsd,
        },
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
