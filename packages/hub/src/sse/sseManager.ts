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
import type { SnapshotDeltaForwarder } from './snapshotDeltaForwarder'
import { SnapshotDeltaStats } from '../sync/snapshotDeltaStats'

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
    /** 订阅协商了 snapshot delta（票 02）：跟不上时 forwarder 仍会全量追赶 */
    wantsDelta: boolean
}

export class SSEManager {
    private readonly connections: Map<string, SSEConnection> = new Map()
    private heartbeatTimer: NodeJS.Timeout | null = null
    private readonly heartbeatMs: number
    private readonly visibilityTracker: VisibilityTracker
    /** snapshot delta 转发器（票 02）：组装层注入；未注入时 delta 事件不下发（防御） */
    private snapshotForwarder: SnapshotDeltaForwarder | null = null
    /** 流量观测（票 03）：组装层注入；缺省关闭（零开销） */
    private readonly stats: SnapshotDeltaStats

    constructor(heartbeatMs = 30_000, visibilityTracker: VisibilityTracker, stats?: SnapshotDeltaStats) {
        this.heartbeatMs = heartbeatMs
        this.visibilityTracker = visibilityTracker
        this.stats = stats ?? new SnapshotDeltaStats(false)
    }

    setSnapshotForwarder(forwarder: SnapshotDeltaForwarder | null): void {
        this.snapshotForwarder = forwarder
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
        const subscription: SSEConnection = {
            id: options.id,
            namespace: options.namespace,
            all: Boolean(options.all),
            sessionId: options.sessionId ?? null,
            machineId: options.machineId ?? null,
            send: options.send,
            sendHeartbeat: options.sendHeartbeat,
            wantsDelta: Boolean(options.snapshotDelta),
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
        this.connections.delete(id)
        this.visibilityTracker.removeConnection(id)
        this.snapshotForwarder?.resetSubscription(id)
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
        // 同一事件广播给 N 个订阅只序列化测一次（stats 关闭时零成本）。
        // delta 原样转发（resolved === event）跨订阅同引用，同样可复用
        let fullBytes: number | null = null
        let deltaBytes: number | null = null
        for (const connection of this.connections.values()) {
            if (!this.shouldSend(connection, event)) {
                continue
            }

            // snapshot delta 帧（票 02）：按订阅进度路由——衔接且协商 delta → 转发增量；
            // 否则 forwarder 从拼接器缓存构造全量追赶。无 forwarder（组装异常）不下发。
            if (event.type === 'message-snapshot-delta') {
                const resolved = this.snapshotForwarder?.resolve(event, connection)
                if (resolved) {
                    if (resolved === event) {
                        deltaBytes ??= this.stats.bytesOf(event)
                        this.deliverSnapshot(connection, resolved, deltaBytes)
                    } else {
                        // 全量追赶内容因含 Date.now() 逐订阅不同，序列化天然逐次
                        this.deliverSnapshot(connection, resolved)
                    }
                }
                continue
            }

            // 全量 snapshot：标记游标 + 统计后下发（同 broadcast 内字节只算一次）
            if (event.type === 'message-snapshot') {
                fullBytes ??= this.stats.bytesOf(event)
                this.deliverSnapshot(connection, event, fullBytes)
                continue
            }

            this.deliver(connection, event)
        }
    }

    /** 定向发送（票 02：snapshot resync 端点对指定订阅补发全量）。无该订阅静默丢弃 */
    sendTo(subscriptionId: string, event: SyncEvent): void {
        const connection = this.connections.get(subscriptionId)
        if (!connection) return
        if (event.type === 'message-snapshot') {
            this.deliverSnapshot(connection, event)
            return
        }
        this.deliver(connection, event)
    }

    stop(): void {
        this.stopHeartbeat()
        for (const id of this.connections.keys()) {
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

    /**
     * snapshot 类事件下发：delta 原样转发或全量追赶共用——全量标记订阅游标
     * （衔接后续 delta；仅对协商 delta 的连接，老 web 游标无人读徒增泄漏）+ 流量统计后
     * 投递。precomputedBytes 供广播扇出复用同一事件的序列化长度（同事件 N 订阅只测一次）。
     */
    private deliverSnapshot(connection: SSEConnection, event: SyncEvent, precomputedBytes?: number): void {
        if (event.type === 'message-snapshot') {
            if (connection.wantsDelta) {
                this.snapshotForwarder?.markFullSent(connection.id, event.message.localId ?? null, event.message.snapshotRev ?? null)
            }
            this.stats.record('hub-to-web', 'full', event, precomputedBytes)
        } else {
            this.stats.record('hub-to-web', 'delta', event, precomputedBytes)
        }
        this.deliver(connection, event)
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
