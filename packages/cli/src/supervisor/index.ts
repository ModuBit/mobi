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
 * Supervisor 进程编排入口（`mobi service supervise --sync`）。
 *
 * 职责：幂等启动守卫 → 绑定控制 socket 占锁（bind 失败探活决定退让/夺回）→
 * 孤儿清理 → 恢复期望状态 → 常驻等待指令；信号/指令触发时有序关停。
 * A 路径下由 CLI（ensureSupervisorRunning）spawn；B 路径下由
 * launchd/systemd 直接 ExecStart。
 */

import { unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { configuration } from '@mobi/node-core/configuration'
import { logger } from '@mobi/node-core/logger'
import { spawnMobiCli } from '@mobi/node-core/utils/spawnMobiCli'
import { isUrlOk, waitForUrlOk } from '@mobi/node-core/utils/httpHealth'
import { Supervisor } from './supervisor'
import {
    startControlServer,
    sendControlCommand,
    type ControlRequest,
    type ControlServer,
} from './control'
import { defaultDesiredState, readDesiredState, writeDesiredState } from './desiredState'
import { cleanupOrphans } from './orphanCleanup'

/** supervisor 启动时若期望托管集为空，等待首条指令的宽限时间 */
const IDLE_EXIT_MS = 30_000

/** daemon 健康检查超时 */
const HUB_HEALTH_TIMEOUT_MS = 30_000

export async function runSupervisor(): Promise<void> {
    logger.debug(`[SUPERVISOR] Starting (PID ${process.pid})`)

    // 0. 幂等启动守卫：socket 已有应答说明已有 supervisor 在跑，
    //    本进程直接退出（防 ensureSupervisorRunning 并发 spawn 竞态 / launchd 拉起重叠）
    try {
        await sendControlCommand(configuration.supervisorSocketFile, { cmd: 'status' }, 1_000)
        logger.debug('[SUPERVISOR] Another supervisor already running, exiting')
        process.exit(0)
    } catch {
        // 无应答（连接失败/超时）→ socket 是残留文件或不存在，继续启动
    }

    // 1. 编排状态
    const desired = readDesiredState() ?? defaultDesiredState()
    let everManaged = false
    let finished = false
    let idleTimer: ReturnType<typeof setTimeout> | null = null

    const crashLogPath = join(configuration.logsDir, 'daemon-crash.log')

    const supervisor = new Supervisor(
        {
            spawn: (env) =>
                spawnMobiCli(['daemon', 'start-sync'], {
                    // 不 detach：子进程 ppid 指向 supervisor，PPID 看门狗才能感知 supervisor 死亡
                    // stderr 管道用于崩溃现场落盘
                    stdio: ['ignore', 'ignore', 'pipe'],
                    env,
                }),
            now: () => Date.now(),
            writeCrashLog: (tail) => {
                try {
                    writeFileSync(
                        crashLogPath,
                        `${new Date().toISOString()}\n\n${tail}`,
                        'utf8',
                    )
                    logger.debug(`[SUPERVISOR] daemon crash log written: ${crashLogPath}`)
                } catch (error) {
                    logger.debug('[SUPERVISOR] Failed to write daemon crash log', error)
                }
            },
        },
        {
            onEmpty: () => {
                // 托管集清空：退出（退出码 0，launchd KeepAlive SuccessfulExit=false / systemd on-failure 不拉空壳）
                logger.debug('[SUPERVISOR] Desired set empty, exiting')
                void finish(0)
            },
        },
    )

    // 2. 绑定控制 socket（占锁）。bind 失败 ≠ 无 supervisor（可能是并发冷启动中
    //    的先起者）：探活有应答则退让，无应答则为残留文件，unlink 后重试一次。
    //    持锁成功后才具备孤儿清理资格，杜绝"守卫探活→unlink"之间数秒 TOCTOU 窗口
    const server = await bindControlServer()
    logger.debug(`[SUPERVISOR] Control server listening: ${configuration.supervisorSocketFile}`)

    // 3. 孤儿清理：清掉上次残留的 daemon
    await cleanupOrphans()

    // 注意：必须是函数声明（提升）而非 const 箭头函数——控制 socket 在孤儿清理前
    // 就已 bind（bind 占锁），清理 await 期间事件循环放开，IPC 指令可能在下方
    // const 初始化前到达，箭头函数会触发 TDZ（"Cannot access before initialization"）
    function daemonHealthUrl(): string {
        return `http://${desired.host}:${desired.port}/health`
    }

    function daemonEnv(): Record<string, string | undefined> {
        return {
            ...process.env,
            MOBI_LISTEN_HOST: desired.host,
            MOBI_LISTEN_PORT: String(desired.port),
        }
    }

    /**
     * 等 daemon 就绪：观察到 pid 翻转到新实例且健康检查通过。
     * restart 场景旧实例在 SIGTERM 排水期仍可能应答 /health，仅凭健康检查会
     * 提前放行（随后旧实例死亡），故必须同时观察到 pid 变化。
     */
    async function waitForDaemonHealthyAfterRespawn(prevPid: number | undefined): Promise<boolean> {
        const deadline = Date.now() + HUB_HEALTH_TIMEOUT_MS
        while (Date.now() < deadline) {
            const pid = supervisor.status().pid
            if (pid !== undefined && pid !== prevPid && (await isUrlOk(daemonHealthUrl()))) {
                return true
            }
            await new Promise((resolve) => setTimeout(resolve, 200))
        }
        return false
    }

    /**
     * 启动/重启 daemon 并等待健康。期望状态先落盘再过健康门：
     * 健康门 throw 时 Supervisor 内部已托管该组件，持久层必须同步为 true，
     * 否则 supervisor 重启后不恢复（状态分叉）。
     *
     * - daemon 在跑且本次变更了 host/port：start 对 running 组件是幂等跳过，不会
     *   应用新配置（新端口健康门必失败 + 期望状态与实际分叉——supervisor 重启
     *   后组件会意外换端口），降级为 restart 语义
     * - daemon 在跑且未变更配置（幂等 start）：旧实例即目标，直接健康门
     */
    async function launchDaemonAndWait(mode: 'start' | 'restart', configChanged: boolean): Promise<void> {
        const report = supervisor.status()
        const alreadyRunning = desired.daemon && report.status === 'running'
        const needsRespawn = mode === 'restart' || (configChanged && alreadyRunning)
        const prevPid = report.pid

        if (needsRespawn) {
            supervisor.restart(daemonEnv())
        } else {
            supervisor.start(daemonEnv())
        }
        desired.daemon = true
        everManaged = true
        writeDesiredState(desired)

        const healthy =
            alreadyRunning && !needsRespawn
                ? await waitForUrlOk(daemonHealthUrl(), HUB_HEALTH_TIMEOUT_MS)
                : await waitForDaemonHealthyAfterRespawn(prevPid)
        if (!healthy) {
            throw new Error(`daemon ${needsRespawn ? 'restarted' : 'started'} but health check failed`)
        }
    }

    async function handleRequest(request: ControlRequest): Promise<unknown> {
        // scope 是纯客户端侧类型、协议无 zod 校验，单组件模型下统一落到 daemon
        switch (request.cmd) {
            case 'start':
            case 'restart': {
                const mode = request.cmd
                const prevHost = desired.host
                const prevPort = desired.port
                if ('host' in request && request.host) desired.host = request.host
                if ('port' in request && request.port) desired.port = request.port
                const configChanged = desired.host !== prevHost || desired.port !== prevPort
                await launchDaemonAndWait(mode, mode === 'restart' ? false : configChanged)
                return { pid: process.pid, daemon: supervisor.status() }
            }
            case 'stop': {
                supervisor.stop()
                desired.daemon = false
                writeDesiredState(desired)
                return { pid: process.pid, daemon: supervisor.status() }
            }
            case 'status':
                return { pid: process.pid, daemon: supervisor.status() }
            case 'shutdown':
                void finish(0)
                return { stopping: true }
        }
    }

    async function finish(exitCode: number): Promise<void> {
        if (finished) return
        finished = true
        if (idleTimer) clearTimeout(idleTimer)
        await supervisor.shutdown()
        // 宏任务屏障：让处理中的 IPC 响应（微任务链上的 socket.write）先落盘，
        // 避免 server.stop() 抢跑销毁 socket 导致客户端误报失败
        await new Promise((resolve) => setImmediate(resolve))
        await server.stop()
        logger.debug(`[SUPERVISOR] Exiting with code ${exitCode}`)
        process.exit(exitCode)
    }

    process.on('SIGTERM', () => void finish(0))
    process.on('SIGINT', () => void finish(0))
    process.on('uncaughtException', (error) => {
        // 至少落 stderr：launchd/systemd 会接管到 supervisor-stderr.log，
        // 否则生产环境 supervisor 濒死时完全无感知
        console.error('[SUPERVISOR] Uncaught exception, exiting', error)
        void finish(1)
    })

    /**
     * 尝试绑定控制 socket；bind 失败时探活决定退让或夺回，最多重试一次：
     * - 有应答 → 先起者赢，本进程退让退出
     * - 无应答 → socket 是上次异常退出的残留文件，unlink 后重试
     * - 重试仍失败 → 无法占锁，放弃启动
     */
    async function bindControlServer(): Promise<ControlServer> {
        try {
            return await startControlServer(configuration.supervisorSocketFile, (request) =>
                handleRequest(request),
            )
        } catch {
            // bind 失败：socket 路径已被占用（活 supervisor 持有 / 残留文件）
            try {
                await sendControlCommand(configuration.supervisorSocketFile, { cmd: 'status' }, 1_000)
                logger.debug('[SUPERVISOR] Another supervisor already running, exiting')
                process.exit(0)
            } catch {
                unlinkSync(configuration.supervisorSocketFile)
            }
            try {
                return await startControlServer(configuration.supervisorSocketFile, (request) =>
                    handleRequest(request),
                )
            } catch (retryError) {
                logger.debug('[SUPERVISOR] Failed to bind control socket, giving up', retryError)
                process.exit(1)
            }
        }
    }

    // 4. 恢复期望状态（B 路径开机自启 = 恢复停机前配置）。
    if (desired.daemon) {
        supervisor.start(daemonEnv())
        everManaged = true
        const healthy = await waitForUrlOk(daemonHealthUrl(), HUB_HEALTH_TIMEOUT_MS)
        if (!healthy) logger.debug('[SUPERVISOR] daemon not healthy after restore, continuing')
    } else if (!everManaged) {
        // 空期望启动（A 路径：ensureSupervisorRunning 先 spawn 再发指令）：
        // 给首条指令留宽限窗口，避免 supervisor 抢跑退出造成竞态
        idleTimer = setTimeout(() => {
            if (!everManaged && !finished) {
                logger.debug('[SUPERVISOR] Idle (no desired components), exiting')
                void finish(0)
            }
        }, IDLE_EXIT_MS)
        idleTimer.unref?.()
    }

    writeDesiredState(desired)
}
