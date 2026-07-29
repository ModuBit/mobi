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

import type {
    SDKResultMessage,
    SDKControlGetContextUsageResponse,
} from '@anthropic-ai/claude-agent-sdk'
import type { ContextUsage } from '@mobi/shared'
import { logger } from '@/lib'

/** collector 只依赖 getContextUsage 这一个方法（接受 queryControlRef.current）。
 *  返回 unknown：QueryControlRef 为避免引入 SDK 类型依赖把返回窄化为 unknown，
 *  运行时实为 SDKControlGetContextUsageResponse，shape() 内 cast 还原。 */
type ContextUsageSource = { getContextUsage(): Promise<unknown> }

/**
 * 上下文用量采集器
 *
 * 封装 SDK `Query.getContextUsage()` 的调用 + 字段裁剪 + 成本提取，供 `sdkOutputLoop`
 * 在事件点（system/init · assistant · result · /compact 完成 · /clear）触发采集。
 *
 * 对齐 `StreamSnapshotSender` 的自包含模式，但更简单——无定时器、无 buffer，
 * 纯粹「采集一次 → 裁剪 → 返回」。**事件驱动**（由调用方决定何时采），非轮询；
 * 定时器兜底见 docs/pending.md #36。
 *
 * 字段裁剪：SDK 完整响应含大量前端用不到的字段（gridRows / mcpTools / memoryFiles /
 * skills / deferredBuiltinTools / agents / slashCommands 等），这里只保留仪表盘所需的
 * totalTokens / maxTokens / percentage / autoCompactThreshold / isAutoCompactEnabled /
 * categories / apiUsage，降低落库与 SSE 体积。
 *
 * 错误隔离：getContextUsage 失败时记 `logger.error` 并返回 null，不抛、不阻塞 SDK 消息流。
 */
export class ContextUsageCollector {
    /** 会话累计成本（USD）；result 到达时更新，无 result 时沿用上次值 */
    private lastCostUsd = 0

    /**
     * 采集一次上下文用量。
     *
     * @param source 有 getContextUsage 的对象（Query 或 queryControlRef.current）
     * @param resultMsg 当前 result 消息（可选；提供则用其 total_cost_usd 更新累计成本）
     * @returns 裁剪后的 ContextUsage；采集失败返回 null（调用方应跳过上报）
     */
    async collect(source: ContextUsageSource, resultMsg?: SDKResultMessage): Promise<ContextUsage | null> {
        try {
            const raw = (await source.getContextUsage()) as SDKControlGetContextUsageResponse
            if (resultMsg && typeof resultMsg.total_cost_usd === 'number') {
                this.lastCostUsd = resultMsg.total_cost_usd
            }
            return this.shape(raw)
        } catch (e) {
            logger.error('[context-usage] 采集失败', e)
            return null
        }
    }

    /** /clear 后重置累计成本（新 session 从 0 计） */
    reset(): void {
        this.lastCostUsd = 0
    }

    /** 裁剪 SDK 完整响应为前端所需的 ContextUsage */
    private shape(raw: SDKControlGetContextUsageResponse): ContextUsage {
        return {
            totalTokens: raw.totalTokens,
            maxTokens: raw.maxTokens,
            percentage: raw.percentage,
            autoCompactThreshold: raw.autoCompactThreshold,
            isAutoCompactEnabled: raw.isAutoCompactEnabled,
            categories: raw.categories.map(c => ({
                name: c.name,
                tokens: c.tokens,
                color: c.color,
            })),
            apiUsage: raw.apiUsage
                ? {
                    input_tokens: raw.apiUsage.input_tokens,
                    output_tokens: raw.apiUsage.output_tokens,
                    cache_read_input_tokens: raw.apiUsage.cache_read_input_tokens,
                    cache_creation_input_tokens: raw.apiUsage.cache_creation_input_tokens,
                }
                : null,
            costUsd: this.lastCostUsd,
        }
    }
}
