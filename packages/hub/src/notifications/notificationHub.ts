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

import { hubLogger } from '../logger'
import type { Session, SyncEngine, SyncEvent } from '../sync/syncEngine'
import type { NotificationChannel, NotificationHubOptions } from './notificationTypes'
import { extractMessageEventType } from './eventParsing'

/**
 * 通知中心
 *
 * 监听 SyncEngine 事件，在适当时机通过 NotificationChannel 向用户发送通知。
 *
 * 两种通知场景：
 * 1. 权限请求通知（Permission Request）
 *    - 触发事件：session-updated / session-added
 *    - 触发条件：session.agentState.requests 中出现新的 requestId
 *    - 防抖策略：500ms 内的多次状态更新合并为一次通知
 *    - 场景说明：CLI 执行需要用户授权的操作（如写文件、运行命令）时，
 *      requests 作为 session 状态的一部分更新（状态驱动），而非独立事件。
 *      这样做的好处是断线恢复时不会丢失 pending 请求，多端也能看到一致状态。
 *
 * 2. Ready 通知
 *    - 触发事件：message-received
 *    - 触发条件：消息类型为 'ready'
 *    - 冷却策略：5s 内不重复发送
 *    - 场景说明：Agent 完成任务，等待用户输入。
 *
 * 防抖 vs 冷却：
 * - 防抖（debbounce）：延迟发送，每次新请求都重置计时，500ms 内无更新才真正发送。
 *   适用于请求可能短时间密集到来的场景。
 * - 冷却（cooldown）：立即发送，但 5s 内不重复。适用于事件本身就间隔较长的场景。
 */
export class NotificationHub {
    private readonly channels: NotificationChannel[]
    /** Ready 通知冷却时间，60s 内同一 session 不重复发送。
     *  60s 而非原来的 5s：agent 正常对话每轮 ready 间隔常 >5s，5s 几乎压不住 → 每轮都通知，
     *  叠加用户少点击 → 触发 Chrome 通知滥用保护("垃圾内容")。拉到 60s 显著降频，
     *  再配合前端固定 tag 聚合(pushNotificationChannel/toast 路径)避免堆积。 */
    private readonly readyCooldownMs: number
    /** 权限请求防抖时间，500ms 内的多次更新合并为一次通知 */
    private readonly permissionDebounceMs: number
    /** 每个 session 上次已知的权限请求 ID 集合，用于检测新增请求 */
    private readonly lastKnownRequests: Map<string, Set<string>> = new Map()
    /** 每个 session 的防抖定时器 */
    private readonly notificationDebounce: Map<string, NodeJS.Timeout> = new Map()
    /** 每个 session 上次发送 Ready 通知的时间戳，用于冷却控制 */
    private readonly lastReadyNotificationAt: Map<string, number> = new Map()
    private unsubscribeSyncEvents: (() => void) | null = null

    constructor(
        private readonly syncEngine: SyncEngine,
        channels: NotificationChannel[],
        options?: NotificationHubOptions
    ) {
        this.channels = channels
        this.readyCooldownMs = options?.readyCooldownMs ?? 60000
        this.permissionDebounceMs = options?.permissionDebounceMs ?? 500
        this.unsubscribeSyncEvents = this.syncEngine.subscribe((event) => {
            this.handleSyncEvent(event)
        })
    }

    stop(): void {
        if (this.unsubscribeSyncEvents) {
            this.unsubscribeSyncEvents()
            this.unsubscribeSyncEvents = null
        }

        for (const timer of this.notificationDebounce.values()) {
            clearTimeout(timer)
        }
        this.notificationDebounce.clear()
        this.lastKnownRequests.clear()
        this.lastReadyNotificationAt.clear()
    }

    /**
     * 处理 SyncEngine 事件
     *
     * session-updated/session-added → 检测权限请求变化
     * session-removed → 清理状态
     * message-received + type=ready → 发送 Ready 通知
     */
    private handleSyncEvent(event: SyncEvent): void {
        if ((event.type === 'session-updated' || event.type === 'session-added') && event.sessionId) {
            const session = this.syncEngine.getSession(event.sessionId)
            if (!session || !session.active) {
                this.clearSessionState(event.sessionId)
                return
            }
            this.checkForPermissionNotification(session)
            return
        }

        if (event.type === 'session-removed' && event.sessionId) {
            this.clearSessionState(event.sessionId)
            return
        }

        if (event.type === 'message-received' && event.sessionId) {
            const eventType = extractMessageEventType(event)
            if (eventType === 'ready') {
                this.sendReadyNotification(event.sessionId).catch((error) => {
                    hubLogger.error('[NotificationHub] Failed to send ready notification:', error)
                })
            }
        }
    }

    private clearSessionState(sessionId: string): void {
        const existingTimer = this.notificationDebounce.get(sessionId)
        if (existingTimer) {
            clearTimeout(existingTimer)
            this.notificationDebounce.delete(sessionId)
        }
        this.lastKnownRequests.delete(sessionId)
        this.lastReadyNotificationAt.delete(sessionId)
    }

    private getNotifiableSession(sessionId: string): Session | null {
        const session = this.syncEngine.getSession(sessionId)
        if (!session || !session.active) {
            return null
        }
        return session
    }

    /**
     * 检测是否有新的权限请求需要通知
     *
     * 对比当前 requests 与上次已知的 requests，发现新 requestId 时触发防抖通知。
     * 防抖机制：每次检测到新请求都重置 500ms 计时器，只有 500ms 内无新请求时才真正发送。
     * 这样可以将短时间内的多次状态更新合并为一次通知。
     */
    private checkForPermissionNotification(session: Session): void {
        const requests = session.agentState?.requests

        if (requests == null) {
            return
        }

        const newRequestIds = new Set(Object.keys(requests))
        const oldRequestIds = this.lastKnownRequests.get(session.id) || new Set()

        let hasNewRequests = false
        for (const requestId of newRequestIds) {
            if (!oldRequestIds.has(requestId)) {
                hasNewRequests = true
                break
            }
        }

        this.lastKnownRequests.set(session.id, newRequestIds)

        if (!hasNewRequests) {
            return
        }

        const existingTimer = this.notificationDebounce.get(session.id)
        if (existingTimer) {
            clearTimeout(existingTimer)
        }

        const timer = setTimeout(() => {
            this.notificationDebounce.delete(session.id)
            this.sendPermissionNotification(session.id).catch((error) => {
                hubLogger.error('[NotificationHub] Failed to send permission notification:', error)
            })
        }, this.permissionDebounceMs)

        this.notificationDebounce.set(session.id, timer)
    }

    private async sendPermissionNotification(sessionId: string): Promise<void> {
        const session = this.getNotifiableSession(sessionId)
        if (!session) {
            return
        }

        await this.notifyPermission(session)
    }

    /**
     * 发送 Ready 通知（带冷却）
     *
     * 冷却机制：5s 内只发送一次，避免频繁通知。与防抖不同，冷却是立即发送但不重复。
     */
    private async sendReadyNotification(sessionId: string): Promise<void> {
        const session = this.getNotifiableSession(sessionId)
        if (!session) {
            return
        }

        const now = Date.now()
        const last = this.lastReadyNotificationAt.get(sessionId) ?? 0
        if (now - last < this.readyCooldownMs) {
            return
        }
        this.lastReadyNotificationAt.set(sessionId, now)

        await this.notifyReady(session)
    }

    private async notifyReady(session: Session): Promise<void> {
        for (const channel of this.channels) {
            try {
                await channel.sendReady(session)
            } catch (error) {
                hubLogger.error('[NotificationHub] Failed to send ready notification:', error)
            }
        }
    }

    private async notifyPermission(session: Session): Promise<void> {
        for (const channel of this.channels) {
            try {
                await channel.sendPermissionRequest(session)
            } catch (error) {
                hubLogger.error('[NotificationHub] Failed to send permission notification:', error)
            }
        }
    }
}
