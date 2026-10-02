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
 * Mobi Hub - `hub start-sync` 进程入口（薄壳）。
 *
 * hub 本体的装配与生命周期在 {@link ./hubServer}（ticket-16 拆出），
 * 本文件只承担进程级职责：exit logger、信号处理、上次崩溃检测、旧日志
 * 清理与进程驻留。`hub start-sync` 行为与拆分前完全一致。
 */

import { installExitLogger, installExitHandlers, resolveMobiLogsDir, resolveMobiHome, isProcessAlive, type ExitLogger } from '@mobi/shared/exitLogger'
import { cleanupOldLogs } from '@mobi/shared/logger'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hubLogger } from './logger'
import { clearHubState } from './config/hubState'
import { startHub, type HubHandle } from './hubServer'

/**
 * 启动检测兜底：读 hub.state.json，若上次实例 pid 已死则补记 killed-externally。
 * 覆盖 SIGKILL / OOM / 段错误等 JS 运行时来不及写记录的场景。
 */
function detectPreviousHubCrash(logger: ExitLogger): void {
    const stateFile = join(resolveMobiHome(), 'hub.state.json')
    if (!existsSync(stateFile)) return
    try {
        const prev = JSON.parse(readFileSync(stateFile, 'utf-8')) as { pid?: number; startTime?: string }
        if (typeof prev.pid === 'number' && prev.pid !== process.pid && !isProcessAlive(prev.pid)) {
            logger.recordExternalKill(prev.pid, prev.startTime)
        }
    } catch {
        // state 文件损坏，忽略
    }
}

async function main() {
    // —— 退出日志：最早挂载，确保后续配置加载失败也能捕获 ——
    // hubLogger 的 ringBuffer 注入 exitLogger，崩溃 dump 可还原崩溃前上下文
    const hubExitLogger = installExitLogger('hub', {
        logsDir: resolveMobiLogsDir(),
        ringBuffer: hubLogger,
    })
    // hub.state.json 的 dataDir 在 config 就绪后才确定，用容器延迟绑定
    // （const 对象，属性修改不触发 prefer-const）
    const exitCtx: { dataDir: string | undefined } = { dataDir: undefined }
    installExitHandlers('hub', hubExitLogger, undefined, {
        // 信号终止时 SIGTERM handler 偶发不触发（Bun 仅走默认退出），
        // exit handler 是兜底时机 —— 正常/信号退出时同步清理 state，避免幽灵 pid 残留。
        // 崩溃（uncaught/unhandled）时跳过清理：保留 state 让下次 detectPreviousHubCrash 能检出
        // （SIGKILL/OOM 进程直接消失、state 本就保留；本分支补齐可捕获的崩溃路径）
        onExitSync: ({ crashed }) => {
            if (!crashed && exitCtx.dataDir) clearHubState(exitCtx.dataDir)
        },
    })
    // —— OOM/SIGKILL 兜底：检测上次 hub 实例是否异常消失 ——
    detectPreviousHubCrash(hubExitLogger)
    // —— 启动清理旧日志（超 7 天 / 单类超 50 个），createLogger 默认不清理 ——
    cleanupOldLogs(resolveMobiLogsDir())

    const handle: HubHandle = await startHub()

    // dataDir 由 handle 暴露（config 就绪后才有），绑定给 exit handler 的
    // onExitSync：正常/信号退出时同步清理 state，避免幽灵 pid 残留
    exitCtx.dataDir = handle.dataDir

    const shutdown = async () => {
        await handle.stop()
        process.exit(0)
    }

    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)

    await new Promise(() => {})
}

main().catch((error) => {
    hubLogger.error('Fatal error:', error)
    process.exit(1)
})
