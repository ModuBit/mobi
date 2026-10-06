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
 * `daemon start-sync` 进程编排（ticket-16 单进程化）。
 *
 * 本模块不改任何业务路径，只承担进程级职责（exit logger、信号、崩溃检测）：
 * Web/同步服务装配见 {@link ./server}，会话执行器见 {@link ./executor/lifecycle}。
 *
 * 关停顺序 = executor.stop → server.stop（会话宿主先行，服务殿后）。
 * state 文件：daemon.state.json（历史 daemon/runner state 文件已停写，
 * doctor/upgrader/e2e 脚本等读取方统一从 persistence 读 daemon 状态）。
 */

import { installExitLogger, installExitHandlers, resolveMobiLogsDir, isProcessAlive, type ExitLogger } from '@mobi/shared/exitLogger'
import { cleanupOldLogs } from '@mobi/shared/logger'
import { existsSync, readFileSync } from 'node:fs'
import { configuration } from '@mobi/node-core/configuration'
import {
    writeDaemonState,
    clearDaemonState,
    type DaemonLocallyPersistedState,
} from '@mobi/node-core/persistence'
import { logger } from '@mobi/node-core/logger'
import { daemonLogger } from './logger'
import { startServer, type ServerHandle } from './server'
import { startExecutor, ExecutorLockHeldError, type ExecutorHandle } from './executor/lifecycle'

export interface StartDaemonOptions {
    host?: string
    port?: number
}

function daemonStateFile(): string {
    return configuration.daemonStateFile
}

/**
 * 启动检测兜底：读 daemon.state.json，若上次实例 pid 已死则补记
 * killed-externally（覆盖 SIGKILL/OOM 等运行时来不及写记录的场景；
 * 优雅退出时 state 已被清理，不会误报）。
 */
function detectPreviousCrash(exitLogger: ExitLogger): void {
    if (!existsSync(daemonStateFile())) return
    try {
        const prev = JSON.parse(readFileSync(daemonStateFile(), 'utf-8')) as { pid?: number }
        if (typeof prev.pid === 'number' && prev.pid !== process.pid && !isProcessAlive(prev.pid)) {
            exitLogger.recordExternalKill(prev.pid)
        }
    } catch {
        // state 文件损坏，忽略
    }
}

export async function startDaemon(opts: StartDaemonOptions = {}): Promise<void> {
    // —— 退出日志合一（组件名 daemon）：原 hub/runner 的进程职责在此收口 ——
    // ringBuffer 注入 daemonLogger（daemon 主服务与执行器共用一个 logger，
    // 崩溃 dump 上下文同源）
    const exitLogger = installExitLogger('daemon', {
        logsDir: resolveMobiLogsDir(),
        ringBuffer: daemonLogger,
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

    logger.debug('[DAEMON] Starting daemon (web server + executor in one process)...')

    // 服务先起（executor 以宿主通道客户端身份连本进程，等 listen 就绪）
    const server: ServerHandle = await startServer(opts)
    logger.debug(`[DAEMON] Server ready on port ${server.port}`)

    // 再起执行器。若另一 daemon 实例还占着锁：静默退出让用户显式处理
    //（R4 旧锁活性检测在 acquireDaemonLock 内：活旧实例拒启，死锁清理后接管）
    let executor: ExecutorHandle
    try {
        // executor 运行时事实直写同进程 server（ticket-20 machine 通道删除后的本地直调）
        executor = await startExecutor({ updateExecutorState: (handler) => server.updateExecutorState(handler) })
    } catch (error) {
        if (error instanceof ExecutorLockHeldError) {
            logger.debug('[DAEMON] Another executor holds the lock; stopping server and exiting')
            await server.stop()
            console.log('Another daemon is already running. Stop it first (mobi daemon stop), then start the daemon again.')
            process.exit(0)
        }
        throw error
    }
    logger.debug(`[DAEMON] Executor ready (control port ${executor.httpPort})`)

    // 执行桥注入（ticket-18）：spawn 直调 + session-alive 驱动追踪补登
    server.setExecutorBridge(executor.bridge)
    logger.debug('[DAEMON] Executor session bridge wired to server')

    writeDaemonState({
        pid: process.pid,
        httpPort: server.port,
        hostPort: server.hostPort,
        controlPort: executor.httpPort,
        startTime: new Date().toLocaleString()
    } satisfies DaemonLocallyPersistedState)

    // 关停编排：先 executor（会话宿主）后 server（服务），幂等
    let shuttingDown = false
    const shutdown = async (exitCode: number) => {
        if (shuttingDown) return
        shuttingDown = true
        await executor.stop('os-signal').catch(() => {})
        await server.stop().catch(() => {})
        clearDaemonState()
        process.exit(exitCode)
    }

    process.on('SIGINT', () => void shutdown(0))
    process.on('SIGTERM', () => void shutdown(0))

    // executor 内部关停（control server 指令 / 心跳自杀）→ 整个 daemon 一起退
    // （同进程语义：executor 死即 daemon 死，supervisor 负责重拉）
    void executor.exited.then(({ source, errorMessage }) => {
        if (shuttingDown) return
        logger.debug(`[DAEMON] Executor requested shutdown (source: ${source}, errorMessage: ${errorMessage}), stopping daemon`)
        void shutdown(0)
    })

    logger.debug('[DAEMON] Daemon is ready!')

    await new Promise(() => {})
}

// 直接 `bun run src/daemonEntry.ts`（包 scripts.start/dev）时的自启；
// 常规路径是 CLI `mobi daemon start-sync` 动态 import startDaemon 调用
if (import.meta.main) {
    startDaemon().catch((error) => {
        daemonLogger.error('Fatal error:', error)
        process.exit(1)
    })
}
