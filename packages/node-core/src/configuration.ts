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
    /** hub 配置文件（listen* 等），仅本机 co-located 部署时可写；远程部署时它在 hub 机器上 */
    public readonly hubSettingsFile: string
    public readonly privateKeyFile: string
    public readonly runnerStateFile: string
    public readonly runnerLockFile: string
    public readonly hubStateFile: string
    public readonly supervisorSocketFile: string
    public readonly supervisorStateFile: string
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
    private settings: Pick<Settings, 'disconnectTimeoutMs' | 'idleTimeoutMs' | 'timeoutWarningMs' | 'claudeEnv' | 'bashInjectContext'> = {}

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
        // cli 专属配置（连接凭证/machineId/claudeEnv 等），随 cli 部署位置走；
        // hub 配置在 settings.hub.json（本机 co-located 时同目录，远程时在 hub 机器上）
        this.settingsFile = join(this.mobiHomeDir, 'settings.cli.json')
        this.hubSettingsFile = join(this.mobiHomeDir, 'settings.hub.json')
        this.privateKeyFile = join(this.mobiHomeDir, 'access.key')
        this.runnerStateFile = join(this.mobiHomeDir, 'runner.state.json')
        this.runnerLockFile = join(this.mobiHomeDir, 'runner.state.json.lock')
        this.hubStateFile = join(this.mobiHomeDir, 'hub.state.json')
        this.supervisorSocketFile = join(this.mobiHomeDir, 'supervisor.sock')
        this.supervisorStateFile = join(this.mobiHomeDir, 'supervisor-state.json')

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

        // 同步读取 settings.cli.json（如果存在）
        try {
            if (existsSync(this.settingsFile)) {
                const content = readFileSync(this.settingsFile, 'utf8')
                const parsed = JSON.parse(content)
                this.settings = {
                    disconnectTimeoutMs: parsed.disconnectTimeoutMs,
                    idleTimeoutMs: parsed.idleTimeoutMs,
                    timeoutWarningMs: parsed.timeoutWarningMs,
                    claudeEnv: typeof parsed.claudeEnv === 'object'
                            && parsed.claudeEnv !== null
                            && !Array.isArray(parsed.claudeEnv)
                        ? parsed.claudeEnv as Record<string, string>
                        : undefined,
                    bashInjectContext: typeof parsed.bashInjectContext === 'boolean'
                        ? parsed.bashInjectContext
                        : undefined,
                }
            }
        } catch {
            // 忽略读取错误，使用默认值
        }

        // 拆分迁移前的旧单文件 settings.json 兜底（远程部署形态：hub 的迁移够不到 cli
        // 机器，落盘迁移由 runCli 的 migrateLegacyCliSettings 异步完成，但本构造器在
        // 模块加载时同步执行、早于它——此处内存合并保证首启命令就能读到存量配置）
        const legacySettingsFile = join(this.mobiHomeDir, 'settings.json')
        if (existsSync(legacySettingsFile)) {
            try {
                const legacy = JSON.parse(readFileSync(legacySettingsFile, 'utf8')) as Record<string, unknown>
                if (this.settings.disconnectTimeoutMs === undefined && typeof legacy.disconnectTimeoutMs === 'number') {
                    this.settings.disconnectTimeoutMs = legacy.disconnectTimeoutMs
                }
                if (this.settings.idleTimeoutMs === undefined && typeof legacy.idleTimeoutMs === 'number') {
                    this.settings.idleTimeoutMs = legacy.idleTimeoutMs
                }
                if (this.settings.timeoutWarningMs === undefined && typeof legacy.timeoutWarningMs === 'number') {
                    this.settings.timeoutWarningMs = legacy.timeoutWarningMs
                }
                if (this.settings.claudeEnv === undefined
                    && typeof legacy.claudeEnv === 'object'
                    && legacy.claudeEnv !== null
                    && !Array.isArray(legacy.claudeEnv)) {
                    this.settings.claudeEnv = legacy.claudeEnv as Record<string, string>
                }
                if (this.settings.bashInjectContext === undefined && typeof legacy.bashInjectContext === 'boolean') {
                    this.settings.bashInjectContext = legacy.bashInjectContext
                }
            } catch {
                // 旧文件解析失败忽略：落盘迁移同样会跳过并警告，cli 凭证有交互式 prompt 兜底
            }
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

    /**
     * settings.cli.json 的 claudeEnv：注入给 claude 子进程的额外环境变量。
     * 由 buildClaudeFeatureEnv 合并，优先级高于 process.env 与内置开关。
     * 未配置时返回空对象。值的精细过滤（非 string 跳过）交给 buildClaudeFeatureEnv。
     */
    get claudeEnv(): Record<string, string> {
        return this.settings.claudeEnv ?? {}
    }

    /**
     * !bash 本地执行后是否把命令+输出注入 SDK context（默认开启）。
     * true = 注入即响应（模型感知输出并回复，等同 Claude CLI respondToBashCommands:true）；
     * false = 仅本地执行 + UI 合成工具对，模型不参与（!cmd 不耗 token）。
     * settings.cli.json 的 bashInjectContext 显式为 boolean 时覆盖默认。
     */
    get bashInjectContext(): boolean {
        return this.settings.bashInjectContext ?? true
    }
}

export const configuration: Configuration = new Configuration()
