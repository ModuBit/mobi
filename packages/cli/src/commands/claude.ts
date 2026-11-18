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

import chalk from 'chalk'
import { PROTOCOL_VERSION } from '@mobi/shared'
import { configuration } from '@mobi/node-core/configuration'
import { initializeToken } from '@/ui/tokenInit'
import { ensureDaemonRunning } from '@/utils/autoStartServer'
import { extractErrorInfo } from '@mobi/node-core/utils/errorUtils'
import { isDaemonSpawnInvocation, parseStartOptions } from './claudeArgs'
import { DEFAULT_HELP_TEXT } from './defaultHelp'
import { formatProtocolVersionHint } from './protocolHint'
import type { CommandDefinition } from './types'

// 检测是否为网络连接错误
function isConnectionError(error: unknown): boolean {
    const { axiosCode, messageLower } = extractErrorInfo(error)
    return (
        axiosCode === 'ECONNREFUSED' ||
        axiosCode === 'ETIMEDOUT' ||
        axiosCode === 'ENOTFOUND' ||
        messageLower.includes('econnrefused') ||
        messageLower.includes('etimedout') ||
        messageLower.includes('enotfound') ||
        messageLower.includes('network error')
    )
}

export const claudeCommand: CommandDefinition = {
    name: 'default',
    requiresRuntimeAssets: true,
    run: async ({ commandArgs }) => {
        // 显式 'claude' 词已由 registry 剥掉（commandRoute），这里只收剩余参数
        const args = [...commandArgs]

        // 解析命令行参数（mobi 自身 flag + 透传给 claude code 的参数）
        const { options, showHelp, unknownArgs } = parseStartOptions(args)

        if (unknownArgs.length > 0) {
            // 透传给claude code的参数
            options.claudeArgs = [...(options.claudeArgs || []), ...unknownArgs]
        }

        // 无参或 --help：只显示 mobi 帮助。收敛后 CLI 不再隐式创建会话，
        // `mobi claude …` 保留为 daemon spawn 的内部入口（不出现在帮助里）
        if (showHelp || args.length === 0) {
            console.log(DEFAULT_HELP_TEXT)
            return
        }

        // 带参且非 daemon spawn（发现 A）：local 模式已移除，不再静默起托管会话——
        // 终端零输出零交互、token 照常消耗、idle 超时后进程静默退出，旧肌肉记忆
        // （mobi --continue）会被误认为卡死。内/外分界是 --started-by daemon 显式标记
        if (!isDaemonSpawnInvocation(options)) {
            console.error(chalk.red('在终端直接启动托管会话的入口已随 local 模式移除'))
            console.error(chalk.gray('  接续已有会话: mobi fork'))
            console.error(chalk.gray('  新会话请先从 Web UI 创建（fork 要求库中已有会话）'))
            process.exitCode = 1
            return
        }

        // 初始化 cli auth token
        await initializeToken()
        // 启动 mobi daemon（如果需要）——经 supervisor 托管，
        // CLI 会话结束后 daemon 继续存活以服务 Web 与管理会话
        await ensureDaemonRunning()
        try {
            const { runClaude } = await import('@mobi/session/claude/runClaude')
            await runClaude(options)
        } catch (error) {
            const { message, messageLower, axiosCode: _axiosCode, httpStatus, responseErrorText, serverProtocolVersion } = extractErrorInfo(error)

            // 连接错误：会话必须由 daemon 驱动（local 模式已退场，不再降级裸跑 claude）
            if (isConnectionError(error)) {
                console.error(chalk.red('Unable to connect to Mobi daemon'))
                console.error(chalk.gray(`   daemon URL: ${configuration.apiUrl}`))
                console.error(chalk.gray('   终端接续已有会话请用: mobi fork'))
            } else if (httpStatus === 403 && responseErrorText === 'Session access denied') {
                console.error(chalk.red('Session access denied.'))
                console.error(chalk.gray('  This session belongs to a different namespace.'))
                console.error(chalk.gray('  Use the matching CLI_API_TOKEN or switch namespaces.'))
            } else if (
                httpStatus === 401 ||
                httpStatus === 403 ||
                messageLower.includes('unauthorized') ||
                messageLower.includes('forbidden')
            ) {
                console.error(chalk.red('Authentication error:'), message)
                console.error(chalk.gray('  Run: mobi auth login'))
            } else {
                console.error(chalk.red('Error:'), message)
            }

            const protocolHint = formatProtocolVersionHint(serverProtocolVersion, PROTOCOL_VERSION)
            if (protocolHint) {
                console.error(chalk.yellow(protocolHint))
            }

            if (process.env.DEBUG) {
                console.error(error)
            }
            process.exit(1)
        }
    }
}
