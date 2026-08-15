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
 * 职责：幂等启动守卫 → 孤儿清理 → IPC server → 恢复期望状态 → 常驻等待指令；
 * 信号/指令触发时有序关停。
 * A 路径下由 CLI（ensureSupervisorRunning）spawn；B 路径下由
 * launchd/systemd 直接 ExecStart。
 */

import { existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { configuration } from '@/configuration'
import { logger } from '@/ui/logger'
import { spawnMobiCli } from '@/utils/spawnMobiCli'
import { waitForUrlOk } from '@/utils/httpHealth'
import { Supervisor } from './supervisor'
import { startControlServer, sendControlCommand, type ControlRequest } from './control'
import { defaultDesiredState, readDesiredState, writeDesiredState } from './desiredState'
import { cleanupOrphans } from './orphanCleanup'

/** supervisor 启动时若期望托管集为空，等待首条指令的宽限时间 */
const IDLE_EXIT_MS = 30_000

/** hub 健康检查超时 */
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

    // 1. 孤儿清理：清掉上次残留的 hub/runner
    await cleanupOrphans()

    // 2. 清理残留 socket 文件（上次异常退出会留下）
    if (existsSync(configuration.supervisorSocketFile)) {
        unlinkSync(configuration.supervisorSocketFile)
    }

    // 3. 编排状态
    const desired = readDesiredState() ?? defaultDesiredState()
    let everManaged = false
    let finished = false
    let idleTimer: ReturnType<typeof setTimeout> | null = null

    const crashLogPath = (name: 'hub' | 'runner') => join(configuration.logsDir, `${name}-crash.log`)

    const supervisor = new Supervisor(
        {
            spawn: (name, env) =>
                spawnMobiCli([name, 'start-sync'], {
                    // 不 detach：子进程 ppid 指向 supervisor，PPID 看门狗才能感知 supervisor 死亡
                    // stderr 管道用于崩溃现场落盘
                    stdio: ['ignore', 'ignore', 'pipe'],
                    env,
                }),
            now: () => Date.now(),
            writeCrashLog: (name, tail) => {
                try {
                    writeFileSync(
                        crashLogPath(name),
                        `${new Date().toISOString()}\n\n${tail}`,
                        'utf8',
                    )
                    logger.debug(`[SUPERVISOR] ${name} crash log written: ${crashLogPath(name)}`)
                } catch (error) {
                    logger.debug(`[SUPERVISOR] Failed to write ${name} crash log`, error)
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

    // 4. IPC server
    const server = await startControlServer(configuration.supervisorSocketFile, (request) =>
        handleRequest(request),
    )
    logger.debug(`[SUPERVISOR] Control server listening: ${configuration.supervisorSocketFile}`)

    const hubHealthUrl = () => `http://${desired.host}:${desired.port}/health`

    const hubEnv = (): Record<string, string | undefined> => ({
        ...process.env,
        MOBI_LISTEN_HOST: desired.host,
        MOBI_LISTEN_PORT: String(desired.port),
    })

    async function handleRequest(request: ControlRequest): Promise<unknown> {
        switch (request.cmd) {
            case 'start': {
                if (request.host) desired.host = request.host
                if (request.port) desired.port = request.port

                const targets: Array<'hub' | 'runner'> =
                    request.scope === 'both' ? ['hub', 'runner'] : [request.scope]

                for (const target of targets) {
                    if (target === 'runner') {
                        // runner 依赖 hub：hub 在期望托管集时必须先等 hub 健康
                        if (desired.hub) {
                            const healthy = await waitForUrlOk(hubHealthUrl(), HUB_HEALTH_TIMEOUT_MS)
                            if (!healthy) throw new Error('hub is not healthy, refusing to start runner')
                        }
                        supervisor.start('runner', process.env)
                    } else {
                        supervisor.start('hub', hubEnv())
                        const healthy = await waitForUrlOk(hubHealthUrl(), HUB_HEALTH_TIMEOUT_MS)
                        if (!healthy) throw new Error('hub started but health check failed')
                    }
                    desired[target] = true
                    everManaged = true
                }
                writeDesiredState(desired)
                return supervisor.status()
            }
            case 'stop': {
                const targets: Array<'hub' | 'runner'> =
                    request.scope === 'both' ? ['hub', 'runner'] : [request.scope]
                for (const target of targets) {
                    supervisor.stop(target)
                    desired[target] = false
                }
                writeDesiredState(desired)
                return supervisor.status()
            }
            case 'restart': {
                if (request.host) desired.host = request.host
                if (request.port) desired.port = request.port
                const targets: Array<'hub' | 'runner'> =
                    request.scope === 'both' ? ['runner', 'hub'] : [request.scope]
                for (const target of targets) {
                    supervisor.restart(target, target === 'hub' ? hubEnv() : process.env)
                }
                writeDesiredState(desired)
                return supervisor.status()
            }
            case 'status':
                return { pid: process.pid, ...supervisor.status() }
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
        await server.stop()
        logger.debug(`[SUPERVISOR] Exiting with code ${exitCode}`)
        process.exit(exitCode)
    }

    process.on('SIGTERM', () => void finish(0))
    process.on('SIGINT', () => void finish(0))
    process.on('uncaughtException', (error) => {
        logger.debug('[SUPERVISOR] Uncaught exception', error)
        void finish(1)
    })

    // 5. 恢复期望状态（B 路径开机自启 = 恢复停机前配置）
    if (desired.hub || desired.runner) {
        if (desired.hub) {
            supervisor.start('hub', hubEnv())
            everManaged = true
            await waitForUrlOk(hubHealthUrl(), HUB_HEALTH_TIMEOUT_MS)
        }
        if (desired.runner) {
            supervisor.start('runner', process.env)
            everManaged = true
        }
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
