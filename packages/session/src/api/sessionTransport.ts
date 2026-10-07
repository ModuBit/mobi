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

import { io, type Socket } from 'socket.io-client'
import { logger } from '@mobi/node-core/logger'
import type { ClientToServerEvents, EffortLevel, ServerToClientEvents, Update } from '@mobi/shared'
import type { SessionModel, SessionPermissionMode } from '@mobi/node-core/api/types'
import { configuration } from '@mobi/node-core/configuration'

/** 兜底重连初始退避（ms）。loopback 下收紧口径（深化候选③）：0.5s 起短指数封顶 5s——
 *  重连目标 daemon 就在本机，唯一断窗是 daemon 重启（升级二进制），应积极重连；
 *  远端 hub 时代的 1s→30s 口径随单机化作废 */
const MANUAL_RECONNECT_BASE_DELAY_MS = 500
const MANUAL_RECONNECT_MAX_DELAY_MS = 5_000
/** connect_error 落盘节流窗口（ms） */
const CONNECT_ERROR_LOG_WINDOW_MS = 60_000

export type SessionTransportCallbacks = {
    /** 连接建立（first = 本进程首个连接；重连为 false——协议层据此触发补拉/重放） */
    onConnected: (info: { first: boolean }) => void
    /** 连接断开（含 connect_error；transport 层已处理重连，协议层只做状态翻 转） */
    onDisconnected: (reason: string) => void
    /** daemon 主动下发的 RPC 请求（refreshMetadata 等）：返回值为回执 */
    onRpcRequest: (data: { method: string; params: unknown }) => unknown | Promise<unknown>
    /** 会话下行更新（new-message / update-session / 其他事件体） */
    onSessionUpdate: (update: Update) => void
}

/**
 * 会话传输 module（深化候选③票①）：CLI↔daemon socket 的连接生命周期与保活。
 *
 * 职责：socket 建立与鉴权、断线重连（socket.io 内置 + 服务端断开的手动兜底退避）、
 * connect_error 节流落盘、连接等待、ack 发送咽喉（emitWithAck 统一超时口径）、
 * keepAlive 心跳。**不含任何会话语义**（消息/facts/快照在 SessionChannel）——
 * 传输失败与协议内容分离，各自可测。
 *
 * 服务端主动断开（'io server disconnect'）的兜底重连：socket.io v4 对该 reason
 * 不自动重连（daemon 优雅关闭/单连接被踢都会走到），必须手动 connect() 恢复重连循环；
 * transport 层断开（transport close/error/ping timeout）走内置自动重连，不干预；
 * 'io client disconnect' 是本进程主动断开（退出路径），禁止兜底——否则进程退不出去。
 */
export class SessionTransport {
    readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>
    /** 服务端主动断开的兜底重连定时器 */
    private manualReconnectTimer: ReturnType<typeof setTimeout> | null = null
    /** 兜底重连退避（连续被服务端断开时指数增长，connect 成功复位） */
    private manualReconnectDelayMs = MANUAL_RECONNECT_BASE_DELAY_MS
    /** connect_error 落盘节流：重连循环高频触发，窗口内只记首条防刷屏 */
    private lastConnectErrorLogAt = 0
    private hasConnectedOnce = false

    constructor(
        token: string,
        sessionId: string,
        private readonly callbacks: SessionTransportCallbacks,
    ) {
        this.socket = io(`${configuration.apiUrl}/cli`, {
            auth: {
                token,
                clientType: 'session-scoped' as const,
                sessionId,
            },
            path: '/socket.io/',
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            transports: ['websocket'],
            autoConnect: false,
        })

        this.socket.on('connect', () => {
            logger.debug('Socket connected successfully')
            const first = !this.hasConnectedOnce
            this.hasConnectedOnce = true
            this.clearManualReconnect()
            this.callbacks.onConnected({ first })
        })

        this.socket.on('rpc-request', async (data: { method: string; params: unknown }, callback: (response: unknown) => void) => {
            callback(await this.callbacks.onRpcRequest(data))
        })

        this.socket.on('disconnect', (reason) => {
            // 断开原因落盘（WARN）：daemon 重启/换血后会话退出的定位证据——曾因 debug 不落盘而无从排查
            logger.warn('[API] Socket disconnected:', reason)
            this.scheduleManualReconnect(reason)
            this.callbacks.onDisconnected(reason)
        })

        this.socket.on('connect_error', (error) => {
            // 节流落盘：错误文案是「重连为何失败」的直接证据（鉴权拒绝 / 网络不可达 / 握手失败）
            const now = Date.now()
            if (now - this.lastConnectErrorLogAt > CONNECT_ERROR_LOG_WINDOW_MS) {
                this.lastConnectErrorLogAt = now
                logger.warn('[API] Socket connection error:', error instanceof Error ? error.message : String(error))
            }
            this.callbacks.onDisconnected('connect_error')
        })

        this.socket.on('error', (payload) => {
            logger.debug('[API] Socket error:', payload)
        })

        this.socket.on('session-update', (data: Update) => {
            this.callbacks.onSessionUpdate(data)
        })

        this.socket.connect()
    }

    get connected(): boolean {
        return this.socket.connected
    }

    /** fire-and-forget 发送（协议层事件上报主通道） */
    emit(event: string, payload: unknown): void {
        (this.socket.emit as (e: string, p: unknown) => void)(event, payload)
    }

    /** ack 制 RPC 发送咽喉：统一超时口径（超时/断连 reject，由调用方按连接故障处理）。
     *  事件名走 string（typed-socket 的字面量联合太窄，socket.io 的运行时校验兜底） */
    async emitWithAck<T>(event: string, payload: unknown, timeoutMs: number): Promise<T> {
        const socket = this.socket.timeout(timeoutMs) as unknown as {
            emitWithAck: (e: string, p: unknown) => Promise<unknown>
        }
        return await socket.emitWithAck(event, payload) as T
    }

    /** ack 回调式发送（供可靠队列等自带回调语义的消费方） */
    emitAckCallback(event: string, body: unknown, timeoutMs: number, callback: (err: unknown, res?: unknown) => void): void {
        (this.socket.timeout(timeoutMs) as unknown as {
            emit: (e: string, b: unknown, cb: (err: unknown, res?: unknown) => void) => void
        }).emit(event, body, callback)
    }

    /** 会话心跳（volatile：断线时静默丢弃，下一拍再报——心跳是连续采样不是事件） */
    keepAlive(
        sessionId: string,
        running: boolean,
        mode: 'local' | 'remote',
        runtime?: { permissionMode?: SessionPermissionMode; model?: SessionModel; effort?: EffortLevel; outputStyle?: string },
    ): void {
        this.socket.volatile.emit('session-alive', {
            sid: sessionId,
            time: Date.now(),
            running,
            mode,
            ...(runtime ?? {}),
        })
    }

    /** 等待连接就绪（未连接则主动 connect；超时返回 false，不抛） */
    async waitForConnected(timeoutMs: number): Promise<boolean> {
        if (this.socket.connected) {
            return true
        }

        this.socket.connect()

        return await new Promise<boolean>((resolve) => {
            let settled = false

            const cleanup = () => {
                this.socket.off('connect', onConnect)
                clearTimeout(timeout)
            }

            const onConnect = () => {
                if (settled) return
                settled = true
                cleanup()
                resolve(true)
            }

            const timeout = setTimeout(() => {
                if (settled) return
                settled = true
                cleanup()
                resolve(false)
            }, Math.max(0, timeoutMs))

            this.socket.on('connect', onConnect)
        })
    }

    /** 连通性探测（flush 末尾：确认 daemon 真的收到了之前的 emit） */
    async ping(timeoutMs: number): Promise<boolean> {
        try {
            await this.socket.timeout(timeoutMs).emitWithAck('ping')
            return true
        } catch {
            return false
        }
    }

    disconnect(): void {
        this.clearManualReconnect()
        this.socket.disconnect()
    }

    private scheduleManualReconnect(reason: string): void {
        if (reason !== 'io server disconnect' || this.manualReconnectTimer) return
        const delay = this.manualReconnectDelayMs
        this.manualReconnectDelayMs = Math.min(this.manualReconnectDelayMs * 2, MANUAL_RECONNECT_MAX_DELAY_MS)
        logger.warn(`[API] Server-initiated disconnect, manual reconnect in ${delay}ms`)
        this.manualReconnectTimer = setTimeout(() => {
            this.manualReconnectTimer = null
            if (!this.socket.connected) this.socket.connect()
        }, delay)
        this.manualReconnectTimer.unref?.()
    }

    private clearManualReconnect(): void {
        if (this.manualReconnectTimer) {
            clearTimeout(this.manualReconnectTimer)
            this.manualReconnectTimer = null
        }
        this.manualReconnectDelayMs = MANUAL_RECONNECT_BASE_DELAY_MS
    }
}
