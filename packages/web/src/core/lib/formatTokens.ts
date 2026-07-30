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

import type { ContextUsage } from '@mobi/shared'

/**
 * token 数转可读短字符串：>=1,000,000 → 1.3m / >=1,000 → 124k / 否则原值。
 * 上下文用量仪表盘各处展示统一用此函数，避免出现 967000 这种长串。
 */
export function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`
    if (tokens >= 1_000) return `${Math.round(tokens / 1000)}k`
    return `${tokens}`
}

/**
 * SDK 的 autoCompactThreshold 是 **token 阈值数**（如 967000），不是百分比。
 * 换算成「占 maxTokens 的百分比」用于刻度定位与「距压缩剩余」展示。
 * maxTokens <= 0 或阈值缺失时返回 null（调用方按「不展示刻度/距压缩」处理）。
 *
 * Thread（刻度位置）与 Detail（距压缩计算）共用此函数，避免两处公式偏移。
 */
export function thresholdPercent(usage: ContextUsage): number | null {
    if (usage.autoCompactThreshold === undefined || usage.maxTokens <= 0) return null
    return (usage.autoCompactThreshold / usage.maxTokens) * 100
}
