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

/**
 * SSE 客户端，用于接收 Hub 服务器的实时事件
 * 使用 @microsoft/fetch-event-source 实现，支持自定义 headers 和状态码检测
 */
export class SSEClient {
    private listeners: Set<SyncEventListener> = new Set()
    private abortController: AbortController | null = null
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private reconnectDelay = 1000
    private isConnecting = false
    private hasConnected = false
    private isConnected = false

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

        this.disconnect()
        this.isConnecting = true
        this.abortController = new AbortController()

        try {
            await fetchEventSource(url, {
                signal: this.abortController.signal,
                onopen: async (response) => {
                    if (response.status === 401) {
                        // 认证失败，触发未授权回调
                        this.onUnauthorized?.()
                        throw new Error('Unauthorized')
                    }
                    if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`)
                    }

                    if (this.hasConnected) {
                        if (this.isConnected) {
                            // 静默断开重连：浏览器后台断开未触发 onerror/onclose，
                            // isConnected 仍为 true，需要先通知断连再通知重连
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
                        this.listeners.forEach(listener => listener(data))
                    } catch {
                        // ignore parse errors
                    }
                },
                onerror: (error) => {
                    // 返回重连延迟（毫秒），或抛出错误停止重连
                    console.error('SSE error:', error)
                    // 通知断开连接（仅首次断连时发射）
                    if (this.isConnected) {
                        this.isConnected = false
                        this.listeners.forEach(listener => listener({ type: 'connection-changed', connected: false }))
                    }
                    return this.reconnectDelay
                },
                onclose: () => {
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
            // 连接失败，尝试重连
            this.scheduleReconnect()
        } finally {
            this.isConnecting = false
        }
    }

    /**
     * 断开连接
     */
    disconnect(): void {
        if (this.abortController) {
            this.abortController.abort()
            this.abortController = null
        }
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
        // 重置状态
        this.reconnectDelay = 1000
        this.isConnecting = false
        this.hasConnected = false
        this.isConnected = false
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

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
            this.connect()
        }, this.reconnectDelay)
    }
}
