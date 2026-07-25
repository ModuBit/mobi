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
 * 强制更新决策类型。
 * - skipWaiting: 有 waiting 新 SW,postMessage SKIP_WAITING 让其立即激活(复用 sw.ts 链路)
 * - clearCaches: 无 waiting,清空所有缓存后 reload(应对 SW 未检测到更新但版本不对)
 * - reload: 无 SW 支持,直接刷新
 */
export type ForceUpdateDecision = 'skipWaiting' | 'clearCaches' | 'reload'

export interface ForceUpdateInput {
    hasSw: boolean
    hasWaiting: boolean
}

/**
 * 强制更新决策：纯函数,不碰副作用(reload/caches),便于单测。
 *
 * 决策依据：是否有 SW、是否有 waiting 的新 SW。
 */
export function planForceUpdate(input: ForceUpdateInput): ForceUpdateDecision {
    if (!input.hasSw) return 'reload'
    if (input.hasWaiting) return 'skipWaiting'
    return 'clearCaches'
}
