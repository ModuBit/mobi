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
 * CLI 启动早期的 daemon 自动拉起，统一经 supervisor 托管。
 *
 * [归属标记] personal-agent-rewrite：依赖 supervisor/control（属 cli 侧职责），
 * 不随 utils 其余部分归 node-core——ticket-14 挪 cli 包。
 *
 * 收编背景：`daemon start-sync` 带 PPID 看门狗（父进程死亡即自杀），任何
 * detached spawn start-sync 并期望该进程比调用方活得更久的路径，都会在调用方
 * 退出后被看门狗杀掉。因此自动拉起一律 ensureSupervisorRunning + 控制指令，
 * 由 supervisor 作为父进程托管，CLI 会话结束后 daemon 仍存活。
 *
 * ticket-22 合并：旧 maybeAutoStartServer（探 hub 健康）+ maybeAutoStartRunner
 *（探 runner 进程/版本）合为单组件 ensureDaemonRunning——daemon 同进程含
 * hub+runner，一次拉起即全量就绪；旧 runner 的「二进制 mtime 版本比对」随
 * mtime 自重启删除（升级路径由 upgrader 走 service restart 替换整个 daemon）。
 *
 * 触发条件保持既有语义：
 * 1. MOBI_API_URL 未设置（使用默认本机 daemon）
 * 2. settings.cli.json 中存在 cliApiToken（daemon 曾启动过）且未配置独立 apiUrl
 * 3. daemon 未在运行（daemon.state.json pid 存活 + /health 探测）
 */

import chalk from 'chalk'
import { configuration } from '@mobi/node-core/configuration'
import { readSettings, readDaemonState } from '@mobi/node-core/persistence'
import { ensureSupervisorRunning, sendControlCommand } from '@/supervisor/control'
import { logger } from '@mobi/node-core/logger'
import { isProcessAlive } from '@mobi/node-core/utils/process'

/** daemon /health 探测超时 */
const HEALTH_CHECK_TIMEOUT_MS = 1000

/**
 * start 类控制指令的客户端超时。
 * 服务端 start 的健康门最长 30s（HUB_HEALTH_TIMEOUT_MS），外加
 * ensureSupervisorRunning 的 spawn 就绪期；默认 10s 会在 daemon 启动慢时
 * 假报失败而服务实际成功，故与 serviceOps 的 START_COMMAND_TIMEOUT_MS 对齐放宽到 60s。
 */
const START_COMMAND_TIMEOUT_MS = 60_000

/**
 * Check if daemon is ready via health endpoint
 */
async function checkServerHealth(url: string): Promise<boolean> {
    try {
        const response = await fetch(`${url}/health`, {
            signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS)
        })
        return response.ok
    } catch {
        return false
    }
}

/**
 * Determine if daemon should be auto-started
 */
async function shouldAutoStartDaemon(): Promise<boolean> {
    // Condition 1: MOBI_API_URL not set (using default localhost)
    if (process.env.MOBI_API_URL) {
        logger.debug('[AUTO-START] MOBI_API_URL is set, skipping auto-start')
        return false
    }

    // Condition 2: Check settings.cli.json
    const settings = await readSettings()

    // 2a: apiUrl is set in settings.cli.json (user configured a specific hub)
    if (settings.apiUrl || settings.serverUrl) {
        logger.debug('[AUTO-START] apiUrl is set in settings.cli.json, skipping auto-start')
        return false
    }

    // 2b: cliApiToken exists in settings.cli.json (daemon was previously started)
    if (!settings.cliApiToken) {
        logger.debug('[AUTO-START] No cliApiToken in settings, skipping auto-start')
        return false
    }

    // Condition 3: daemon 已在运行（state pid 存活 + health 探测）则不重复拉起。
    // pid 存活但 health 失败（进程挂起/半死）不在此处抢救——交由 supervisor 的
    // 崩溃重启与用户显式 restart 处理，避免 CLI 侧越权重启用户正在排障的进程
    const state = await readDaemonState()
    if (state && isProcessAlive(state.pid) && (await checkServerHealth(configuration.apiUrl))) {
        logger.debug(`[AUTO-START] Daemon already running (PID ${state.pid}), skipping auto-start`)
        return false
    }

    return true
}

/**
 * Main entry point: auto-start daemon (via supervisor) if conditions are met
 */
export async function ensureDaemonRunning(): Promise<void> {
    try {
        const shouldStart = await shouldAutoStartDaemon()
        if (!shouldStart) {
            return
        }

        logger.debug('[AUTO-START] Starting daemon automatically...')
        console.log(chalk.gray('Starting MOBI daemon in background...'))

        // daemon 由 supervisor 托管：崩溃退避重启、CLI 退出后仍存活
        await ensureSupervisorRunning()
        // 服务端 start 应答即已过健康门，无需再轮询等待
        await sendControlCommand(
            configuration.supervisorSocketFile,
            { cmd: 'start', scope: 'daemon' },
            START_COMMAND_TIMEOUT_MS
        )

        console.log(chalk.green('MOBI daemon started'))
    } catch (error) {
        logger.debug('[AUTO-START] Error during daemon auto-start', error)
        console.log(chalk.yellow('Warning: Failed to auto-start daemon'))
        if (error instanceof Error) {
            console.log(chalk.gray(`  Error: ${error.message}`))
        }
        console.log(chalk.gray('  Try running `mobi daemon start` manually to see errors'))
    }
}
