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
 * Supervisor 托管状态机：daemon 子进程的 spawn/监控/退避重启/崩溃计数。
 *
 * 单被管组件（架构评审候选⑥票②特化）：ticket-22 起唯一托管组件就是 daemon
 * （历史 hub/runner 双组件已合并），本类不再保留多组件泛型形状——状态机
 * （desired 标志 / runtime 单槽 / env 单槽）与 API 都直接表达单组件事实。
 *
 * 设计约束：
 * - 本类不含任何业务逻辑（不碰 SQLite/网络/协议），spawn、时钟、崩溃日志
 *   全部由构造注入，保证可独立单测
 * - 编排（IPC、期望状态、健康门、孤儿清理）在 ./index.ts
 */

import { nextBackoffMs, nextCrashCount, shouldGiveUp } from './restartPolicy'
import { keepTail } from '@mobi/node-core/utils/keepTail'

export type ComponentStatus = 'stopped' | 'running' | 'backoff' | 'failed'

/** supervisor 眼中的子进程（与 ChildProcess 接口兼容，便于注入假对象） */
export interface ManagedProcess {
    pid?: number | undefined
    on(event: 'exit', listener: (code: number | null, signal: string | null) => void): void
    on(event: 'error', listener: (error: Error) => void): void
    stderr?: { on(event: 'data', listener: (chunk: Buffer) => void): void } | null | undefined
    kill(signal?: NodeJS.Signals): void
}

/** daemon 的托管状态报告（IPC `status` 指令 wire 形状见 index.ts：{ pid, daemon }） */
export interface DaemonStatusReport {
    /** 是否在期望托管集中 */
    managed: boolean
    status: ComponentStatus
    pid?: number
    consecutiveCrashes: number
}

export interface SupervisorDeps {
    spawn: (env: Record<string, string | undefined>) => ManagedProcess
    now: () => number
    writeCrashLog: (stderrTail: string) => void
}

export interface SupervisorHooks {
    /** 期望托管撤销（daemon 被显式 stop）时触发；supervisor 进程据此退出 */
    onEmpty: () => void
}

interface DaemonRuntime {
    process: ManagedProcess | null
    status: ComponentStatus
    startedAt: number
    consecutiveCrashes: number
    restartTimer: ReturnType<typeof setTimeout> | null
    /** SIGTERM 宽限升级定时器（见 terminateProcess） */
    killTimer: ReturnType<typeof setTimeout> | null
    stderrTail: string
    /** 显式 restart 触发的退出：不走崩溃计数，立即重拉 */
    restartOnExit: boolean
}

const MAX_STDERR_TAIL_CHARS = 8_000

/**
 * SIGTERM 宽限期：子进程挂起信号（如 SQLite 死循环、调试器断点暂停）时 exit
 * 永不到达，stop/shutdown 的状态机会卡死（finish 永不完成）。超时即升级
 * SIGKILL 强杀。正常优雅关闭（daemon 排水 + clearDaemonState）远快于此值不受影响
 * （见 docs/pending.md #46）。
 */
const KILL_GRACE_MS = 5_000

export class Supervisor {
    /** 期望托管标志（单组件：true = 应有 daemon 在跑） */
    private desired = false
    private runtime: DaemonRuntime | null = null
    private env: Record<string, string | undefined> | null = null
    private shuttingDown = false

    constructor(
        private readonly deps: SupervisorDeps,
        private readonly hooks: SupervisorHooks,
    ) {}

    /**
     * 托管并启动 daemon。真正在跑则幂等跳过（但刷新 env，供下次重拉使用）；
     * failed/backoff 态（崩溃放弃或退避等待中）显式 start 视为用户要求现在就绪
     * ——清崩溃计数立即重拉，否则 `mobi daemon start` 对 failed 组件是 no-op，
     * 自动拉起路径（ensureDaemonRunning）也永远救不活它。
     */
    start(env: Record<string, string | undefined> = process.env): void {
        if (this.shuttingDown) throw new Error('supervisor is shutting down')
        this.env = env
        if (this.desired) {
            const rt = this.ensureRuntime()
            if (rt.process) return
            if (rt.restartTimer) {
                clearTimeout(rt.restartTimer)
                rt.restartTimer = null
            }
            rt.consecutiveCrashes = 0
            this.spawnDaemon()
            return
        }
        this.desired = true
        this.spawnDaemon()
    }

    /** 显式停止 daemon：不触发崩溃重启；托管撤销时回调 onEmpty。 */
    stop(): void {
        if (!this.desired) return
        this.desired = false
        const rt = this.ensureRuntime()
        if (rt.restartTimer) {
            clearTimeout(rt.restartTimer)
            rt.restartTimer = null
        }
        rt.consecutiveCrashes = 0
        if (rt.process) {
            this.terminateProcess(rt)
            // exit 事件到达时 desired 已撤销 → 走"显式停止"分支
        } else {
            rt.status = 'stopped'
        }
        if (!this.desired && !this.shuttingDown) {
            this.hooks.onEmpty()
        }
    }

    /** 显式重启：重置崩溃计数，当前进程退出后立即重拉（不经退避）。 */
    restart(env?: Record<string, string | undefined>): void {
        if (this.shuttingDown) throw new Error('supervisor is shutting down')
        if (env) this.env = env
        const rt = this.ensureRuntime()
        rt.consecutiveCrashes = 0
        if (!this.desired) {
            this.desired = true
            this.spawnDaemon()
            return
        }
        if (rt.process) {
            rt.restartOnExit = true
            this.terminateProcess(rt)
        } else {
            // backoff/failed 态：清掉定时器，立即重拉
            if (rt.restartTimer) {
                clearTimeout(rt.restartTimer)
                rt.restartTimer = null
            }
            this.spawnDaemon()
        }
    }

    /**
     * 有序关停 daemon：保留 Promise 形态与 exit 事件驱动 + 宽限 SIGKILL 的既有保证。
     */
    shutdown(): Promise<void> {
        if (this.shuttingDown) return Promise.resolve()
        this.shuttingDown = true

        const rt = this.runtime
        if (rt?.restartTimer) {
            clearTimeout(rt.restartTimer)
            rt.restartTimer = null
        }
        const child = rt?.process

        return new Promise<void>((resolve) => {
            if (!child) {
                resolve()
                return
            }
            // exit 事件驱动停止（挂起时由宽限 SIGKILL 保证 exit 终会到达）
            child.on('exit', () => resolve())
            this.terminateProcess(rt)
        })
    }

    status(): DaemonStatusReport {
        const rt = this.runtime
        return {
            managed: this.desired,
            status: rt?.status ?? 'stopped',
            pid: rt?.process?.pid,
            consecutiveCrashes: rt?.consecutiveCrashes ?? 0,
        }
    }

    private spawnDaemon(): void {
        const rt = this.ensureRuntime()
        rt.status = 'running'
        rt.startedAt = this.deps.now()
        rt.stderrTail = ''
        rt.restartOnExit = false

        const child = this.deps.spawn(this.env ?? process.env)
        rt.process = child
        child.stderr?.on('data', (chunk: Buffer) => {
            rt.stderrTail = keepTail(rt.stderrTail + chunk.toString('utf8'), MAX_STDERR_TAIL_CHARS)
        })
        // 身份校验（对齐下方 error 回调）：rt.process 已换新（stop→start 竞态下重拉）
        // 或已清空（error 已处理过）时，旧子进程迟到的 exit 直接忽略——否则会把
        // 新进程引用清成幽灵，并按崩溃路径退避重拉，撞同一端口进入崩溃循环
        child.on('exit', () => {
            if (rt.process !== child) return
            this.handleExit()
        })
        // spawn 异步失败（二进制缺失/无权限等）只 emit error、不 emit exit：
        // 不监听会让组件永远卡在 running（无重启、无崩溃现场），且未监听的
        // error 事件会抛 uncaughtException 直接掀翻 supervisor。
        child.on('error', (error) => {
            // exit 已处理过（如对已退出进程 kill 迟到报 ESRCH）：忽略，防双计数
            if (rt.process !== child) return
            rt.stderrTail = keepTail(`${rt.stderrTail}\n[spawn error] ${error.message}`, MAX_STDERR_TAIL_CHARS)
            this.handleExit()
        })
    }

    /**
     * 发 SIGTERM 并布置宽限升级：KILL_GRACE_MS 内未退出则 SIGKILL 强杀，
     * 保证 stop/restart/shutdown 的状态机不会因子进程挂起信号而卡死。
     * 升级回调以 child 引用比对——exit 后重拉的新进程（rt.process 已换）
     * 不受迟到定时器误伤；handleExit 亦会清理定时器，双保险。
     */
    private terminateProcess(rt: DaemonRuntime): void {
        const child = rt.process
        if (!child) return
        if (rt.killTimer) clearTimeout(rt.killTimer)
        child.kill('SIGTERM')
        rt.killTimer = setTimeout(() => {
            rt.killTimer = null
            if (rt.process === child) {
                child.kill('SIGKILL')
            }
        }, KILL_GRACE_MS)
    }

    private handleExit(): void {
        const rt = this.runtime
        if (!rt) return
        rt.process = null
        if (rt.killTimer) {
            clearTimeout(rt.killTimer)
            rt.killTimer = null
        }

        // 显式 stop：desired 已撤销（stop() 先撤销再 kill）
        if (!this.desired) {
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
            this.spawnDaemon()
            return
        }

        // 崩溃计数与退避
        const ranMs = this.deps.now() - rt.startedAt
        rt.consecutiveCrashes = nextCrashCount(rt.consecutiveCrashes, ranMs)
        if (shouldGiveUp(rt.consecutiveCrashes)) {
            // 放弃自动重启。desired 保留：supervisor 自身重启（B 路径开机拉起）
            // 时给组件一次新机会；service status 如实显示 failed
            rt.status = 'failed'
            this.deps.writeCrashLog(rt.stderrTail)
            return
        }

        rt.status = 'backoff'
        const delay = nextBackoffMs(rt.consecutiveCrashes)
        rt.restartTimer = setTimeout(() => {
            rt.restartTimer = null
            if (this.desired && !this.shuttingDown) {
                this.spawnDaemon()
            }
        }, delay)
    }

    private ensureRuntime(): DaemonRuntime {
        if (!this.runtime) {
            this.runtime = {
                process: null,
                status: 'stopped',
                startedAt: 0,
                consecutiveCrashes: 0,
                restartTimer: null,
                killTimer: null,
                stderrTail: '',
                restartOnExit: false,
            }
        }
        return this.runtime
    }
}
