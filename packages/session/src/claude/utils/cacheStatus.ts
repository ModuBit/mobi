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
 * SessionStart hook 缓存信号 → CacheStatus 组装（SDK 0.3.268，upstream-suggestions ①）。
 *
 * remote 进程内 hook 回调与 local HTTP hook body 同为 snake_case hook input JSON，
 * 两端共用本函数。仅 resume/fork 且 prompt_cache_likely_expired=true 时产出——
 * warm 无信息量（web 只提示「恢复后首轮将重缓存」），其余情况返回 null（调用方不 emit）。
 */

import type { CacheStatus } from '@mobi/shared'

/** SessionStart hook input 的缓存相关字段（SDK 类型 + local HTTP body 的公共子集） */
export type SessionStartCacheInput = {
    source?: unknown
    prompt_cache_likely_expired?: unknown
    context_tokens?: unknown
    seconds_since_last_response?: unknown
    estimated_cache_write_usd?: unknown
}

function asNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * 从 SessionStart hook input 组装 CacheStatus。
 * 非 resume/fork、或缓存未过期 → null（不上报）；可选字段仅在有效数字时携带。
 */
export function buildCacheStatusFromSessionStart(data: SessionStartCacheInput): CacheStatus | null {
    if (data.source !== 'resume' && data.source !== 'fork') return null
    if (data.prompt_cache_likely_expired !== true) return null
    return {
        expired: true,
        ...(asNumber(data.context_tokens) !== undefined && { contextTokens: asNumber(data.context_tokens) }),
        ...(asNumber(data.seconds_since_last_response) !== undefined && { secondsSinceLastResponse: asNumber(data.seconds_since_last_response) }),
        ...(asNumber(data.estimated_cache_write_usd) !== undefined && { estimatedCacheWriteUsd: asNumber(data.estimated_cache_write_usd) }),
        observedAt: Date.now(),
    }
}
