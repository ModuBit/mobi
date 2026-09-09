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

import type { SyncEvent } from '@mobi/shared/types'
import type { VisibilityState } from '../visibility/visibilityTracker'
import type { VisibilityTracker } from '../visibility/visibilityTracker'
import { SnapshotSync, type SnapshotSubscription } from '../sync/snapshotSync'

export type SSESubscription = {
    id: string
    namespace: string
    all: boolean
    sessionId: string | null
    machineId: string | null
}

type SSEConnection = SSESubscription & {
    send: (event: SyncEvent) => void | Promise<void>
    sendHeartbeat: () => void | Promise<void>
    snapshot: SnapshotSubscription
}

export class SSEManager {
    private readonly connections: Map<string, SSEConnection> = new Map()
    private heartbeatTimer: NodeJS.Timeout | null = null
    private readonly heartbeatMs: number
    private readonly visibilityTracker: VisibilityTracker
    private readonly snapshotSync: SnapshotSync

    constructor(heartbeatMs = 30_000, visibilityTracker: VisibilityTracker, snapshotSync?: SnapshotSync) {
        this.heartbeatMs = heartbeatMs
        this.visibilityTracker = visibilityTracker
        this.snapshotSync = snapshotSync ?? new SnapshotSync()
    }

    subscribe(options: {
        id: string
        namespace: string
        all?: boolean
        sessionId?: string | null
        machineId?: string | null
        visibility?: VisibilityState
        /** snapshot delta 能力协商（票 02）：老 web 缺省 false，恒收全量 */
        snapshotDelta?: boolean
        send: (event: SyncEvent) => void | Promise<void>
        sendHeartbeat: () => void | Promise<void>
    }): SSESubscription {
        this.connections.get(options.id)?.snapshot.close()
        const subscription: SSEConnection = {
            id: options.id,
            namespace: options.namespace,
            all: Boolean(options.all),
            sessionId: options.sessionId ?? null,
            machineId: options.machineId ?? null,
            send: options.send,
            sendHeartbeat: options.sendHeartbeat,
            snapshot: this.snapshotSync.attachSubscription({
                id: options.id,
                wantsDelta: Boolean(options.snapshotDelta),
            }),
        }

        this.connections.set(subscription.id, subscription)
        this.visibilityTracker.registerConnection(
            subscription.id,
            subscription.namespace,
            options.visibility ?? 'hidden'
        )
        this.ensureHeartbeat()
        return {
            id: subscription.id,
            namespace: subscription.namespace,
            all: subscription.all,
            sessionId: subscription.sessionId,
            machineId: subscription.machineId
        }
    }

    unsubscribe(id: string): void {
        const connection = this.connections.get(id)
        connection?.snapshot.close()
        this.connections.delete(id)
        this.visibilityTracker.removeConnection(id)
        if (this.connections.size === 0) {
            this.stopHeartbeat()
        }
    }

    async sendToast(namespace: string, event: Extract<SyncEvent, { type: 'toast' }>): Promise<number> {
        const deliveries: Array<Promise<{ id: string; ok: boolean }>> = []
        for (const connection of this.connections.values()) {
            if (connection.namespace !== namespace) {
                continue
            }
            // 投递给该 namespace 所有活跃连接(含 hidden 后台):
            // 后台 tab 由前端收到后,自行决定是否弹系统通知

            deliveries.push(
                Promise.resolve(connection.send(event))
                    .then(() => ({ id: connection.id, ok: true }))
                    .catch(() => ({ id: connection.id, ok: false }))
            )
        }

        if (deliveries.length === 0) {
            return 0
        }

        const results = await Promise.all(deliveries)
        let successCount = 0
        for (const result of results) {
            if (result.ok) {
                successCount += 1
                continue
            }
            this.unsubscribe(result.id)
        }

        return successCount
    }

    /** 订阅元信息查询（snapshot-resync 端点做属主校验用）；无该订阅 → null */
    getSubscription(id: string): SSESubscription | null {
        const connection = this.connections.get(id)
        if (!connection) return null
        return {
            id: connection.id,
            namespace: connection.namespace,
            all: connection.all,
            sessionId: connection.sessionId,
            machineId: connection.machineId,
        }
    }

    /** 该 namespace 是否有任何活跃 SSE 连接(无论 visible/hidden) */
    hasActiveConnection(namespace: string): boolean {
        for (const connection of this.connections.values()) {
            if (connection.namespace === namespace) {
                return true
            }
        }
        return false
    }

    /** 该 namespace 是否有任何可见 SSE 连接(用户在前台) */
    hasVisibleConnection(namespace: string): boolean {
        return this.visibilityTracker.hasVisibleConnection(namespace)
    }

    broadcast(event: SyncEvent): void {
        for (const connection of this.connections.values()) {
            if (!this.shouldSend(connection, event)) {
                continue
            }

            if (event.type === 'message-snapshot' || event.type === 'message-snapshot-delta') {
                const resolved = connection.snapshot.resolve(event)
                if (resolved) this.deliver(connection, resolved)
                continue
            }

            this.deliver(connection, event)
        }
    }

    /** 为指定订阅补发会话内所有活跃流的完整基线，并重建该订阅的游标。 */
    resyncSnapshots(subscriptionId: string, sessionId: string, namespace?: string): number {
        const connection = this.connections.get(subscriptionId)
        if (!connection) return 0
        const baselines = connection.snapshot.resync(sessionId, namespace)
        for (const baseline of baselines) {
            this.deliver(connection, baseline)
        }
        return baselines.length
    }

    stop(): void {
        this.stopHeartbeat()
        for (const [id, connection] of this.connections) {
            connection.snapshot.close()
            this.visibilityTracker.removeConnection(id)
        }
        this.connections.clear()
    }

    /** 发送失败（连接已死）即卸载订阅，其余调用方无需各自 catch */
    private deliver(connection: SSEConnection, event: SyncEvent): void {
        void Promise.resolve(connection.send(event)).catch(() => {
            this.unsubscribe(connection.id)
        })
    }

    private ensureHeartbeat(): void {
        if (this.heartbeatTimer || this.heartbeatMs <= 0) {
            return
        }

        this.heartbeatTimer = setInterval(() => {
            for (const connection of this.connections.values()) {
                void Promise.resolve(connection.sendHeartbeat()).catch(() => {
                    this.unsubscribe(connection.id)
                })
            }
        }, this.heartbeatMs)
    }

    private stopHeartbeat(): void {
        if (!this.heartbeatTimer) {
            return
        }

        clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = null
    }

    private shouldSend(connection: SSEConnection, event: SyncEvent): boolean {
        if (event.type !== 'connection-changed') {
            const eventNamespace = event.namespace
            if (!eventNamespace || eventNamespace !== connection.namespace) {
                return false
            }
        }

        if (event.type === 'message-received') {
            // all=true 接收所有消息，否则仅接收绑定的 session
            return connection.all || connection.sessionId === event.sessionId
        }

        if (event.type === 'connection-changed') {
            return true
        }

        if (connection.all) {
            return true
        }

        if ('sessionId' in event && connection.sessionId === event.sessionId) {
            return true
        }

        if ('machineId' in event && connection.machineId === event.machineId) {
            return true
        }

        return false
    }
}
