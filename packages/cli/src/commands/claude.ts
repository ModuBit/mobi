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
import { execFileSync, spawn } from 'node:child_process'
import { PROTOCOL_VERSION } from '@mobi/shared'
import type { StartOptions } from '@/claude/runClaude'
import { configuration } from '@/configuration'
import { authAndSetupMachineIfNeeded } from '@/ui/auth'
import { logger } from '@/ui/logger'
import { initializeToken } from '@/ui/tokenInit'
import { maybeAutoStartServer, maybeAutoStartRunner } from '@/utils/autoStartServer'
import { withBunRuntimeEnv } from '@/utils/bunRuntime'
import { extractErrorInfo } from '@/utils/errorUtils'
import { getClaudeExecutablePath } from '@/claude/sdk/claudeExecutable'
import { parseStartOptions } from './claudeArgs'
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

// 降级到纯本地模式（直接运行 claude）
async function runLocalMode(options: StartOptions): Promise<void> {
    console.log(chalk.yellow('⚠️  Running in local-only mode (no Hub connection)'))
    console.log(chalk.gray('   Remote control features are disabled.\n'))

    if (options.projectId) {
        // 项目归属需要 Hub 连接（校验 machineId / folders 并冻结），离线降级时无法生效
        console.warn(chalk.yellow('⚠️  Hub 不可达，--project 已忽略'))
        console.warn(chalk.gray('   Project membership requires a Hub connection.\n'))
    }

    const claudeArgs = [...(options.claudeArgs || [])]

    // 添加权限模式
    if (options.permissionMode === 'bypassPermissions') {
        if (!claudeArgs.includes('--dangerously-skip-permissions')) {
            claudeArgs.push('--dangerously-skip-permissions')
        }
    }

    // 添加模型
    if (options.model && !claudeArgs.some(arg => arg === '--model' || arg === '-m')) {
        claudeArgs.push('--model', options.model)
    }

    if (options.effort && !claudeArgs.some(arg => arg === '--effort')) {
        claudeArgs.push('--effort', options.effort)
    }

    logger.debug(`[LOCAL] Starting Claude with args:`, claudeArgs)

    // 直接启动 claude 进程（dev 模式回退 PATH 上的 claude）
    const claudeCommand = (await getClaudeExecutablePath()) ?? 'claude'
    const claudeProcess = spawn(claudeCommand, claudeArgs, {
        stdio: 'inherit',
        env: withBunRuntimeEnv(),
        shell: false
    })

    return new Promise((resolve, reject) => {
        claudeProcess.on('close', (code) => {
            if (code === 0) {
                resolve()
            } else {
                reject(new Error(`Claude exited with code ${code}`))
            }
        })

        claudeProcess.on('error', (error) => {
            console.error(chalk.red('Failed to start Claude:'), error.message)
            console.error(chalk.yellow('  未找到 claude？可设置 MOBI_CLAUDE_PATH 指向已有 claude 可执行文件'))
            reject(error)
        })
    })
}

export const claudeCommand: CommandDefinition = {
    name: 'default',
    requiresRuntimeAssets: true,
    run: async ({ commandArgs }) => {
        const args = [...commandArgs]

        if (args.length > 0 && args[0] === 'claude') {
            args.shift()
        }

        // 解析命令行参数（mobi 自身 flag + 透传给 claude code 的参数）
        const { options, showHelp, unknownArgs } = parseStartOptions(args)

        if (unknownArgs.length > 0) {
            // 透传给claude code的参数
            options.claudeArgs = [...(options.claudeArgs || []), ...unknownArgs]
        }

        // 显示帮助信息
        if (showHelp) {
            // 限制mobi的帮助信息
            console.log(`
${chalk.bold('mobi')} - Claude Code On the Go

${chalk.bold('Usage:')}
  mobi [options]           Start Claude with remote control

${chalk.bold('Commands:')}
  mobi setup               Interactive setup wizard (first-time)
  mobi service <action>    Manage hub + runner service
  mobi hub <action>        Manage hub server
  mobi runner <action>     Manage background runner
  mobi auth <action>       Manage authentication
  mobi mcp                 Start MCP stdio bridge
  mobi version             Show version info
  mobi upgrade             Upgrade to latest version
  mobi doctor              System diagnostics & troubleshooting

${chalk.bold('Getting started:')}
  mobi setup               Configure and start mobi interactively

${chalk.bold('Examples:')}
  mobi                      Start a Claude session
  mobi --yolo               Start with --dangerously-skip-permissions
  mobi --resume             Resume last session

${chalk.bold('mobi supports ALL Claude options!')}
  Use any claude flag with mobi as you would with claude.

${chalk.gray('─'.repeat(60))}
${chalk.bold.cyan('Claude Code Options (from `claude --help`):')}
`)

            // 追加 claude code 的帮助信息
            try {
                const claudeHelp = execFileSync(
                    (await getClaudeExecutablePath()) ?? 'claude',
                    ['--help'],
                    { encoding: 'utf8', env: withBunRuntimeEnv(), shell: false }
                )
                console.log(claudeHelp)
            } catch {
                console.log(chalk.yellow('Could not retrieve claude help. Make sure claude is installed.'))
            }

            process.exit(0)
        }

        // 初始化 cli auth token
        await initializeToken()
        // 启动 mobi hub （如果需要）
        // hub/runner 均经 supervisor 托管：CLI 会话结束后仍存活
        await maybeAutoStartServer()
        // 确保设置了 cli auth token 并初始化 machineId
        await authAndSetupMachineIfNeeded()

        logger.debug('Ensuring mobi background service is running & matches our version...')

        // 启动 mobi runner （如果需要）——经 supervisor 托管，
        // CLI 会话结束后 runner 继续存活以管理会话
        await maybeAutoStartRunner()

        try {
            const { runClaude } = await import('@/claude/runClaude')
            await runClaude(options)
        } catch (error) {
            const { message, messageLower, axiosCode: _axiosCode, httpStatus, responseErrorText, serverProtocolVersion } = extractErrorInfo(error)

            // 连接错误 - 降级到本地模式
            if (isConnectionError(error)) {
                console.log(chalk.yellow('⚠️  Unable to connect to Mobi Hub'))
                console.log(chalk.gray(`   Hub URL: ${configuration.apiUrl}`))
                console.log(chalk.gray('   Falling back to local-only mode...\n'))

                try {
                    await runLocalMode(options)
                    return
                } catch (localError) {
                    console.error(chalk.red('Failed to run in local mode:'), extractErrorInfo(localError).message)
                    process.exit(1)
                }
            }

            // 其他错误处理
            if (httpStatus === 403 && responseErrorText === 'Machine access denied') {
                console.error(chalk.red('Machine access denied.'))
                console.error(chalk.gray('  This machineId is already registered under a different namespace.'))
                console.error(chalk.gray('  Fix: run `mobi auth logout`, or set a separate MOBI_HOME per namespace.'))
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

            if (serverProtocolVersion !== undefined && serverProtocolVersion !== PROTOCOL_VERSION) {
                if (serverProtocolVersion < PROTOCOL_VERSION) {
                    console.error(chalk.yellow(`  Hint: hub protocol version (${serverProtocolVersion}) is behind CLI (${PROTOCOL_VERSION}). Please update the hub.`))
                } else {
                    console.error(chalk.yellow(`  Hint: CLI protocol version (${PROTOCOL_VERSION}) is behind hub (${serverProtocolVersion}). Please update the CLI.`))
                }
            }

            if (process.env.DEBUG) {
                console.error(error)
            }
            process.exit(1)
        }
    }
}
