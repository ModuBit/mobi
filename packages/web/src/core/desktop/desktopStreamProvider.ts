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
 * Desktop 流 Provider（app 层常驻，模块单例）。
 *
 * 按 machineId 持有一条观看连接：noVNC 实例注入 Provider 自有的 canvas 容器，
 * 展示面（inspector tab / 独立页）通过 lease.attachTo 把容器 DOM 搬迁进自己的
 * host——切换展示面连接不动（禁止卸载重挂 noVNC，其实例终态永久不可复用）。
 * 生命周期：引用计数对称增减，归零起 30s 宽限（期内重挂复用），宽限满断开；
 * 仍有引用时异常断开自动重走 watch（幂等恢复，退避重试覆盖 cli 离线）。
 *
 * 刻意不进 React state：连接对象与 DOM 节点是非响应式资源，React 层仅经
 * useSyncExternalStore 订阅 phase 变化用于展示。
 */

import { connectDesktopView, defaultRfbLoader, type DesktopViewConnection, type RfbLoader } from './desktopStreamClient'
import { createMobiApi } from '@/core/data/api/client'

/** 引用归零后的宽限期：期内重新 acquire 复用连接，期满断开（GC 兜底） */
export const DESKTOP_STREAM_GRACE_MS = 30_000

/** watch/连接失败的退避重试节奏 */
const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 30_000

export interface DesktopStreamState {
    phase: 'connecting' | 'connected' | 'error'
    /** phase='error'：面向用户的归因文案（原始 reason） */
    message?: string
}

/** getState 的稳定空态引用（phase 不变不得换引用，否则 useSyncExternalStore 死循环） */
const IDLE_STATE: DesktopStreamState = { phase: 'connecting' }

export interface DesktopStreamLease {
    /** 把观看画面容器搬迁进 host（切换展示面时连接不动；后 attach 者持有画面） */
    attachTo(host: HTMLElement): void
    /** 引用计数 -1；归零起 30s 宽限，宽限满断开 */
    release(): void
}

interface StreamEntry {
    /** Provider 自有的画面容器（noVNC 向其注入 canvas） */
    container: HTMLDivElement
    connection: DesktopViewConnection | null
    refs: number
    graceTimer?: ReturnType<typeof setTimeout>
    retryTimer?: ReturnType<typeof setTimeout>
    retryAttempt: number
    /** 连接代际：重连后旧连接的异步回调不得污染新连接状态 */
    generation: number
    /** 稳定引用的快照（useSyncExternalStore 依赖） */
    state: DesktopStreamState
}

interface ProviderDeps {
    /** watch 凭据获取（React 层注入 useMobiApi 的 desktop.watch） */
    watch: (machineId: string) => Promise<string>
    loader?: RfbLoader
}

export class DesktopStreamProvider {
    private streams = new Map<string, StreamEntry>()
    private listeners = new Set<() => void>()

    constructor(private readonly deps: ProviderDeps) {}

    /** React 层订阅（useSyncExternalStore 的 subscribe 入参） */
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    /** 稳定快照：无 stream 返回共享常量，phase 不变时返回同一引用 */
    getState = (machineId: string): DesktopStreamState => {
        return this.streams.get(machineId)?.state ?? IDLE_STATE
    }

    acquire(machineId: string): DesktopStreamLease {
        let entry = this.streams.get(machineId)
        if (entry) {
            entry.refs += 1
            // 宽限期内重挂：取消 GC 定时器，复用既有连接
            if (entry.graceTimer) {
                clearTimeout(entry.graceTimer)
                entry.graceTimer = undefined
            }
        } else {
            entry = {
                container: document.createElement('div'),
                connection: null,
                refs: 1,
                retryAttempt: 0,
                generation: 0,
                state: IDLE_STATE,
            }
            entry.container.style.width = '100%'
            entry.container.style.height = '100%'
            this.streams.set(machineId, entry)
            void this.connect(machineId)
        }
        return this.makeLease(machineId)
    }

    private makeLease(machineId: string): DesktopStreamLease {
        return {
            attachTo: (host) => {
                const entry = this.streams.get(machineId)
                if (!entry) return
                host.appendChild(entry.container)
                // DOM 搬迁后容器尺寸可能变化，通知 noVNC 重算 scaleViewport
                window.dispatchEvent(new Event('resize'))
            },
            release: () => {
                const entry = this.streams.get(machineId)
                if (!entry || entry.refs <= 0) return
                entry.refs -= 1
                if (entry.refs === 0) {
                    entry.container.remove()
                    entry.graceTimer = setTimeout(() => this.destroy(machineId), DESKTOP_STREAM_GRACE_MS)
                }
            },
        }
    }

    /** 建立一条观看连接（watch 换 token → noVNC 连 observe WS） */
    private async connect(machineId: string): Promise<void> {
        const entry = this.streams.get(machineId)
        if (!entry) return
        entry.generation += 1
        const generation = entry.generation
        this.setState(machineId, { phase: 'connecting' })

        try {
            const token = await this.deps.watch(machineId)
            if (generation !== this.streams.get(machineId)?.generation) return

            const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
            const url = `${proto}://${window.location.host}/desktop/observe?token=${encodeURIComponent(token)}`
            const connection = await connectDesktopView({
                url,
                container: entry.container,
                loader: this.deps.loader ?? defaultRfbLoader,
                callbacks: {
                    onConnect: () => {
                        if (generation !== this.streams.get(machineId)?.generation) return
                        entry.retryAttempt = 0
                        this.setState(machineId, { phase: 'connected' })
                    },
                    onDisconnect: ({ clean }) => {
                        if (generation !== this.streams.get(machineId)?.generation) return
                        entry.connection = null
                        // 仍有引用的异常断开（锁屏/网络/会话被抢占）→ 自动重走 watch；
                        // clean 断开来自主动 disconnect（宽限 GC），不重连
                        if (!clean && entry.refs > 0) {
                            void this.connect(machineId)
                        }
                    },
                    onFailure: (message) => {
                        if (generation !== this.streams.get(machineId)?.generation) return
                        // 认证失败等协议失败：展示归因，不自动重试（重试无意义）
                        this.setState(machineId, { phase: 'error', message })
                    },
                },
            })
            if (generation !== this.streams.get(machineId)?.generation) {
                connection.disconnect()
                return
            }
            entry.connection = connection
        } catch (error) {
            if (generation !== this.streams.get(machineId)?.generation) return
            this.setState(machineId, {
                phase: 'error',
                message: error instanceof Error ? error.message : String(error),
            })
            this.scheduleRetry(machineId)
        }
    }

    /** watch 失败的退避重试：tab 存活期间（refs>0）持续恢复 */
    private scheduleRetry(machineId: string): void {
        const entry = this.streams.get(machineId)
        if (!entry || entry.retryTimer || entry.refs === 0) return
        const delay = Math.min(RETRY_BASE_MS * 2 ** entry.retryAttempt, RETRY_MAX_MS)
        entry.retryAttempt += 1
        entry.retryTimer = setTimeout(() => {
            entry.retryTimer = undefined
            if (entry.refs > 0) void this.connect(machineId)
        }, delay)
    }

    /** 宽限满/显式销毁：断开连接、清定时器、移除 entry */
    private destroy(machineId: string): void {
        const entry = this.streams.get(machineId)
        if (!entry) return
        if (entry.graceTimer) clearTimeout(entry.graceTimer)
        if (entry.retryTimer) clearTimeout(entry.retryTimer)
        entry.connection?.disconnect()
        this.streams.delete(machineId)
        this.notify()
    }

    private setState(machineId: string, next: DesktopStreamState): void {
        const entry = this.streams.get(machineId)
        if (!entry) return
        // 只在内容变化时换引用（保持 snapshot 稳定）
        if (entry.state.phase === next.phase && entry.state.message === next.message) return
        entry.state = next
        this.notify()
    }

    private notify(): void {
        for (const listener of this.listeners) listener()
    }

    /** 测试与热更新兜底：销毁全部 stream */
    dispose(): void {
        for (const machineId of Array.from(this.streams.keys())) {
            this.destroy(machineId)
        }
        this.listeners.clear()
    }
}

/** app 级单例：watch 走全局 api client（cookie 链路无 token 依赖，实例全局单例） */
export const desktopStreamProvider = new DesktopStreamProvider({
    watch: (machineId) => createMobiApi().desktop.watch(machineId).then(({ data }) => data.observeToken),
})
