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

/** controllerchange 超时兜底(ms):waiting worker 失效等情况下事件可能不触发 */
const CONTROLLERCHANGE_TIMEOUT_MS = 3000

/**
 * 正在硬刷新中:防 controllerchange 与超时兜底双重 reload、防用户连点。
 * 模块级标志,reload 后页面重新加载,标志随之重置。
 */
let forcing = false

/**
 * 强制更新并重载:主动检查 SW 更新 → 激活新 SW 或清缓存 → reload。
 *
 * 流程:
 * 1. 无 SW 支持 → 直接 reload
 * 2. getRegistration + reg.update() 主动拉最新 SW(绕过浏览器 24h 检查节流)
 * 3. 有 waiting 新 SW → postMessage SKIP_WAITING,等 controllerchange reload(3s 超时兜底)
 * 4. 否则 → 清空所有缓存,回落网络拿最新资源后 reload
 *
 * 幂等:重复调用直接 return。任何异常都兜底 reload,不让用户卡住。
 */
export async function forceUpdateAndReload(): Promise<void> {
    if (forcing) return
    forcing = true

    try {
        if (!('serviceWorker' in navigator)) {
            window.location.reload()
            return
        }

        const reg = await navigator.serviceWorker.getRegistration()
        // 主动拉最新 SW,绕过浏览器 24h 检查节流(update 失败不阻塞,退到清缓存路径)
        try {
            await reg?.update()
        } catch {
            // update 失败不阻塞
        }

        const decision = planForceUpdate({
            hasSw: !!reg,
            hasWaiting: !!reg?.waiting,
        })

        if (decision === 'skipWaiting' && reg?.waiting) {
            const waiting = reg.waiting
            // controllerchange 触发 reload;超时兜底防止事件不触发卡死
            let reloaded = false
            const reloadOnce = () => {
                if (reloaded) return
                reloaded = true
                window.location.reload()
            }
            navigator.serviceWorker.addEventListener(
                'controllerchange',
                reloadOnce,
                { once: true },
            )
            setTimeout(reloadOnce, CONTROLLERCHANGE_TIMEOUT_MS)
            waiting.postMessage({ type: 'SKIP_WAITING' })
            return
        }

        // clearCaches / reload:清空所有缓存,fetch 回落到网络拿最新资源
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
        window.location.reload()
    } catch {
        // 任何异常兜底 reload
        window.location.reload()
    }
}
