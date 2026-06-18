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

import { fetchEventSource } from '@microsoft/fetch-event-source'
import type { SyncEvent } from '@mobi/shared'

type SyncEventListener = (event: SyncEvent) => void
type UnauthorizedHandler = () => void

/** 3 个心跳周期(hub 每 30s 发心跳)无任何活动,视为连接半死(TCP 活着但无数据,移动端网络切换常见) */
const HEARTBEAT_STALE_MS = 90_000
/** 看门狗检查间隔,仅前台生效(hidden 跳过,避免移动端后台定时器节流误判) */
const WATCHDOG_INTERVAL_MS = 10_000
/** 重连退避基数 / 上限 / 抖动(对齐指数退避 + jitter,避免多端同时重连) */
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 30_000
const RECONNECT_JITTER_MS = 500

/**
 * SSE 客户端，用于接收 Hub 服务器的实时事件
 * 使用 @microsoft/fetch-event-source 实现，支持自定义 headers 和状态码检测
 *
 * 连接健康保障:
 * - 心跳看门狗:前台每 10s 检查,90s 无活动(半死)主动重连
 * - 回前台主动重连:页面从 hidden→visible 时,由 SSEProvider 调 reconnectIfStale() 立即检查
 */
export class SSEClient {
    private listeners: Set<SyncEventListener> = new Set()
    private abortController: AbortController | null = null
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    /** 连续重连失败次数(指数退避 2^attempt);成功 onopen 重置 */
    private reconnectAttempt = 0
    private isConnecting = false
    private hasConnected = false
    private isConnected = false
    /** 最近一次收到活动(任意事件,含 heartbeat)的时间戳;0 表示尚未建立连接 */
    private lastActivityAt = 0
    /** 本次连接周期内是否已请求重连(防 watchdog 与回前台叠加;onopen 重置) */
    private reconnectRequested = false
    /**
     * 连接代次:每次 connect 递增。finally/catch 仅处理属于当前代的连接,
     * 避免 forceReconnect 时旧连接(被 abort)的 finally 覆盖新连接的 isConnecting 状态。
     */
    private connectGeneration = 0
    /** 心跳看门狗定时器 */
    private watchdogTimer: ReturnType<typeof setInterval> | null = null

    constructor(
        private readonly getUrl: () => string | null,
        private readonly onUnauthorized?: UnauthorizedHandler
    ) {}

    /**
     * 连接到 SSE 端点
     */
    async connect(): Promise<void> {
        if (this.isConnecting) return

        const url = this.getUrl()
        if (!url) return

        // 仅清理传输层,保留 hasConnected(重连走 onopen 重连分支,发 reconnected 触发补拉漏数据)
        this.teardown()
        this.isConnecting = true
        // 标记本次连接的代次:旧连接被 abort 后其 finally/catch 不再触碰新连接的状态
        const generation = ++this.connectGeneration
        this.abortController = new AbortController()
        this.startWatchdog()

        try {
            await fetchEventSource(url, {
                signal: this.abortController.signal,
                // 页面切走（切 tab / 最小化 / 切 app 触发 visibilitychange）时保持连接不断开。
                // fetch-event-source 默认 openWhenHidden=false，会在页面 hidden 时主动 abort 连接，
                // 这是「切走即断」的根因。显式设为 true，使后台仍维持长连接。
                openWhenHidden: true,
                onopen: async (response) => {
                    if (response.status === 401) {
                        // 认证失败，触发未授权回调
                        this.onUnauthorized?.()
                        throw new Error('Unauthorized')
                    }
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`)
                    }

                    // 连接建立:重置重连守卫 + 活动时间 + 退避计数
                    this.reconnectRequested = false
                    this.reconnectAttempt = 0
                    this.lastActivityAt = Date.now()

                    if (this.hasConnected) {
                        if (import.meta.env.DEV) console.log('[SSE] onopen 重连', { silent: this.isConnected })
                        if (this.isConnected) {
                            // 静默断开重连：浏览器后台断开未触发 onerror/onclose，
                            // isConnected 仍为 true,先标记断开再通知,消除"已发 false 但内部仍 true"的窗口
                            this.isConnected = false
                            this.listeners.forEach(listener => listener({ type: 'connection-changed', connected: false }))
                        }
                        // 通知重连（无论是否静默断开）
                        this.isConnected = true
                        this.listeners.forEach(listener => listener({ type: 'connection-changed', connected: true, reconnected: true }))
                    } else {
                        // 首次连接
                        this.isConnected = true
                    }
                    this.hasConnected = true
                },
                onmessage: (event) => {
                    try {
                        const data = JSON.parse(event.data) as SyncEvent
                        // 任意事件(含 heartbeat)刷新活动时间,防止看门狗误判半死
                        this.lastActivityAt = Date.now()
                        this.listeners.forEach(listener => listener(data))
                    } catch {
                        // ignore parse errors
                    }
                },
                onerror: (error) => {
                    if (import.meta.env.DEV) console.log('[SSE] onerror', error)
                    // 通知断开连接（仅首次断连时发射）
                    if (this.isConnected) {
                        this.isConnected = false
                        this.listeners.forEach(listener => listener({ type: 'connection-changed', connected: false }))
                    }
                    // 抛错让库停止内部重连,统一走 connect catch → scheduleReconnect（指数退避 + jitter）
                    throw error
                },
                onclose: () => {
                    if (import.meta.env.DEV) console.log('[SSE] onclose 连接关闭')
                    // 通知断开连接（仅首次断连时发射）
                    if (this.isConnected) {
                        this.isConnected = false
                        this.listeners.forEach(listener => listener({ type: 'connection-changed', connected: false }))
                    }
                    // 连接关闭，尝试重连
                    this.scheduleReconnect()
                },
            })
        } catch {
            // 仅当本次连接仍是最新代时才调度重连(旧代被 abort/取代后不再驱动重连)
            if (generation === this.connectGeneration) this.scheduleReconnect()
        } finally {
            // 仅当本次连接仍是最新代时才复位 isConnecting,
            // 否则旧连接(被 abort)的 finally 会覆盖新连接的 isConnecting=true(见 forceReconnect 竞态)
            if (generation === this.connectGeneration) {
                this.isConnecting = false
            }
        }
    }

    /**
     * 断开连接并完全重置状态(用户主动断开/组件卸载)
     */
    disconnect(): void {
        this.teardown()
        this.stopWatchdog()
        this.reconnectAttempt = 0
        this.hasConnected = false
        this.isConnected = false
        this.lastActivityAt = 0
        this.reconnectRequested = false
    }

    /**
     * 清理传输层:abort 当前请求 + 清重连定时器。不重置 hasConnected/isConnected
     * (内部重连复用 connect 时需保留,使 onopen 走重连分支发 reconnected)
     */
    private teardown(): void {
        if (this.abortController) {
            this.abortController.abort()
            this.abortController = null
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
        this.isConnecting = false
    }

    /**
     * 订阅事件
     * @returns 取消订阅函数
     */
    subscribe(listener: SyncEventListener): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    /**
     * 调度重连
     */
    private scheduleReconnect(): void {
        if (this.reconnectTimer) return // 防止重复调度

        // 指数退避:delay = min(30s, 1s × 2^attempt) + 0~500ms jitter。
        // jitter 避免多端在服务重启时同时重连(thundering herd);attempt 连续失败递增,成功 onopen 重置。
        const baseDelay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * (2 ** this.reconnectAttempt))
        const jitter = Math.random() * RECONNECT_JITTER_MS
        if (import.meta.env.DEV) console.log(`[SSE] scheduleReconnect in ${baseDelay}ms(+${Math.round(jitter)}ms jitter)`)
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            this.reconnectAttempt++ // 下次失败退避加倍(成功 onopen 会重置)
            this.connect()
        }, baseDelay + jitter)
    }

    /**
     * 主动重连:断开半死连接并立即重连。
     * reconnectRequested 守卫防止 watchdog 与回前台在同次连接周期内叠加(onopen 重置)。
     * @returns 是否实际触发了重连(被守卫挡住则 false)
     */
    private forceReconnect(): boolean {
        if (this.reconnectRequested) return false
        this.reconnectRequested = true
        this.teardown()
        this.reconnectAttempt = 0
        void this.connect()
        return true
    }

    /**
     * 连接是否半死:曾建立连接且超过 HEARTBEAT_STALE_MS 无任何活动
     */
    isStale(): boolean {
        return this.lastActivityAt > 0 && Date.now() - this.lastActivityAt >= HEARTBEAT_STALE_MS
    }

    /**
     * 若连接半死则立即重连(回前台时主动检查用)
     * @returns 是否触发了重连
     */
    reconnectIfStale(): boolean {
        if (!this.isStale()) return false
        return this.forceReconnect()
    }

    /**
     * 启动心跳看门狗:前台每 WATCHDOG_INTERVAL_MS 检查,半死则 forceReconnect。
     * hidden 跳过(移动端后台定时器节流会误判);后台期间的半死由回前台逻辑兜底。
     */
    private startWatchdog(): void {
        this.stopWatchdog()
        this.watchdogTimer = setInterval(() => {
            if (document.hidden) return
            if (this.isStale()) {
                if (import.meta.env.DEV) console.log('[SSE] watchdog 检测到连接半死,主动重连')
                this.forceReconnect()
            }
        }, WATCHDOG_INTERVAL_MS)
    }

    private stopWatchdog(): void {
        if (this.watchdogTimer) {
            clearInterval(this.watchdogTimer)
            this.watchdogTimer = null
        }
    }
}
