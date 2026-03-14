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

import type { SyncEvent } from '@mobi/shared'

type SyncEventListener = (event: SyncEvent) => void

/**
 * SSE 客户端，用于接收 Hub 服务器的实时事件
 */
export class SSEClient {
    private eventSource: EventSource | null = null
    private listeners: Set<SyncEventListener> = new Set()
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private reconnectDelay = 1000

    constructor(
        private readonly getUrl: () => string | null
    ) {}

    /**
     * 连接到 SSE 端点
     */
    connect(): void {
        const url = this.getUrl()
        if (!url) return

        this.disconnect()
        this.eventSource = new EventSource(url)

        this.eventSource.onmessage = (e) => {
            try {
                const event = JSON.parse(e.data) as SyncEvent
                this.listeners.forEach(listener => listener(event))
            } catch {
                // ignore parse errors
            }
        }

        this.eventSource.onerror = () => {
            this.disconnect()
            this.scheduleReconnect()
        }
    }

    /**
     * 断开连接
     */
    disconnect(): void {
        this.eventSource?.close()
        this.eventSource = null
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
        // 重置重连延迟
        this.reconnectDelay = 1000
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
        this.reconnectTimer = setTimeout(() => {
            this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
            this.connect()
        }, this.reconnectDelay)
    }
}
