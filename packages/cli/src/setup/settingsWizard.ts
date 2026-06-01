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
import { randomBytes } from 'node:crypto'
import { configuration } from '@/configuration'
import { readSettings, updateSettings } from '@/persistence'
import { askYesNo, askInput, askPort } from './prompts'

/**
 * 脱敏 token，只显示前4后4
 */
function maskToken(token: string): string {
    if (token.length <= 8) return '****'
    return `${token.slice(0, 4)}...${token.slice(-4)}`
}

/**
 * 生成安全随机 token
 */
function generateToken(): string {
    return randomBytes(32).toString('base64url')
}

export interface SettingsResult {
    listenHost: string
    listenPort: number
    apiUrl: string
}

/**
 * 交互式配置 settings.json
 */
export async function runSettingsWizard(): Promise<SettingsResult> {
    if (!process.stdin.isTTY) {
        console.log(chalk.yellow('Setup requires an interactive terminal.'))
        console.log(chalk.gray('Set environment variables or edit ~/.mobi/settings.json manually.'))
        process.exit(1)
    }

    const settings = await readSettings()

    // 1. 配置 cliApiToken
    if (settings.cliApiToken) {
        console.log(`  Token: ${chalk.gray(maskToken(settings.cliApiToken))}`)
        const shouldRegen = await askYesNo('Regenerate API token?')
        if (shouldRegen) {
            const newToken = generateToken()
            await updateSettings(s => ({ ...s, cliApiToken: newToken }))
            console.log(chalk.green('  Token regenerated'))
        }
    } else {
        const newToken = generateToken()
        await updateSettings(s => ({ ...s, cliApiToken: newToken }))
        console.log(chalk.green('  API token generated'))
    }

    // 2. 配置 listenHost
    const currentHost = settings.listenHost ?? '127.0.0.1'
    console.log(`  Host: ${chalk.cyan(currentHost)}`)
    const shouldChangeHost = currentHost !== '127.0.0.1' ? true : await askYesNo('Customize listen host?')
    const listenHost = shouldChangeHost
        ? await askInput('Listen host', currentHost)
        : currentHost

    // 3. 配置 listenPort
    const currentPort = settings.listenPort ?? 2222
    console.log(`  Port: ${chalk.cyan(currentPort)}`)
    const shouldChangePort = currentPort !== 2222 ? true : await askYesNo('Customize listen port?')
    const listenPort = shouldChangePort
        ? await askPort('Listen port', currentPort)
        : currentPort

    // 4. 派生 apiUrl
    const apiUrl = `http://${listenHost}:${listenPort}`

    // 5. 写入配置
    await updateSettings(s => ({
        ...s,
        listenHost,
        listenPort,
        apiUrl,
    }))

    console.log('')
    console.log(chalk.green('Settings configured:'))
    console.log(`  Token:     ${chalk.gray(maskToken((await readSettings()).cliApiToken ?? ''))}`)
    console.log(`  Host:      ${chalk.cyan(listenHost)}`)
    console.log(`  Port:      ${chalk.cyan(listenPort)}`)
    console.log(`  API URL:   ${chalk.cyan(apiUrl)}`)

    return { listenHost, listenPort, apiUrl }
}
