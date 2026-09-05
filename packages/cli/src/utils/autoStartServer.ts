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
 * CLI 启动早期的服务自动拉起（hub + runner），统一经 supervisor 托管。
 *
 * 收编背景：`hub start-sync` / `runner start-sync` 带 PPID 看门狗（父进程死亡即
 * 自杀），任何 detached spawn start-sync 并期望该进程比调用方活得更久的路径，
 * 都会在调用方退出后被看门狗杀掉。因此自动拉起一律改为
 * ensureSupervisorRunning + 控制指令，由 supervisor 作为父进程托管，
 * CLI 会话结束后 hub/runner 仍存活。
 *
 * 触发条件保持既有语义：
 * 1. MOBI_API_URL 未设置（使用默认 localhost）
 * 2. settings.cli.json 中存在 cliApiToken（hub 曾启动过）且未配置独立 apiUrl
 * 3. hub 未在运行（health 探测，而非旧的"端口被占用"近似判断）
 */

import chalk from 'chalk'
import { configuration } from '@/configuration'
import { readSettings } from '@/persistence'
import { ensureSupervisorRunning, sendControlCommand } from '@/supervisor/control'
import { logger } from '@/ui/logger'
import { isRunnerRunningCurrentlyInstalledMobiVersion } from '@/runner/controlClient'

/** hub /health 探测超时 */
const HEALTH_CHECK_TIMEOUT_MS = 1000

/**
 * start 类控制指令的客户端超时。
 * 服务端 start 的 hub 健康门最长 30s（HUB_HEALTH_TIMEOUT_MS），外加
 * ensureSupervisorRunning 的 spawn 就绪期；默认 10s 会在启动慢时假报失败
 * 而服务实际成功，故与 serviceOps 的 START_COMMAND_TIMEOUT_MS 对齐放宽到 60s。
 */
const START_COMMAND_TIMEOUT_MS = 60_000

/**
 * Check if hub is ready via health endpoint
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
 * Determine if hub should be auto-started
 */
async function shouldAutoStartServer(): Promise<boolean> {
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

    // 2b: cliApiToken exists in settings.cli.json (hub was previously started)
    if (!settings.cliApiToken) {
        logger.debug('[AUTO-START] No cliApiToken in settings, skipping auto-start')
        return false
    }

    // Condition 3: hub 已在运行（health 探测）则不重复拉起。
    // 旧实现用"默认端口被占用"近似，会被同端口的其他服务误判为已运行
    if (await checkServerHealth(configuration.apiUrl)) {
        logger.debug(`[AUTO-START] Hub already running at ${configuration.apiUrl}, skipping auto-start`)
        return false
    }

    return true
}

/**
 * Main entry point: auto-start hub (via supervisor) if conditions are met
 */
export async function maybeAutoStartServer(): Promise<void> {
    try {
        const shouldStart = await shouldAutoStartServer()
        if (!shouldStart) {
            return
        }

        logger.debug('[AUTO-START] Starting hub automatically...')
        console.log(chalk.gray('Starting MOBI hub in background...'))

        // hub 由 supervisor 托管：崩溃退避重启、CLI 退出后仍存活
        await ensureSupervisorRunning()
        // 服务端 start 应答即已过 hub 健康门，无需再轮询等待
        await sendControlCommand(
            configuration.supervisorSocketFile,
            { cmd: 'start', scope: 'hub' },
            START_COMMAND_TIMEOUT_MS
        )

        console.log(chalk.green('MOBI hub started'))
    } catch (error) {
        logger.debug('[AUTO-START] Error during hub auto-start', error)
        console.log(chalk.yellow('Warning: Failed to auto-start hub'))
        if (error instanceof Error) {
            console.log(chalk.gray(`  Error: ${error.message}`))
        }
        console.log(chalk.gray('  Try running `mobi hub start` manually to see errors'))
    }
}

/**
 * 确保 runner 在跑且为当前 CLI 版本，否则经 supervisor 拉起。
 *
 * 用于交互式 CLI 启动早期：失败绝不中断会话启动——仅记日志降级，
 * 后续 hub 连接失败会自然走本地模式等既有降级路径。
 * （旧实现 detached spawn `runner start-sync` + unref 期望 runner 比调用方
 * 活得更久，但 start-sync 的 PPID 看门狗会在调用方退出后将其杀掉，故收编。）
 */
export async function maybeAutoStartRunner(): Promise<void> {
    if (await isRunnerRunningCurrentlyInstalledMobiVersion()) {
        return
    }

    logger.debug('[AUTO-START] Starting mobi background service...')

    try {
        await ensureSupervisorRunning()
        await sendControlCommand(
            configuration.supervisorSocketFile,
            { cmd: 'start', scope: 'runner' },
            START_COMMAND_TIMEOUT_MS
        )
    } catch (error) {
        // 会话启动早期的自动拉起：静默降级，不中断
        logger.debug('[AUTO-START] Failed to start runner via supervisor, continuing without it', error)
    }
}
