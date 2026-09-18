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
import { desktopCloseAttributionByCode, desktopWsOrigin, type DesktopControlResponse, type DesktopControlState, type DesktopWatchResponse } from '@mobi/shared'
import { KEYSYM } from '@/domain/desktop/touchInput'

/** 引用归零后的宽限期：期内重新 acquire 复用连接，期满断开（GC 兜底） */
export const DESKTOP_STREAM_GRACE_MS = 30_000

/** watch/连接失败的退避重试节奏 */
const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 30_000

export interface DesktopStreamState {
    phase: 'connecting' | 'connected' | 'error'
    /** 控制权状态（迭代 2）：hub 权威，经授予/退出 API 与 SSE desktop-control-changed 对齐 */
    control: DesktopControlState
    /** 首帧是否已到达：RFB 连接建立到首帧渲染间有黑屏窗口（大分辨率首帧洪峰） */
    firstFrame: boolean
    /** phase='error'：面向用户的归因文案（原始 reason） */
    message?: string
}

/** getState 的稳定空态引用（phase 不变不得换引用，否则 useSyncExternalStore 死循环） */
const IDLE_STATE: DesktopStreamState = { phase: 'connecting', control: 'view-only', firstFrame: false }

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
    /** watch 凭据获取（React 层注入 useMobiApi 的 desktop.watch）；响应含控制权权威初值 */
    watch: (machineId: string) => Promise<DesktopWatchResponse>
    /** 控制权授予/退出（迭代 2）；测试可不注入 */
    grantControl?: (machineId: string) => Promise<DesktopControlResponse>
    releaseControl?: (machineId: string) => Promise<DesktopControlResponse>
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
                // 尺寸重算由挂载方的 ResizeObserver 经 resize() 精确通知
                // （ResizeObserver 初次 observe 即回调，无需额外派发）
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
        // 首帧信号随连接代际重置：重连后黑屏窗口重新存在
        this.setState(machineId, { phase: 'connecting', firstFrame: false })

        try {
            const watch = await this.deps.watch(machineId)
            if (generation !== this.streams.get(machineId)?.generation) return

            // 控制权权威初值随 watch 响应交付：每个连接代际以服务端值重置本地状态，
            // 禁止重放上一条流的快照（控制权随观看流生命周期存亡，权限边界在 hub）。
            // 同一流内的后续变化仍由授予/退出 API 与 SSE 事件对齐
            this.setState(machineId, { control: watch.control })

            // 与 terminal 同模式：dev/e2e 直连 hub（__MOBI_HUB_URL__），生产 undefined 落回同源
            // （raw WS 不过 Vite 代理；代理转发会带来升级/缓冲的额外变量）
            const hubOrigin = desktopWsOrigin(__MOBI_HUB_URL__ ?? window.location.origin)
            const url = `${hubOrigin}/desktop/observe?token=${encodeURIComponent(watch.observeToken)}`
            const connection = await connectDesktopView({
                url,
                container: entry.container,
                loader: this.deps.loader ?? defaultRfbLoader,
                callbacks: {
                    onConnect: () => {
                        if (generation !== this.streams.get(machineId)?.generation) return
                        entry.retryAttempt = 0
                        // 按本代际 watch 交付的权威值恢复 noVNC 只读
                        this.applyControl(machineId, entry.state.control)
                        this.setState(machineId, { phase: 'connected' })
                    },
                    onFirstFrame: () => {
                        if (generation !== this.streams.get(machineId)?.generation) return
                        this.setState(machineId, { firstFrame: true })
                    },
                    onDisconnect: ({ clean, close }) => {
                        if (generation !== this.streams.get(machineId)?.generation) return
                        entry.connection = null
                        // 归因明确的关闭（查到注册表条目且不可重连：抢占/关流/上游不可用）：
                        // 展示归因，绝不自动重连（重连即抢占回旋镖、无视用户关流、
                        // 或对「屏幕共享没开」无限循环）。查不到条目（peer gone/协议错）＝网络类
                        const attribution = close ? desktopCloseAttributionByCode(close.code) : null
                        if (attribution && !attribution.retryable) {
                            this.setState(machineId, { phase: 'error', message: attribution.prose })
                            return
                        }
                        // 网络类断开（锁屏/掉线）且仍有引用 → 退避重连（不走立即重连，
                        // 防上游侧持续失败时的快速 watch/反连循环）
                        if (!clean && entry.refs > 0) {
                            this.scheduleRetry(machineId)
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

    private setState(machineId: string, next: Partial<DesktopStreamState>): void {
        const entry = this.streams.get(machineId)
        if (!entry) return
        const merged: DesktopStreamState = { ...entry.state, ...next }
        // 只在内容变化时换引用（保持 snapshot 稳定）
        if (entry.state.phase === merged.phase && entry.state.message === merged.message && entry.state.control === merged.control && entry.state.firstFrame === merged.firstFrame) return
        entry.state = merged
        this.notify()
    }

    /**
     * 控制权状态对齐（hub 权威）：授予/退出动作的响应与 SSE desktop-control-changed
     * 事件（超时回落等）同走此入口——UI 不自持权威状态。
     */
    private applyControl(machineId: string, control: DesktopControlState): void {
        const entry = this.streams.get(machineId)
        if (!entry) return
        entry.connection?.setViewOnly(control !== 'controlled')
        this.setState(machineId, { control })
    }

    /** 「接管控制」按钮直授：调授予 API 后按 hub 返回对齐 */
    async grantControl(machineId: string): Promise<void> {
        const response = await this.deps.grantControl?.(machineId)
        if (response) this.applyControl(machineId, response.control)
    }

    /** 「退出控制」；错误向上抛给调用方展示 */
    async releaseControl(machineId: string): Promise<void> {
        const response = await this.deps.releaseControl?.(machineId)
        if (response) this.applyControl(machineId, response.control)
    }

    /** SSE 事件接入（SSEProvider 分发；空闲超时回落等 hub 侧变化） */
    ingestControlEvent(machineId: string, control: DesktopControlState): void {
        this.applyControl(machineId, control)
    }

    /** 展示面容器尺寸变化：通知该 machine 的连接重算 scaleViewport（精确单播，不广播 window resize） */
    resize(machineId: string): void {
        this.streams.get(machineId)?.connection?.requestResize()
    }

    // —— 移动端触摸输入桥（迭代 2；仅 controlled 下由 UI 调用，hub 侧仍是权威边界） ——

    /** 敲一个键（可带挂起修饰键组合：mods 按下 → 敲键 → mods 释放） */
    tapKey(machineId: string, keysym: number, mods: number[] = []): void {
        this.withMods(machineId, mods, (connection) => connection.sendKey(keysym))
    }

    /** 连续退格（哨兵 diff 出的删除动作）：修饰键整段只按/放一次，N 个退格共用 */
    sendBackspaces(machineId: string, count: number, mods: number[] = []): void {
        this.withMods(machineId, mods, (connection) => {
            for (let i = 0; i < count; i++) {
                connection.sendKey(KEYSYM.BACKSPACE)
            }
        })
    }

    /** 发送文本（软键盘桥：哨兵 diff 出的插入内容） */
    sendText(machineId: string, text: string, mods: number[] = []): void {
        if (!text) return
        this.withMods(machineId, mods, (connection) => connection.sendText(text))
    }

    /** 修饰键组合的统一括号：mods 按下 → 动作 → mods 反序释放（顺序约定只此一处） */
    private withMods(machineId: string, mods: number[], action: (connection: DesktopViewConnection) => void): void {
        const connection = this.streams.get(machineId)?.connection
        if (!connection) return
        for (const keysymOfMod of mods) connection.sendKey(keysymOfMod, true)
        action(connection)
        for (const keysymOfMod of [...mods].reverse()) connection.sendKey(keysymOfMod, false)
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

/** app 级单例：api client 惰性建一次（含 axios 实例装配），重连路径不重复构造 */
let apiClient: ReturnType<typeof createMobiApi> | null = null
const getApiClient = (): ReturnType<typeof createMobiApi> => (apiClient ??= createMobiApi())
export const desktopStreamProvider = new DesktopStreamProvider({
    watch: (machineId) => getApiClient().desktop.watch(machineId).then(({ data }) => data),
    grantControl: (machineId) => getApiClient().desktop.grantControl(machineId).then(({ data }) => data),
    releaseControl: (machineId) => getApiClient().desktop.releaseControl(machineId).then(({ data }) => data),
})
