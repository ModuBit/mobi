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
import { planNotificationClick, type ClickClient } from './swClick'

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
            icon: '/brand/favicon.ico',
        })
    )
})

// 点击通知:聚焦已打开的窗口并跳转到目标 session,否则新开。
// 决策见 planNotificationClick(纯函数,可单测);此处只执行返回的 plan。
self.addEventListener('notificationclick', (event) => {
    event.notification.close()
    const url = event.notification.data?.url
    event.waitUntil(
        (async () => {
            // 优先受控窗口(includeUncontrolled:false)——这些是当前版本页面,SSEProvider
            // 已挂 NAVIGATE 监听,focusAndNavigate 才能真正跳转。无受控窗口才退到全部,
            // 避免选到无监听的老版本页面导致点击后 focus 了却不跳转。
            let clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: false })
            if (clients.length === 0) {
                clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            }
            const plan = planNotificationClick(url, clients as unknown as ClickClient[])
            switch (plan.kind) {
                case 'noop':
                    return
                case 'focus':
                    try {
                        await plan.client.focus()
                    } catch {
                        // focus 偶发拒绝(如窗口已关闭),忽略
                    }
                    return
                case 'focusAndNavigate':
                    try {
                        await plan.client.focus()
                        // 让前端 SPA 路由跳转(SSEProvider 监听 NAVIGATE),避免整页刷新
                        plan.client.postMessage({ type: 'NAVIGATE', url: plan.url })
                    } catch {
                        // focus 失败(窗口策略/已销毁)→ 兜底新开,避免点击完全无反应
                        return openWindow(plan.url)
                    }
                    return
                case 'openWindow':
                    return openWindow(plan.url)
            }
        })()
    )
})

/** 打开新窗口到目标 url(相对路径按 SW origin 解析为绝对);无 openWindow 能力时返回 undefined */
function openWindow(url: string): Promise<unknown> | undefined {
    if (!self.clients.openWindow) return undefined
    const absUrl = new URL(url, self.location.origin).href
    return self.clients.openWindow(absUrl)
}
