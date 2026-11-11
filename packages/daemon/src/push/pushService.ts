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

import { daemonLogger } from '../logger'
import * as webPush from 'web-push'
import type { Store } from '../store'
import type { VapidKeys } from '../config/vapidKeys'

export type PushPayload = {
    title: string
    body: string
    tag?: string
    /** 通知震动 pattern（毫秒，[震,停,震...]；sw.ts 白名单校验后透传 showNotification）。
     *  值与 web haptics.ts 的 HAPTIC_PATTERNS 对齐（ready/pending）。
     *  ⚠️ gate 缺口：Web Push 通道绕过 web 端震动开关——daemon 不感知用户偏好
     *  （hapticFeedbackEnabled 在浏览器 localStorage），SW 系统通知的震动无法被
     *  页面 gate 拦截；要彻底跟随开关须订阅时上报偏好（未做，如实标注） */
    vibrate?: number[]
    data?: {
        type: string
        sessionId: string
        url: string
    }
}

/** 与 web haptics.ts HAPTIC_PATTERNS 对齐的 pattern 值（daemon 侧本地常量，协议体只传数组） */
export const PUSH_VIBRATE = { ready: [20], pending: [30, 60, 30] } as const

type StoredSubscription = {
    endpoint: string
    p256dh: string
    auth: string
}

type PushSubscription = {
    endpoint: string
    keys: {
        p256dh: string
        auth: string
    }
}

export class PushService {
    constructor(
        private readonly vapidKeys: VapidKeys,
        private readonly subject: string,
        private readonly store: Store
    ) {
        webPush.setVapidDetails(this.subject, this.vapidKeys.publicKey, this.vapidKeys.privateKey)
    }

    async sendToNamespace(namespace: string, payload: PushPayload): Promise<void> {
        const subscriptions = this.store.push.getPushSubscriptionsByNamespace(namespace)
        if (subscriptions.length === 0) {
            return
        }

        const body = JSON.stringify(payload)
        await Promise.all(subscriptions.map((subscription) => {
            return this.sendToSubscription(namespace, subscription, body)
        }))
    }

    /** 该 namespace 是否有已注册的 Web Push 订阅 */
    hasSubscription(namespace: string): boolean {
        return this.store.push.getPushSubscriptionsByNamespace(namespace).length > 0
    }

    private async sendToSubscription(
        namespace: string,
        subscription: StoredSubscription,
        body: string
    ): Promise<void> {
        const pushSubscription: PushSubscription = {
            endpoint: subscription.endpoint,
            keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth
            }
        }

        try {
            await webPush.sendNotification(pushSubscription, body)
        } catch (error) {
            const statusCode = typeof (error as { statusCode?: unknown }).statusCode === 'number'
                ? (error as { statusCode: number }).statusCode
                : null

            if (statusCode === 410) {
                this.store.push.removePushSubscription(namespace, subscription.endpoint)
                return
            }

            daemonLogger.error('[PushService] Failed to send notification:', error)
        }
    }
}
