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

export type UpdateCallback = (reload: () => void) => void

/**
 * 注册 Service Worker 并监听更新
 * 返回注销函数
 */
export function registerServiceWorker(onUpdate: UpdateCallback): () => void {
    if (!('serviceWorker' in navigator)) {
        return () => {}
    }

    // 记录是否有页面控制器（区分首次安装和更新）
    let hadController = !!navigator.serviceWorker.controller
    // 标记是否已发送 SKIP_WAITING（只在主动更新时监听 controllerchange）
    let skipWaitingSent = false

    navigator.serviceWorker.register('/sw.js').then((reg) => {
        // 检查是否有等待中的新 SW
        if (reg.waiting && hadController) {
            notifyUpdate(reg)
        }

        reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing
            if (!newWorker) return

            newWorker.addEventListener('statechange', () => {
                // 只在已有控制器（非首次安装）且新 SW 已安装时通知更新
                if (newWorker.state === 'installed' && hadController) {
                    notifyUpdate(reg)
                }
            })
        })
    }).catch((err) => {
        console.warn('[PWA] SW 注册失败:', err)
    })

    // 监听 controller 变化 — 仅在主动触发 SKIP_WAITING 后才刷新
    const onControllerChange = () => {
        if (skipWaitingSent) {
            window.location.reload()
        }
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    function notifyUpdate(reg: ServiceWorkerRegistration) {
        const reload = () => {
            if (reg.waiting) {
                skipWaitingSent = true
                reg.waiting.postMessage({ type: 'SKIP_WAITING' })
            } else {
                // waiting worker 已失效，直接刷新
                window.location.reload()
            }
        }
        onUpdate(reload)
    }

    return () => {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
}
