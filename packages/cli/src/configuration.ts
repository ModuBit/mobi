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

    /**
     * 是否启用 Claude Code agent teams（多 teammate 协作）。
     *
     * 该特性在 Claude Code 侧默认关闭：不设开关时 session 启动不建团、
     * 不写团队目录，Claude 也不会派发或提议 teammate（此时 Agent 工具
     * 产出的都是普通 subagent，走 backgroundTasks 链路）。
     * 官方标注其在 session resume / 任务协调 / 优雅关停上仍有已知限制，
     * 且每个 teammate 独占 context window、token 开销显著更高，
     * 故 mobi 侧同样默认关闭，由 MOBI_AGENT_TEAMS 显式开启。
     */
    public readonly isAgentTeamsEnabled: boolean

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
        this.isAgentTeamsEnabled = ['true', '1', 'yes'].includes(process.env.MOBI_AGENT_TEAMS?.toLowerCase() || '')

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

    /** 当前进程的日志分类：runner 后台进程为 'runner'，交互进程为 'cli' */
    get processType(): 'runner' | 'cli' {
        return this.isRunnerProcess ? 'runner' : 'cli'
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

    /**
     * 解析超时配置（环境变量 > 配置文件 > 默认值）
     */
    private resolveTimeoutConfig(
        envKey: string,
        configValue: number | undefined,
        defaultValue: number
    ): number {
        const env = process.env[envKey]
        if (env) {
            const parsed = parseInt(env, 10)
            if (!isNaN(parsed) && parsed > 0) {
                return parsed
            }
        }
        if (configValue && configValue > 0) {
            return configValue
        }
        return defaultValue
    }

    get disconnectTimeoutMs(): number {
        return this.resolveTimeoutConfig(
            'MOBI_DISCONNECT_TIMEOUT_MS',
            this.settings.disconnectTimeoutMs,
            600000 // 默认 10 分钟
        )
    }

    get idleTimeoutMs(): number {
        return this.resolveTimeoutConfig(
            'MOBI_IDLE_TIMEOUT_MS',
            this.settings.idleTimeoutMs,
            86400000 // 默认 1 天
        )
    }

    get timeoutWarningMs(): number {
        return this.resolveTimeoutConfig(
            'MOBI_TIMEOUT_WARNING_MS',
            this.settings.timeoutWarningMs,
            300000 // 默认 5 分钟
        )
    }
}

export const configuration: Configuration = new Configuration()
