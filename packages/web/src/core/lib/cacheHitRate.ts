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
 * 缓存命中率单源：cacheRead / (input + cacheCreation + cacheRead)，round 到 0.1%。
 * turn 概要（normalizeAgent）与圆环 Popover（ContextRing）共用此口径，勿在调用方内联重算
 * （口径漂移源头）。精度保留一位小数：整数舍入会把真实 ~99.7% 吞成 100%，「太满」反而失真。
 */
export function calcCacheHitRate(parts: {
    inputTokens?: number
    cacheCreationTokens?: number
    cacheReadTokens?: number
}): number | undefined {
    const { inputTokens = 0, cacheCreationTokens = 0, cacheReadTokens } = parts
    // 渠道未上报缓存字段（cacheReadTokens 为 undefined）= 不报缓存数据 ≠ 命中 0%，
    // 显示 ⚡0% 会误导；分母 0（本地命令）同理 → 均不展示
    if (cacheReadTokens === undefined) return undefined
    const totalInput = inputTokens + cacheCreationTokens + cacheReadTokens
    if (totalInput <= 0) return undefined
    return Math.round((cacheReadTokens / totalInput) * 1000) / 10
}

/**
 * 命中率展示：非整数一位小数（99.7%），整数不带假小数尾（91%）。
 * 整数省小数不是格式洁癖——改动前落库的历史 turn-result 值本就是整数精度，
 * toFixed(1) 会把它补零成 "87.0%"，与新数据的真实一位小数在界面上无法区分；
 * 小数位的有无天然携带「这个值的精度是多少」。
 */
export function formatCacheHitRate(rate: number): string {
    return Number.isInteger(rate) ? `${rate}%` : `${rate.toFixed(1)}%`
}
