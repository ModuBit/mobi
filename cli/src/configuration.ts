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
 * Global configuration for Mobi CLI
 *
 * Centralizes all configuration including environment variables and paths
 * Environment files should be loaded using Node's --env-file flag
 */

import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import packageJson from '../package.json'
import { getCliArgs } from '@/utils/cliArgs'

class Configuration {
    private _apiUrl: string
    private _cliApiToken: string
    public readonly isRunnerProcess: boolean

    // Directories and paths (from persistence)
    public readonly mobiHomeDir: string
    public readonly logsDir: string
    public readonly settingsFile: string
    public readonly privateKeyFile: string
    public readonly runnerStateFile: string
    public readonly runnerLockFile: string
    public readonly hubStateFile: string
    public readonly currentCliVersion: string

    public readonly isExperimentalEnabled: boolean

    constructor() {
        // Server configuration
        this._apiUrl = process.env.MOBI_API_URL || 'http://localhost:2222'
        this._cliApiToken = process.env.CLI_API_TOKEN || ''

        // Check if we're running as runner based on process args
        const args = getCliArgs()
        this.isRunnerProcess = args.length >= 2 && args[0] === 'runner' && (args[1] === 'start-sync')

        // Directory configuration - Priority: MOBI_HOME env > default home dir
        if (process.env.MOBI_HOME) {
            // Expand ~ to home directory if present
            const expandedPath = process.env.MOBI_HOME.replace(/^~/, homedir())
            this.mobiHomeDir = expandedPath
        } else {
            this.mobiHomeDir = join(homedir(), '.mobi')
        }

        this.logsDir = join(this.mobiHomeDir, 'logs')
        this.settingsFile = join(this.mobiHomeDir, 'settings.json')
        this.privateKeyFile = join(this.mobiHomeDir, 'access.key')
        this.runnerStateFile = join(this.mobiHomeDir, 'runner.state.json')
        this.runnerLockFile = join(this.mobiHomeDir, 'runner.state.json.lock')
        this.hubStateFile = join(this.mobiHomeDir, 'hub.state.json')

        this.isExperimentalEnabled = ['true', '1', 'yes'].includes(process.env.MOBI_EXPERIMENTAL?.toLowerCase() || '')

        this.currentCliVersion = packageJson.version

        if (!existsSync(this.mobiHomeDir)) {
            mkdirSync(this.mobiHomeDir, { recursive: true })
        }
        // Ensure directories exist
        if (!existsSync(this.logsDir)) {
            mkdirSync(this.logsDir, { recursive: true })
        }
    }

    get apiUrl(): string {
        return this._apiUrl
    }

    _setApiUrl(url: string): void {
        this._apiUrl = url
    }

    get cliApiToken(): string {
        return this._cliApiToken
    }

    _setCliApiToken(token: string): void {
        this._cliApiToken = token
    }
}

export const configuration: Configuration = new Configuration()
