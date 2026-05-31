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

    let registration: ServiceWorkerRegistration | null = null

    navigator.serviceWorker.register('/sw.js').then((reg) => {
        registration = reg

        // 检查是否有等待中的新 SW
        if (reg.waiting) {
            notifyUpdate(reg)
        }

        reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing
            if (!newWorker) return

            newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                    notifyUpdate(reg)
                }
            })
        })
    }).catch((err) => {
        console.warn('[PWA] SW 注册失败:', err)
    })

    // 监听 controller 变化（SW 激活后触发）
    const onControllerChange = () => {
        window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    function notifyUpdate(reg: ServiceWorkerRegistration) {
        const reload = () => {
            if (reg.waiting) {
                reg.waiting.postMessage({ type: 'SKIP_WAITING' })
            }
        }
        onUpdate(reload)
    }

    return () => {
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
}
