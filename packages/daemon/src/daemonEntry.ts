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
 * `daemon start-sync` 进程编排（ticket-16）：hub 与 runner 同进程。
 *
 * 本模块不改任何业务路径，只验证「同进程」本身——hub/runner 各自的生命周期
 * 核心见 {@link ./hubServer} 与 {@link ./runner/run}，这里承担此前两个入口
 * 薄壳各自的进程级职责（exit logger、信号、崩溃检测），合一为组件名 `daemon`。
 *
 * 关停顺序 = runner.stop → hub.stop（会话宿主先行，服务殿后）。
 * state 文件：新写 `daemon.state.json`；hub/runner 侧的 state 文件由各自
 * core 继续写（doctor、upgrader、e2e 脚本仍在读，22 票再收）。
 */

import { installExitLogger, installExitHandlers, resolveMobiLogsDir, isProcessAlive, type ExitLogger } from '@mobi/shared/exitLogger'
import { cleanupOldLogs } from '@mobi/shared/logger'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { configuration } from '@mobi/node-core/configuration'
import { logger } from '@mobi/node-core/logger'
import { hubLogger } from './logger'
import { startHub, type HubHandle } from './hubServer'
import { startRunnerCore, RunnerLockHeldError, type RunnerHandle } from './runner/run'

export interface StartDaemonOptions {
    host?: string
    port?: number
}

interface DaemonPersistedState {
    pid: number
    hubPort: number
    runnerHttpPort: number
    startTime: string
}

function daemonStateFile(): string {
    return join(configuration.mobiHomeDir, 'daemon.state.json')
}

function writeDaemonState(state: DaemonPersistedState): void {
    writeFileSync(daemonStateFile(), JSON.stringify(state, null, 2), 'utf-8')
}

function clearDaemonState(): void {
    if (existsSync(daemonStateFile())) {
        try {
            unlinkSync(daemonStateFile())
        } catch {
            // 清理失败不阻塞退出
        }
    }
}

/**
 * 启动检测兜底（与 hub 薄壳同源）：读 hub.state.json，若上次实例 pid 已死则
 * 补记 killed-externally。runner 侧的检测并入此处（同一进程，一份就够）。
 */
function detectPreviousCrash(exitLogger: ExitLogger): void {
    if (!existsSync(configuration.hubStateFile)) return
    try {
        const prev = JSON.parse(readFileSync(configuration.hubStateFile, 'utf-8')) as { pid?: number }
        if (typeof prev.pid === 'number' && prev.pid !== process.pid && !isProcessAlive(prev.pid)) {
            exitLogger.recordExternalKill(prev.pid)
        }
    } catch {
        // state 文件损坏，忽略
    }
}

export async function startDaemon(opts: StartDaemonOptions = {}): Promise<void> {
    // —— 退出日志合一（组件名 daemon）：hub/runner 的进程职责在此收口 ——
    // ringBuffer 注入 hubLogger（hub 是 daemon 的主服务；runner 的 logger
    // 独立写文件，崩溃 dump 上下文以 hub 侧为准）
    const exitLogger = installExitLogger('daemon', {
        logsDir: resolveMobiLogsDir(),
        ringBuffer: hubLogger,
    })
    installExitHandlers('daemon', exitLogger, undefined, {
        // 崩溃（uncaught/unhandled，由上面的 handlers 记录并 exit）时保留
        // daemon.state.json 供下次 detectPreviousCrash 检出；正常/信号退出时清理
        onExitSync: ({ crashed }) => {
            if (!crashed) clearDaemonState()
        },
    })
    detectPreviousCrash(exitLogger)
    cleanupOldLogs(resolveMobiLogsDir())

    logger.debug('[DAEMON] Starting daemon (hub + runner in one process)...')

    // hub 先起（runner 以 socket 客户端身份连本进程 hub，等 listen 就绪）
    const hub: HubHandle = await startHub(opts)
    logger.debug(`[DAEMON] Hub ready on port ${hub.port}`)

    // 再起 runner。若旧形态 runner（独立进程）还在占锁：静默退出让用户显式
    // 切换（`mobi runner stop` 后再起 daemon）；升级路径下版本不匹配的旧
    // runner 由 CLI start 命令先行替换，这里不越权重写
    let runner: RunnerHandle
    try {
        runner = await startRunnerCore()
    } catch (error) {
        if (error instanceof RunnerLockHeldError) {
            logger.debug('[DAEMON] Another runner holds the lock; stopping hub and exiting')
            await hub.stop()
            console.log('Another runner is already running. Stop it first (mobi runner stop), then start the daemon again.')
            process.exit(0)
        }
        throw error
    }
    logger.debug(`[DAEMON] Runner ready (control port ${runner.httpPort})`)

    writeDaemonState({
        pid: process.pid,
        hubPort: hub.port,
        runnerHttpPort: runner.httpPort,
        startTime: new Date().toLocaleString()
    })

    // 关停编排：先 runner（会话宿主）后 hub（服务），幂等
    let shuttingDown = false
    const shutdown = async (exitCode: number) => {
        if (shuttingDown) return
        shuttingDown = true
        await runner.stop('os-signal').catch(() => {})
        await hub.stop().catch(() => {})
        clearDaemonState()
        process.exit(exitCode)
    }

    process.on('SIGINT', () => void shutdown(0))
    process.on('SIGTERM', () => void shutdown(0))

    // runner 内部关停（control server 指令 / 心跳自杀）→ 整个 daemon 一起退
    // （同进程语义：runner 死即 daemon 死，supervisor 负责重拉）
    void runner.exited.then(({ source, errorMessage }) => {
        if (shuttingDown) return
        logger.debug(`[DAEMON] Runner requested shutdown (source: ${source}, errorMessage: ${errorMessage}), stopping daemon`)
        void shutdown(0)
    })

    logger.debug('[DAEMON] Daemon is ready!')

    await new Promise(() => {})
}
