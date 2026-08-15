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
 * 崩溃重启策略（纯函数，便于独立单测）。
 *
 * - 退避：第 n 次连续崩溃后等待 1s → 2s → … → 30s 封顶
 * - 连续崩溃：单次运行不足 STABLE_RUN_MS 即退出算一次；
 *   稳定运行过则计数重新起算（偶发崩溃不累积）
 * - 连续 MAX_CONSECUTIVE_CRASHES 次进入 failed，不再自动重启
 */

export const STABLE_RUN_MS = 60_000
export const MAX_CONSECUTIVE_CRASHES = 5
const BACKOFF_BASE_MS = 1_000
const BACKOFF_CAP_MS = 30_000

export function nextBackoffMs(consecutiveCrashes: number): number {
    const n = Math.max(1, Math.floor(consecutiveCrashes))
    return Math.min(BACKOFF_BASE_MS * 2 ** (n - 1), BACKOFF_CAP_MS)
}

export function nextCrashCount(prevCount: number, ranMs: number): number {
    return ranMs < STABLE_RUN_MS ? prevCount + 1 : 1
}

export function shouldGiveUp(consecutiveCrashes: number): boolean {
    return consecutiveCrashes >= MAX_CONSECUTIVE_CRASHES
}
