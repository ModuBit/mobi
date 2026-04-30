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
import { z } from 'zod'
import { PROTOCOL_VERSION, type EffortLevel } from '@mobi/shared'
import type { StartOptions } from '@/claude/runClaude'
import { configuration } from '@/configuration'
import { isRunnerRunningCurrentlyInstalledMobiVersion } from '@/runner/controlClient'
import { authAndSetupMachineIfNeeded } from '@/ui/auth'
import { logger } from '@/ui/logger'
import { initializeToken } from '@/ui/tokenInit'
import { spawnMobiCli } from '@/utils/spawnMobiCli'
import { maybeAutoStartServer } from '@/utils/autoStartServer'
import { withBunRuntimeEnv } from '@/utils/bunRuntime'
import { extractErrorInfo } from '@/utils/errorUtils'
import { getDefaultClaudeCodePath } from '@/claude/sdk/utils'
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

    // 添加推理深度
    if (options.effort && !claudeArgs.some(arg => arg === '--effort')) {
        claudeArgs.push('--effort', options.effort)
    }

    logger.debug(`[LOCAL] Starting Claude with args:`, claudeArgs)

    // 直接启动 claude 进程
    const claudeCommand = getDefaultClaudeCodePath()
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

        const options: StartOptions = {}
        let showHelp = false
        const unknownArgs: string[] = []

        // 解析命令行参数
        for (let i = 0; i < args.length; i++) {
            const arg = args[i]

            if (arg === '-h' || arg === '--help') {
                showHelp = true
                unknownArgs.push(arg)
            } else if (arg === '--mobi-starting-mode') {
                // 设置启动模式
                options.startingMode = z.enum(['local', 'remote']).parse(args[++i])
            } else if (arg === '--yolo') {
                // 设置yolo模式
                options.permissionMode = 'bypassPermissions'
                unknownArgs.push('--dangerously-skip-permissions')
            } else if (arg === '--dangerously-skip-permissions') {
                // 与yolo模式相同
                options.permissionMode = 'bypassPermissions'
                unknownArgs.push(arg)
            } else if (arg === '--model' || arg === '-m') {
                // 设置模型
                const model = args[++i]
                if (!model) {
                    throw new Error('Missing --model value')
                }
                options.model = model
                unknownArgs.push('--model', model)
            } else if (arg === '--effort') {
                // 设置推理深度
                const effort = args[++i]
                if (!effort) {
                    throw new Error('Missing --effort value')
                }
                options.effort = effort as EffortLevel
                unknownArgs.push('--effort', effort)
            } else if (arg === '--started-by') {
                // 设置启动来源
                options.startedBy = args[++i] as 'runner' | 'terminal'
            } else {
                // 其他claude code参数
                unknownArgs.push(arg)
                if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
                    unknownArgs.push(args[++i])
                }
            }
        }

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
  mobi [options]         Start Claude with remote control
  mobi auth              Manage authentication
  mobi mcp               Start MCP stdio bridge
  mobi hub               Start the API + web hub
  mobi hub --relay       Start with public relay
  mobi server            Alias for mobi hub
  mobi runner            Manage background service that allows
                            to spawn new sessions away from your computer
  mobi doctor            System diagnostics & troubleshooting

${chalk.bold('Examples:')}
  mobi                    Start session (will prompt for token if not set)
  mobi auth login         Configure CLI_API_TOKEN interactively
  mobi --yolo             Start with bypassing permissions
                            mobi sugar for --dangerously-skip-permissions
  mobi auth status        Show direct-connect status
  mobi doctor             Run diagnostics

${chalk.bold('mobi supports ALL Claude options!')}
  Use any claude flag with mobi as you would with claude. Our favorite:

  mobi --resume

${chalk.gray('─'.repeat(60))}
${chalk.bold.cyan('Claude Code Options (from `claude --help`):')}
`)

            // 追加 claude code 的帮助信息
            try {
                const claudeHelp = execFileSync(
                    getDefaultClaudeCodePath(),
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
        // mobi hub 会随 mobi 一同关闭
        await maybeAutoStartServer()
        // 确保设置了 cli auth token 并初始化 machineId
        await authAndSetupMachineIfNeeded()

        logger.debug('Ensuring mobi background service is running & matches our version...')

        // 启动 mobi runner （如果需要）
        if (!(await isRunnerRunningCurrentlyInstalledMobiVersion())) {
            logger.debug('Starting mobi background service...')

            const runnerProcess = spawnMobiCli(['runner', 'start-sync'], {
                detached: true,
                stdio: 'ignore',
                env: process.env
            })
            // mobi runner 完全独立于父进程后台运行
            runnerProcess.unref()

            await new Promise(resolve => setTimeout(resolve, 200))
        }

        try {
            const { runClaude } = await import('@/claude/runClaude')
            await runClaude(options)
        } catch (error) {
            const { message, messageLower, axiosCode, httpStatus, responseErrorText, serverProtocolVersion } = extractErrorInfo(error)

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
