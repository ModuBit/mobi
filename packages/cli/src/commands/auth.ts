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
import os from 'node:os'
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { configuration } from '@/configuration'
import { readSettings, clearMachineId, updateSettings } from '@/persistence'
import type { CommandDefinition } from './types'

/** GET/POST /cli/web-token 响应（hub 侧 webApiToken 归 hub 所有，cli 经 API 读取/轮换） */
interface WebTokenApiResponse {
    webToken: string
    /** hub 以 WEB_API_TOKEN 环境变量启动时为 true：重启后轮换会被 env 值覆盖 */
    envOverride: boolean
}

/**
 * 调 hub 的 web-token HTTP API。webApiToken 持久化在 hub 机器的 settings.hub.json，
 * cli 与 hub 可不同机器部署，任何部署形态下都经 API 读写而非本地文件。
 */
async function requestWebToken(method: 'GET' | 'POST'): Promise<WebTokenApiResponse> {
    const res = await fetch(`${configuration.apiUrl}/cli/web-token`, {
        method,
        headers: { authorization: `Bearer ${configuration.cliApiToken}` },
        signal: AbortSignal.timeout(10_000)
    })
    if (res.status === 401) {
        throw new Error('CLI_API_TOKEN 未被 hub 接受，请先运行 mobi auth login 配置凭证')
    }
    if (!res.ok) {
        throw new Error(`hub 返回 ${res.status}（${configuration.apiUrl}/cli/web-token）`)
    }
    return await res.json() as WebTokenApiResponse
}

function printWebToken(result: WebTokenApiResponse, rotated: boolean): void {
    console.log(chalk.bold(`\nWeb API Token${rotated ? '（已轮换）' : ''} (Web 浏览器登录用)\n`))
    console.log(chalk.green(`  ${result.webToken}`))
    if (rotated) {
        console.log(chalk.gray('\n  已持久化到 hub 的 settings.hub.json 并即时生效。'))
        console.log(chalk.gray('  注意：已登录的 Web 会话最长 1 天后自然失效，新登录需用上方 token。'))
    } else {
        console.log(chalk.gray('\n  轮换: mobi auth rotate-web-token'))
    }
    if (result.envOverride) {
        console.log(chalk.yellow('  ⚠ hub 以 WEB_API_TOKEN 环境变量运行：env 优先级高于文件，hub 重启后轮换会被 env 值覆盖失效。'))
        console.log(chalk.gray('    如需持久轮换，请先移除/更新 hub 侧该环境变量再 rotate。'))
    }
    console.log('')
}

export async function handleAuthCommand(args: string[]): Promise<void> {
    const subcommand = args[0]

    if (!subcommand || subcommand === 'help' || subcommand === '--help' || subcommand === '-h') {
        showHelp()
        return
    }

    if (subcommand === 'status') {
        const settings = await readSettings()
        const envToken = process.env.CLI_API_TOKEN
        const settingsToken = settings.cliApiToken
        const hasToken = Boolean(envToken || settingsToken)
        const tokenSource = envToken ? 'environment' : (settingsToken ? 'settings file' : 'none')
        console.log(chalk.bold('\nDirect Connect Status\n'))
        console.log(chalk.gray(`  MOBI_API_URL: ${configuration.apiUrl}`))
        console.log(chalk.gray(`  CLI_API_TOKEN: ${hasToken ? 'set' : 'missing'}`))
        console.log(chalk.gray(`  Token Source: ${tokenSource}`))
        console.log(chalk.gray(`  Machine ID: ${settings.machineId ?? 'not set'}`))
        console.log(chalk.gray(`  Host: ${os.hostname()}`))

        if (!hasToken) {
            console.log('')
            console.log(chalk.yellow('  Token not configured.'))
            console.log(chalk.gray('    Run mobi setup settings to auto-generate a token'))
            console.log(chalk.gray('    Or run mobi auth login to enter one manually'))
        }
        return
    }

    if (subcommand === 'login') {
        if (!process.stdin.isTTY) {
            console.error(chalk.red('Cannot prompt for token in non-TTY environment.'))
            console.error(chalk.gray('Set CLI_API_TOKEN environment variable instead.'))
            process.exit(1)
        }

        const rl = readline.createInterface({ input, output })

        try {
            const token = await rl.question(chalk.cyan('Enter CLI_API_TOKEN: '))

            if (!token.trim()) {
                console.error(chalk.red('Token cannot be empty'))
                process.exit(1)
            }

            await updateSettings(current => ({
                ...current,
                cliApiToken: token.trim()
            }))
            configuration._setCliApiToken(token.trim())
            console.log(chalk.green(`\nToken saved to ${configuration.settingsFile}`))
        } finally {
            rl.close()
        }
        return
    }

    if (subcommand === 'web-token') {
        // 回显当前 webApiToken（Web 浏览器登录用）——经 hub API 读取，
        // 与 hub 校验源保持一致（env > hub 文件），远程部署同样可用
        printWebToken(await requestWebToken('GET'), false)
        return
    }

    if (subcommand === 'rotate-web-token') {
        // 经 hub API 生成新 webApiToken：hub 落盘 settings.hub.json 并即时热更新，
        // 无需重启 hub；远程部署（cli/hub 不同机器）下这是唯一可行的轮换途径
        printWebToken(await requestWebToken('POST'), true)
        return
    }

    if (subcommand === 'logout') {
        await updateSettings(current => ({
            ...current,
            cliApiToken: undefined
        }))
        await clearMachineId()
        console.log(chalk.green('Cleared local credentials (token and machineId).'))
        console.log(chalk.gray('Note: If CLI_API_TOKEN is set via environment variable, it will still be used.'))
        return
    }

    console.error(chalk.red(`Unknown auth subcommand: ${subcommand}`))
    showHelp()
    process.exit(1)
}

function showHelp(): void {
    console.log(`
${chalk.bold('mobi auth')} - Manage authentication

${chalk.bold('Usage:')}
  mobi auth status               Show current auth configuration
  mobi auth login                Enter and save CLI_API_TOKEN
  mobi auth logout               Clear saved credentials
  mobi auth web-token            Show webApiToken (Web 浏览器登录用)
  mobi auth rotate-web-token     Rotate webApiToken (hub 热加载)

${chalk.gray('For initial setup, use:')} ${chalk.cyan('mobi setup settings')}
${chalk.gray('Token priority:')} env CLI_API_TOKEN > ~/.mobi/settings.cli.json > auto-generated
`)
}

export const authCommand: CommandDefinition = {
    name: 'auth',
    requiresRuntimeAssets: true,
    run: async ({ commandArgs }) => {
        try {
            await handleAuthCommand(commandArgs)
        } catch (error) {
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : 'Unknown error')
            if (process.env.DEBUG) {
                console.error(error)
            }
            process.exit(1)
        }
    }
}
