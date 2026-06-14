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

/// <reference lib="webworker" />

import { precacheAndRoute } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'

declare let self: ServiceWorkerGlobalScope

// 预缓存构建产物(injectManifest 注入 manifest)
precacheAndRoute(self.__WB_MANIFEST || [])

// 接管所有 client(配合 SKIP_WAITING 快速激活)
clientsClaim()

/** 推送 payload 类型 */
interface PushPayload {
    title: string
    body: string
    tag?: string
    data?: { type: string; sessionId: string; url: string }
}

// 接收主线程更新指令(保留 PWA 更新机制,与 registerSW.ts SKIP_WAITING 配合)
self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        void self.skipWaiting()
    }
})

// 处理 Web Push(场景④):展示系统通知
self.addEventListener('push', (event) => {
    let payload: PushPayload
    try {
        payload = event.data?.json() ?? { title: 'Mobi', body: '' }
    } catch {
        payload = { title: 'Mobi', body: event.data?.text() ?? '' }
    }
    event.waitUntil(
        self.registration.showNotification(payload.title, {
            body: payload.body,
            tag: payload.tag,
            data: payload.data,
            icon: '/favicon.ico',
        })
    )
})

// 点击通知:聚焦已打开的同 url 窗口,否则新开
self.addEventListener('notificationclick', (event) => {
    event.notification.close()
    const url = event.notification.data?.url
    if (!url) return
    event.waitUntil(
        (async () => {
            const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            for (const client of allClients) {
                if (client.url.includes(url) && 'focus' in client) {
                    return client.focus()
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(url)
            }
            return undefined
        })()
    )
})
