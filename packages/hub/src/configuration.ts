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
 * Configuration for mobi-hub
 *
 * Configuration is loaded with priority: environment variable > settings.hub.json > default
 * When values are read from environment variables and not present in settings.hub.json,
 * they are automatically saved for future use
 *
 * Optional environment variables:
 * - CLI_API_TOKEN: Shared secret for mobi CLI authentication (auto-generated if not set)
 * - MOBI_LISTEN_HOST: Host/IP to bind the HTTP service (default: 127.0.0.1)
 * - MOBI_LISTEN_PORT: Port for HTTP service (default: 2222)
 * - MOBI_PUBLIC_URL: Public URL for external access
 * - CORS_ORIGINS: Comma-separated CORS origins
 * - VAPID_SUBJECT: Contact email or URL for Web Push
 * - MOBI_HOME: Data directory (default: ~/.mobi)
 * - DB_PATH: SQLite database path (default: {MOBI_HOME}/mobi.db)
 */

import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { hubLogger } from './logger'
import { getOrCreateCliApiToken } from './config/cliApiToken'
import { getOrCreateWebApiToken } from './config/webApiToken'
import { getCliSettingsFile, getSettingsFile, updateSettingsFile } from './config/settings'
import { loadServerSettings, type ServerSettings, type ServerSettingsResult } from './config/serverSettings'

/**
 * co-located cliApiToken 同步：同目录存在 settings.cli.json 且其尚无连接凭证时，
 * 把 hub 的 cliApiToken 写一份进去（cli 文件归 cli 所有，此写仅发生在 cli 字段缺省时，
 * 不覆盖用户经 `mobi auth login` 配置的值）。远程部署无同目录文件，自动跳过。
 */
async function syncCliApiTokenToCoLocatedCli(dataDir: string, token: string): Promise<void> {
    const cliFile = getCliSettingsFile(dataDir)
    if (!existsSync(cliFile)) return
    try {
        await updateSettingsFile<Record<string, unknown>>(cliFile, (current) => {
            // 空文件（仅迁移占位）与已有凭证均不写：cli 文件归 cli 所有，此写仅在缺省时补一份
            if (Object.keys(current).length === 0 || current.cliApiToken) return current
            return { ...current, cliApiToken: token }
        })
        hubLogger.info(`[Hub] Synced cliApiToken to co-located ${cliFile}`)
    } catch (e) {
        hubLogger.warn(`[Hub] Sync cliApiToken to cli settings failed (ignored): ${e}`)
    }
}

export type ConfigSource = 'env' | 'file' | 'default'

export interface ConfigSources {
    listenHost: ConfigSource
    listenPort: ConfigSource
    publicUrl: ConfigSource
    corsOrigins: ConfigSource
    hubName: ConfigSource
    cliApiToken: 'env' | 'file' | 'generated'
    webApiToken: 'env' | 'file' | 'generated'
}

class Configuration {
    /** CLI auth token (shared secret) */
    public readonly cliApiToken: string

    /** Source of CLI API token */
    public readonly cliApiTokenSource: 'env' | 'file' | 'generated' | ''

    /** Whether CLI API token was newly generated (for first-run display) */
    public readonly cliApiTokenIsNew: boolean

    /** Web 登录专用 token（与 cliApiToken 独立） */
    public readonly webApiToken: string

    /** Web API token 来源 */
    public readonly webApiTokenSource: 'env' | 'file' | 'generated' | ''

    /** Web API token 是否为新生成（首次启动展示用） */
    public readonly webApiTokenIsNew: boolean

    /** Path to settings.hub.json file */
    public readonly settingsFile: string

    /** Data directory for credentials and state */
    public readonly dataDir: string

    /** SQLite DB path */
    public readonly dbPath: string

    /** Port for the HTTP service */
    public readonly listenPort: number

    /** Host/IP to bind the HTTP service to */
    public readonly listenHost: string

    /** Public URL for external access */
    public readonly publicUrl: string

    /** Allowed CORS origins for Web App + Socket.IO (comma-separated env override) */
    public readonly corsOrigins: string[]

    /** Hub 实例名称，用于 PWA 实例标识 */
    public readonly hubName: string

    /** Sources of each configuration value */
    public readonly sources: ConfigSources

    /** Private constructor - use createConfiguration() instead */
    private constructor(
        dataDir: string,
        dbPath: string,
        serverSettings: ServerSettings,
        sources: ServerSettingsResult['sources']
    ) {
        this.dataDir = dataDir
        this.dbPath = dbPath
        this.settingsFile = getSettingsFile(dataDir)

        // Apply server settings
        this.listenHost = serverSettings.listenHost
        this.listenPort = serverSettings.listenPort
        this.publicUrl = serverSettings.publicUrl
        this.corsOrigins = serverSettings.corsOrigins
        this.hubName = serverSettings.hubName

        // CLI API token - will be set by _setCliApiToken() before create() returns
        this.cliApiToken = ''
        this.cliApiTokenSource = ''
        this.cliApiTokenIsNew = false

        // Web API token - will be set by _setWebApiToken() before create() returns
        this.webApiToken = ''
        this.webApiTokenSource = ''
        this.webApiTokenIsNew = false

        // Store sources for logging (cliApiToken will be set by _setCliApiToken)
        this.sources = {
            ...sources,
        } as ConfigSources

        // Ensure data directory exists
        if (!existsSync(this.dataDir)) {
            mkdirSync(this.dataDir, { recursive: true })
        }
    }

    /** Create configuration asynchronously */
    static async create(): Promise<Configuration> {
        // 1. Determine data directory (env only - not persisted)
        const dataDir = process.env.MOBI_HOME
            ? process.env.MOBI_HOME.replace(/^~/, homedir())
            : join(homedir(), '.mobi')

        // Ensure data directory exists before loading settings
        if (!existsSync(dataDir)) {
            mkdirSync(dataDir, { recursive: true })
        }

        // 2. Determine DB path (env only - not persisted)
        const dbPath = process.env.DB_PATH
            ? process.env.DB_PATH.replace(/^~/, homedir())
            : join(dataDir, 'mobi.db')

        // 3. Load hub settings (with persistence)
        // 拆分迁移前置：旧 settings.json → settings.hub.json + settings.cli.json（一次性，
        // 解析失败会抛错终止启动，防静默丢配置）
        const { migrateLegacySettings } = await import('./config/migrateSettings')
        const migration = await migrateLegacySettings(dataDir)
        if (migration.reason === 'parse-error') {
            throw new Error(
                `Cannot parse legacy settings file in ${dataDir}. Please fix or remove it and restart.`
            )
        }

        const settingsResult = await loadServerSettings(dataDir)

        if (settingsResult.savedToFile) {
            hubLogger.info(`[Hub] Configuration saved to ${getSettingsFile(dataDir)}`)
        }

        // 4. Create configuration instance
        const config = new Configuration(
            dataDir,
            dbPath,
            settingsResult.settings,
            settingsResult.sources
        )

        // 5. Load CLI API token
        const tokenResult = await getOrCreateCliApiToken(dataDir)
        config._setCliApiToken(tokenResult.token, tokenResult.source, tokenResult.isNew)
        // co-located 便利：同目录存在 cli 配置且其无连接凭证时同步一份，
        // 保持「hub 首启 → 本机 cli 即连」的开箱体验；远程部署无同目录文件自动跳过
        await syncCliApiTokenToCoLocatedCli(dataDir, tokenResult.token)

        // 6. Load Web API token
        const webTokenResult = await getOrCreateWebApiToken(dataDir)
        config._setWebApiToken(webTokenResult.token, webTokenResult.source, webTokenResult.isNew)

        return config
    }

    /** Set CLI API token (called during async initialization) */
    _setCliApiToken(token: string, source: 'env' | 'file' | 'generated', isNew: boolean): void {
        (this as { cliApiToken: string }).cliApiToken = token
        ;(this as { cliApiTokenSource: string }).cliApiTokenSource = source
        ;(this as { cliApiTokenIsNew: boolean }).cliApiTokenIsNew = isNew
        ;(this.sources as { cliApiToken: string }).cliApiToken = source
    }

    /** Set Web API token（运行时热更新用，如 fs.watch 检测到轮换） */
    _setWebApiToken(token: string, source: 'env' | 'file' | 'generated', isNew: boolean): void {
        (this as { webApiToken: string }).webApiToken = token
        ;(this as { webApiTokenSource: string }).webApiTokenSource = source
        ;(this as { webApiTokenIsNew: boolean }).webApiTokenIsNew = isNew
        ;(this.sources as { webApiToken: string }).webApiToken = source
    }
}

// Singleton instance (set by createConfiguration)
let _configuration: Configuration | null = null

/**
 * Create and initialize configuration asynchronously.
 * Must be called once at startup before getConfiguration() can be used.
 */
export async function createConfiguration(): Promise<Configuration> {
    if (_configuration) {
        return _configuration
    }
    _configuration = await Configuration.create()
    return _configuration
}

/**
 * Reset the configuration singleton (for testing purposes only).
 */
export function resetConfiguration(): void {
    _configuration = null
}

/**
 * Get the initialized configuration.
 * Throws if createConfiguration() has not been called yet.
 */
export function getConfiguration(): Configuration {
    if (!_configuration) {
        throw new Error('Configuration not initialized. Call createConfiguration() first.')
    }
    return _configuration
}

// For compatibility - throws on access if not configured
export const configuration = new Proxy({} as Configuration, {
    get(_, prop) {
        return getConfiguration()[prop as keyof Configuration]
    }
})
