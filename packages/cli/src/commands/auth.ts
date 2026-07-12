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
import { randomBytes } from 'node:crypto'
import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { configuration } from '@/configuration'
import { readSettings, clearMachineId, updateSettings } from '@/persistence'
import type { CommandDefinition } from './types'

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
        // 回显当前 webApiToken（Web 浏览器登录用，与 CLI 密钥独立）
        // 与 hub 校验源保持一致（env > file），避免显示与实际校验不一致的 token
        const settings = await readSettings()
        const token = process.env.WEB_API_TOKEN ?? settings.webApiToken
        if (!token) {
            console.error(chalk.red('webApiToken 尚未配置。'))
            console.error(chalk.gray('  启动 hub 时会自动生成，或运行 mobi auth rotate-web-token 生成。'))
            process.exit(1)
        }
        const source = process.env.WEB_API_TOKEN ? 'environment' : configuration.settingsFile
        console.log(chalk.bold('\nWeb API Token (Web 浏览器登录用)\n'))
        console.log(chalk.green(`  ${token}`))
        console.log(chalk.gray(`\n  来源: ${source}`))
        console.log(chalk.gray('  轮换: mobi auth rotate-web-token'))
        console.log('')
        return
    }

    if (subcommand === 'rotate-web-token') {
        // 生成新 webApiToken 并原子写入 settings.json
        // hub 进程的 settingsWatcher 会检测到变化并热 reload，无需重启 hub
        const newToken = randomBytes(32).toString('base64url')
        await updateSettings(current => ({ ...current, webApiToken: newToken }))
        console.log(chalk.green('\nWeb API Token 已轮换。'))
        console.log(chalk.gray('  hub 将自动热加载新 token（无需重启）。'))
        if (process.env.WEB_API_TOKEN) {
            console.log(chalk.yellow('  ⚠ 检测到 WEB_API_TOKEN 环境变量：env 优先级高于文件，hub 重启后本次轮换会被 env 值覆盖失效。'))
            console.log(chalk.gray('    如需持久轮换，请先移除/更新该环境变量再 rotate。'))
        }
        console.log(chalk.gray('  注意：已登录的 Web 会话最长 1 天后自然失效，新登录需用下方 token：\n'))
        console.log(chalk.green(`  ${newToken}\n`))
        console.log(chalk.gray(`  已写入: ${configuration.settingsFile}`))
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
${chalk.gray('Token priority:')} env CLI_API_TOKEN > ~/.mobi/settings.json > auto-generated
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
