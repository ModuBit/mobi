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
 * 通过 Service Worker 显示系统通知。
 *
 * 为何走 SW 而非页面层 new Notification()：
 * Android Chrome / iOS Safari 已废弃页面层 Notification 构造（抛 Illegal constructor），
 * 移动端 Web 通知必须经 ServiceWorkerRegistration.showNotification()。
 * 桌面端同样支持，统一走 SW 保证跨端一致。
 *
 * @returns true=已显示；false=SW 未就绪或显示失败（调用方应降级为页面内通知）
 */
export async function showSystemNotification(options: {
    title: string
    body?: string
    icon?: string
    tag?: string
    data?: Record<string, unknown>
}): Promise<boolean> {
    try {
        const reg = await navigator.serviceWorker.ready
        await reg.showNotification(options.title, {
            body: options.body,
            icon: options.icon,
            tag: options.tag,
            data: options.data,
        })
        return true
    } catch {
        return false
    }
}
