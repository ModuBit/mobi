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
/** 扩展 NotificationOptions 纳入 renotify（TS 6.0 lib.dom 未收录,但 Chrome 已支持,需 tag 同时设置） */
type ShowNotificationOptions = NotificationOptions & { renotify?: boolean }

export async function showSystemNotification(options: {
    title: string
    body?: string
    icon?: string
    tag?: string
    /**
     * 同 tag 新通知替换旧通知时，是否再次提醒（响铃/震动/高亮）。
     * 配合固定 tag 实现「聚合 + 有更新再提醒」：renotify 要求 tag 必须设置。
     */
    renotify?: boolean
    data?: Record<string, unknown>
}): Promise<boolean> {
    try {
        const reg = await navigator.serviceWorker.ready
        const opts: ShowNotificationOptions = {
            body: options.body,
            icon: options.icon,
            tag: options.tag,
            renotify: options.renotify,
            data: options.data,
        }
        await reg.showNotification(options.title, opts)
        return true
    } catch {
        return false
    }
}
