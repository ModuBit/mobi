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
 * Token initialization module
 *
 * Handles CLI_API_TOKEN initialization with priority:
 * 1. Environment variable (highest - allows temporary override)
 * 2. Settings file (~/.mobi/settings.json)
 * 3. Interactive prompt (only when both above are missing)
 */

import * as readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import chalk from 'chalk'
import { configuration } from '@/configuration'
import { readSettings, updateSettings } from '@/persistence'
import { initializeApiUrl } from '@/ui/apiUrlInit'

/**
 * Initialize CLI API token
 * Must be called before any API operations
 */
export async function initializeToken(): Promise<void> {
    // Initialize API URL first (env > settings.json > default)
    await initializeApiUrl()

    // 1. Environment variable has highest priority (allows temporary override)
    if (configuration.cliApiToken) {
        return
    }

    // 2. Read from settings file
    const settings = await readSettings()
    if (settings.cliApiToken) {
        configuration._setCliApiToken(settings.cliApiToken)
        return
    }

    // 3. Non-TTY environment cannot prompt, fail with clear error
    if (!process.stdin.isTTY) {
        throw new Error('CLI_API_TOKEN is required. Set it via environment variable or run `mobi auth login`.')
    }

    // 4. Interactive prompt
    const token = await promptForToken()

    // 5. Save and update configuration
    await updateSettings(current => ({
        ...current,
        cliApiToken: token
    }))
    configuration._setCliApiToken(token)
}

async function promptForToken(): Promise<string> {
    const rl = readline.createInterface({ input, output })

    console.log(chalk.yellow('\nNo CLI_API_TOKEN found.'))
    console.log(chalk.gray('Where to find the token:'))
    console.log(chalk.gray('  1. Check the server startup logs (first run shows generated token)'))
    console.log(chalk.gray('  2. Read ~/.mobi/settings.json on the server'))
    console.log(chalk.gray('  3. Ask your server administrator (if token is set via env var)\n'))

    try {
        const token = await rl.question(chalk.cyan('Enter CLI_API_TOKEN: '))
        if (!token.trim()) {
            throw new Error('Token cannot be empty')
        }
        console.log(chalk.green(`\nToken saved to ${configuration.settingsFile}`))
        return token.trim()
    } finally {
        rl.close()
    }
}
