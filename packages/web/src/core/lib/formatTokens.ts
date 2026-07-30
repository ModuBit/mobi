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
 * token 数转可读短字符串：>=1,000,000 → 1.3m / >=1,000 → 124k / 否则原值。
 * 上下文用量仪表盘各处展示统一用此函数，避免出现 967000 这种长串。
 */
export function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`
    if (tokens >= 1_000) return `${Math.round(tokens / 1000)}k`
    return `${tokens}`
}

