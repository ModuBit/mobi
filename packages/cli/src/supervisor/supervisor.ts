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
 * Supervisor 托管状态机：hub/runner 子进程的 spawn/监控/退避重启/崩溃计数。
 *
 * 设计约束：
 * - 本类不含任何业务逻辑（不碰 SQLite/网络/协议），spawn、时钟、崩溃日志
 *   全部由构造注入，保证可独立单测
 * - 编排（IPC、期望状态、健康门、孤儿清理）在 ./index.ts
 */

import { nextBackoffMs, nextCrashCount, shouldGiveUp } from './restartPolicy'

export type ComponentName = 'hub' | 'runner'
export type ComponentStatus = 'stopped' | 'running' | 'backoff' | 'failed'

/** supervisor 眼中的子进程（与 ChildProcess 接口兼容，便于注入假对象） */
export interface ManagedProcess {
    pid?: number | undefined
    on(event: 'exit', listener: (code: number | null, signal: string | null) => void): void
    stderr?: { on(event: 'data', listener: (chunk: Buffer) => void): void } | undefined
    kill(signal?: NodeJS.Signals): void
}

export interface ComponentStatusReport {
    name: ComponentName
    /** 是否在期望托管集中 */
    managed: boolean
    status: ComponentStatus
    pid?: number
    consecutiveCrashes: number
}

export interface SupervisorDeps {
    spawn: (name: ComponentName, env: Record<string, string | undefined>) => ManagedProcess
    now: () => number
    writeCrashLog: (name: ComponentName, stderrTail: string) => void
}

export interface SupervisorHooks {
    /** 期望托管集清空（hub/runner 均被显式 stop）时触发；supervisor 进程据此退出 */
    onEmpty: () => void
}

interface ComponentRuntime {
    process: ManagedProcess | null
    status: ComponentStatus
    startedAt: number
    consecutiveCrashes: number
    restartTimer: ReturnType<typeof setTimeout> | null
    stderrTail: string
    /** 显式 restart 触发的退出：不走崩溃计数，立即重拉 */
    restartOnExit: boolean
}

const MAX_STDERR_TAIL_CHARS = 8_000

export class Supervisor {
    private readonly desired = new Set<ComponentName>()
    private readonly runtimes = new Map<ComponentName, ComponentRuntime>()
    private readonly envs = new Map<ComponentName, Record<string, string | undefined>>()
    private shuttingDown = false
    /** shutdown 过程中等待退出的组件队列（保证先 runner 后 hub） */
    private shutdownQueue: ComponentName[] = []

    constructor(
        private readonly deps: SupervisorDeps,
        private readonly hooks: SupervisorHooks,
    ) {}

    /** 托管并启动一个组件。已在托管集中则幂等跳过。 */
    start(name: ComponentName, env: Record<string, string | undefined> = process.env): void {
        if (this.shuttingDown) throw new Error('supervisor is shutting down')
        if (this.desired.has(name)) return
        this.desired.add(name)
        this.envs.set(name, env)
        this.spawnComponent(name)
    }

    /** 显式停止一个组件：不触发崩溃重启；托管集清空时回调 onEmpty。 */
    stop(name: ComponentName): void {
        if (!this.desired.has(name)) return
        this.desired.delete(name)
        const rt = this.ensureRuntime(name)
        if (rt.restartTimer) {
            clearTimeout(rt.restartTimer)
            rt.restartTimer = null
        }
        rt.consecutiveCrashes = 0
        if (rt.process) {
            rt.process.kill('SIGTERM')
            // exit 事件到达时 desired 已不含 name → 走"显式停止"分支
        } else {
            rt.status = 'stopped'
        }
        if (this.desired.size === 0 && !this.shuttingDown) {
            this.hooks.onEmpty()
        }
    }

    /** 显式重启：重置崩溃计数，当前进程退出后立即重拉（不经退避）。 */
    restart(name: ComponentName, env?: Record<string, string | undefined>): void {
        if (this.shuttingDown) throw new Error('supervisor is shutting down')
        if (env) this.envs.set(name, env)
        const rt = this.ensureRuntime(name)
        rt.consecutiveCrashes = 0
        if (!this.desired.has(name)) {
            this.desired.add(name)
            this.spawnComponent(name)
            return
        }
        if (rt.process) {
            rt.restartOnExit = true
            rt.process.kill('SIGTERM')
        } else {
            // backoff/failed 态：清掉定时器，立即重拉
            if (rt.restartTimer) {
                clearTimeout(rt.restartTimer)
                rt.restartTimer = null
            }
            this.spawnComponent(name)
        }
    }

    /**
     * 有序关停全部组件：先 runner 后 hub。
     * 同步发起对 runner 的停止，其后每个组件 exit 后再停下一个。
     * 返回的 Promise 在全部组件退出后 resolve。
     */
    shutdown(): Promise<void> {
        if (this.shuttingDown) return Promise.resolve()
        this.shuttingDown = true

        const order: ComponentName[] = ['runner', 'hub']
        this.shutdownQueue = order.filter((name) => {
            const rt = this.runtimes.get(name)
            if (!rt) return false
            if (rt.restartTimer) {
                clearTimeout(rt.restartTimer)
                rt.restartTimer = null
            }
            return Boolean(rt.process)
        })

        return new Promise<void>((resolve) => {
            const stopNext = () => {
                const name = this.shutdownQueue.shift()
                if (!name) {
                    resolve()
                    return
                }
                const rt = this.runtimes.get(name)!
                const process = rt.process
                if (!process) {
                    stopNext()
                    return
                }
                // exit 事件驱动串行停止
                process.on('exit', () => stopNext())
                process.kill('SIGTERM')
            }
            stopNext()
        })
    }

    status(): Record<ComponentName, ComponentStatusReport> {
        const reportFor = (name: ComponentName): ComponentStatusReport => {
            const rt = this.runtimes.get(name)
            return {
                name,
                managed: this.desired.has(name),
                status: rt?.status ?? 'stopped',
                pid: rt?.process?.pid,
                consecutiveCrashes: rt?.consecutiveCrashes ?? 0,
            }
        }
        return { hub: reportFor('hub'), runner: reportFor('runner') }
    }

    private spawnComponent(name: ComponentName): void {
        const rt = this.ensureRuntime(name)
        rt.status = 'running'
        rt.startedAt = this.deps.now()
        rt.stderrTail = ''
        rt.restartOnExit = false

        const child = this.deps.spawn(name, this.envs.get(name) ?? process.env)
        rt.process = child
        child.stderr?.on('data', (chunk: Buffer) => {
            const combined = rt.stderrTail + chunk.toString('utf8')
            rt.stderrTail =
                combined.length > MAX_STDERR_TAIL_CHARS
                    ? combined.slice(-MAX_STDERR_TAIL_CHARS)
                    : combined
        })
        child.on('exit', () => this.handleExit(name))
    }

    private handleExit(name: ComponentName): void {
        const rt = this.runtimes.get(name)
        if (!rt) return
        rt.process = null

        // 显式 stop：desired 已不含该组件（stop() 先删再 kill）
        if (!this.desired.has(name)) {
            rt.status = 'stopped'
            return
        }

        // shutdown 发起的停止：不算崩溃、不计数、不退避
        if (this.shuttingDown) {
            rt.status = 'stopped'
            return
        }

        // 显式 restart：立即重拉，不走崩溃计数
        if (rt.restartOnExit) {
            rt.restartOnExit = false
            rt.consecutiveCrashes = 0
            // restart 与 shutdown 竞态：kill 后、exit 派发前调用了 shutdown()，
            // 此时不再重拉（否则 shutdown 期间拉起的新子进程成孤儿）。
            // 注：上方 shuttingDown 守卫已拦截此场景，此处校验是防御性文档。
            if (this.shuttingDown) {
                rt.status = 'stopped'
                return
            }
            this.spawnComponent(name)
            return
        }

        // 崩溃计数与退避
        const ranMs = this.deps.now() - rt.startedAt
        rt.consecutiveCrashes = nextCrashCount(rt.consecutiveCrashes, ranMs)
        if (shouldGiveUp(rt.consecutiveCrashes)) {
            // 放弃自动重启。desired 保留：supervisor 自身重启（B 路径开机拉起）
            // 时给组件一次新机会；service status 如实显示 failed
            rt.status = 'failed'
            this.deps.writeCrashLog(name, rt.stderrTail)
            return
        }

        rt.status = 'backoff'
        const delay = nextBackoffMs(rt.consecutiveCrashes)
        rt.restartTimer = setTimeout(() => {
            rt.restartTimer = null
            if (this.desired.has(name) && !this.shuttingDown) {
                this.spawnComponent(name)
            }
        }, delay)
    }

    private ensureRuntime(name: ComponentName): ComponentRuntime {
        let rt = this.runtimes.get(name)
        if (!rt) {
            rt = {
                process: null,
                status: 'stopped',
                startedAt: 0,
                consecutiveCrashes: 0,
                restartTimer: null,
                stderrTail: '',
                restartOnExit: false,
            }
            this.runtimes.set(name, rt)
        }
        return rt
    }
}
