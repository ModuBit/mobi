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

import type { AgentMetrics } from '@/domain/chat/types'

/** 格式化毫秒时长 */
export function formatDuration(ms: number): string {
    if (ms >= 60000) {
        const min = Math.floor(ms / 60000)
        const sec = Math.floor((ms % 60000) / 1000)
        return sec > 0 ? `${min}m ${sec}s` : `${min}m`
    }
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
    return `${ms}ms`
}

/** 格式化 token 数量 */
export function formatTokens(tokens: number): string {
    return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`
}

/** 将 AgentMetrics 格式化为显示字符串 */
export function formatAgentMetrics(metrics: AgentMetrics): string {
    const parts: string[] = []
    if (metrics.durationMs > 0) parts.push(formatDuration(metrics.durationMs))
    if (metrics.tokens > 0) parts.push(`${formatTokens(metrics.tokens)} tokens`)
    if (metrics.toolUses > 0) parts.push(`${metrics.toolUses} tools`)
    return parts.join(' · ')
}
