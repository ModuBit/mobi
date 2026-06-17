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

import type { Session, SyncEvent } from '../sync/syncEngine'
import type { NotificationChannel } from '../notifications/notificationTypes'
import { getAgentName, getSessionName } from '../notifications/sessionInfo'
import type { SSEManager } from '../sse/sseManager'
import type { PushPayload, PushService } from './pushService'

type ToastData = Extract<SyncEvent, { type: 'toast' }>['data']

export class PushNotificationChannel implements NotificationChannel {
    constructor(
        private readonly pushService: PushService,
        private readonly sseManager: SSEManager,
        _appUrl: string
    ) {}

    async sendPermissionRequest(session: Session): Promise<void> {
        if (!session.active) {
            return
        }

        const name = getSessionName(session)
        const request = session.agentState?.requests
            ? Object.values(session.agentState.requests)[0]
            : null
        const toolName = request?.tool ? ` (${request.tool})` : ''

        const payload: PushPayload = {
            title: 'Permission Request',
            body: `${name}${toolName}`,
            tag: `permission-${session.id}`,
            data: {
                type: 'permission-request',
                sessionId: session.id,
                url: this.buildSessionPath(session.id)
            }
        }

        const url = payload.data?.url ?? this.buildSessionPath(session.id)
        const delivered = await this.trySendToast(session.namespace, {
            kind: 'permission',
            title: payload.title,
            body: payload.body,
            sessionId: session.id,
            url
        })
        if (delivered) {
            return
        }

        await this.pushService.sendToNamespace(session.namespace, payload)
    }

    async sendReady(session: Session): Promise<void> {
        if (!session.active) {
            return
        }

        const agentName = getAgentName(session)
        const name = getSessionName(session)

        const payload: PushPayload = {
            title: 'Ready for input',
            body: `${agentName} is waiting in ${name}`,
            tag: `ready-${session.id}`,
            data: {
                type: 'ready',
                sessionId: session.id,
                url: this.buildSessionPath(session.id)
            }
        }

        const url = payload.data?.url ?? this.buildSessionPath(session.id)
        const delivered = await this.trySendToast(session.namespace, {
            kind: 'ready',
            title: payload.title,
            body: payload.body,
            sessionId: session.id,
            url
        })
        if (delivered) {
            return
        }

        await this.pushService.sendToNamespace(session.namespace, payload)
    }

    /**
     * 尝试走 SSE toast 投递。返回 true 表示已成功投递(调用方无需再走 Web Push)。
     *
     * 决策:
     * - 有可见连接(用户在前台)→ 走 toast,避免系统通知打扰正在使用的用户
     * - 无 push 订阅(无法走 Web Push,如未装推送服务的环境)→ 用 toast 兜底,
     *   由前端收到后转系统通知
     * 其余情况(后台且已订阅 push)返回 false,由调用方走 Web Push,
     * 经 Service Worker 独立线程投递,不依赖页面 JS 存活,长时后台仍可靠。
     */
    private async trySendToast(namespace: string, data: ToastData): Promise<boolean> {
        const shouldUseToast = this.sseManager.hasVisibleConnection(namespace)
            || !this.pushService.hasSubscription(namespace)
        if (!shouldUseToast) {
            return false
        }

        const delivered = await this.sseManager.sendToast(namespace, { type: 'toast', data })
        return delivered > 0
    }

    private buildSessionPath(sessionId: string): string {
        return `/sessions/${sessionId}`
    }
}
