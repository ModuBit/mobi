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

import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import packageJson from '../package.json'
import { getCliArgs } from '@/utils/cliArgs'
import type { Settings } from '@/persistence'

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

    // 配置文件中的设置
    private settings: Pick<Settings, 'disconnectTimeoutMs' | 'idleTimeoutMs' | 'timeoutWarningMs'> = {}

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

        // 同步读取 settings.json（如果存在）
        try {
            if (existsSync(this.settingsFile)) {
                const content = readFileSync(this.settingsFile, 'utf8')
                const parsed = JSON.parse(content)
                this.settings = {
                    disconnectTimeoutMs: parsed.disconnectTimeoutMs,
                    idleTimeoutMs: parsed.idleTimeoutMs,
                    timeoutWarningMs: parsed.timeoutWarningMs,
                }
            }
        } catch {
            // 忽略读取错误，使用默认值
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

    // 超时配置（带环境变量和配置文件优先级）
    // 优先级：环境变量 > 配置文件 > 默认值
    get disconnectTimeoutMs(): number {
        // 1. 环境变量优先
        const env = process.env.MOBI_DISCONNECT_TIMEOUT_MS
        if (env) {
            const parsed = parseInt(env, 10)
            if (!isNaN(parsed) && parsed > 0) {
                return parsed
            }
        }
        // 2. 配置文件次之
        if (this.settings.disconnectTimeoutMs && this.settings.disconnectTimeoutMs > 0) {
            return this.settings.disconnectTimeoutMs
        }
        // 3. 默认值
        return 600000 // 默认 10 分钟
    }

    get idleTimeoutMs(): number {
        // 1. 环境变量优先
        const env = process.env.MOBI_IDLE_TIMEOUT_MS
        if (env) {
            const parsed = parseInt(env, 10)
            if (!isNaN(parsed) && parsed > 0) {
                return parsed
            }
        }
        // 2. 配置文件次之
        if (this.settings.idleTimeoutMs && this.settings.idleTimeoutMs > 0) {
            return this.settings.idleTimeoutMs
        }
        // 3. 默认值
        return 86400000 // 默认 1 天
    }

    get timeoutWarningMs(): number {
        // 1. 环境变量优先
        const env = process.env.MOBI_TIMEOUT_WARNING_MS
        if (env) {
            const parsed = parseInt(env, 10)
            if (!isNaN(parsed) && parsed > 0) {
                return parsed
            }
        }
        // 2. 配置文件次之
        if (this.settings.timeoutWarningMs && this.settings.timeoutWarningMs > 0) {
            return this.settings.timeoutWarningMs
        }
        // 3. 默认值
        return 300000 // 默认 5 分钟
    }
}

export const configuration: Configuration = new Configuration()
