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

import { hubLogger } from '../logger'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Hub 专属设置（settings.hub.json）。
 *
 * 2026-09-05 起配置文件按部署归属拆分：hub 与 cli 支持不同机器部署，
 * hub 不再与 cli 共享一份 settings.json（cli 侧为 settings.cli.json）。
 */
export interface Settings {
    /** CLI 接入验证基准（hub 权威；co-located 首启会同步一份到 settings.cli.json） */
    cliApiToken?: string
    /** Web 浏览器登录凭证（纯 hub；settingsWatcher 热更新） */
    webApiToken?: string
    vapidKeys?: {
        publicKey: string
        privateKey: string
    }
    // Server configuration (persisted from environment variables)
    listenHost?: string
    listenPort?: number
    publicUrl?: string
    corsOrigins?: string[]
    hubName?: string
}

/** hub 配置文件（本文件字段的唯一持久化位置） */
export function getSettingsFile(dataDir: string): string {
    return join(dataDir, 'settings.hub.json')
}

/** 拆分前的旧单文件（迁移源；迁移后 rename 为 .bak） */
export function getLegacySettingsFile(dataDir: string): string {
    return join(dataDir, 'settings.json')
}

/** cli 配置文件路径（仅迁移与 co-located cliApiToken 同步时代写） */
export function getCliSettingsFile(dataDir: string): string {
    return join(dataDir, 'settings.cli.json')
}

/**
 * 设置文件多进程锁（对称实现 cli 侧 persistence.updateSettings 的锁协议）。
 * 锁文件 = 目标文件 + '.lock'；wx 独占创建 + 重试 + stale 清理，锁内读-改-写。
 * hub 启动写点与 cli 受限写共用同一锁文件，消除此前互不感知的 lost-update 竞争。
 */
export async function withSettingsLock<T>(
    settingsFile: string,
    fn: () => Promise<T>
): Promise<T> {
    const LOCK_RETRY_INTERVAL_MS = 100
    const MAX_LOCK_ATTEMPTS = 50
    const STALE_LOCK_TIMEOUT_MS = 10000

    const { open, stat, unlink } = await import('node:fs/promises')
    const lockFile = settingsFile + '.lock'
    let fileHandle: import('node:fs/promises').FileHandle | null = null
    let attempts = 0

    while (attempts < MAX_LOCK_ATTEMPTS) {
        try {
            fileHandle = await open(lockFile, 'wx')
            break
        } catch (err: unknown) {
            if (err && typeof err === 'object' && (err as { code?: unknown }).code === 'EEXIST') {
                attempts++
                await new Promise(resolve => setTimeout(resolve, LOCK_RETRY_INTERVAL_MS))
                try {
                    const stats = await stat(lockFile)
                    if (Date.now() - stats.mtimeMs > STALE_LOCK_TIMEOUT_MS) {
                        await unlink(lockFile).catch(() => {})
                    }
                } catch { /* stale 检查失败不阻塞 */ }
            } else {
                throw err
            }
        }
    }

    if (!fileHandle) {
        throw new Error(`Failed to acquire settings lock after ${MAX_LOCK_ATTEMPTS * LOCK_RETRY_INTERVAL_MS / 1000} seconds`)
    }

    try {
        return await fn()
    } finally {
        await fileHandle.close()
        await unlink(lockFile).catch(() => {})
    }
}

/**
 * Read settings from file, preserving all existing fields.
 * Returns null if file exists but cannot be parsed (to avoid data loss).
 */
export async function readSettings(settingsFile: string): Promise<Settings | null> {
    if (!existsSync(settingsFile)) {
        return {}
    }
    try {
        const content = await readFile(settingsFile, 'utf8')
        return JSON.parse(content)
    } catch (error) {
        // Return null to signal parse error - caller should not overwrite
        hubLogger.error(`[WARN] Failed to parse ${settingsFile}: ${error}`)
        return null
    }
}

export async function readSettingsOrThrow(settingsFile: string): Promise<Settings> {
    const settings = await readSettings(settingsFile)
    if (settings === null) {
        throw new Error(
            `Cannot read ${settingsFile}. Please fix or remove the file and restart.`
        )
    }
    return settings
}

/**
 * Write settings to file atomically (temp file + rename).
 * 调用方须自行持锁（经 withSettingsLock），或直接用 updateSettingsFile。
 */
export async function writeSettings(settingsFile: string, settings: Settings): Promise<void> {
    const dir = dirname(settingsFile)
    if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true, mode: 0o700 })
    }

    const tmpFile = settingsFile + '.tmp'
    await writeFile(tmpFile, JSON.stringify(settings, null, 2))
    await rename(tmpFile, settingsFile)
}

/**
 * 锁内的读-改-写：与 cli 侧 updateSettings 同款协议（同锁文件命名约定），
 * 所有对 hub 设置文件的写都应走此入口，避免与 cli 受限写互踩（lost update）。
 * 泛型 S 允许对 cli 配置文件（settings.cli.json，形状归 cli 包定义）做受限写。
 */
export async function updateSettingsFile<S extends object = Settings>(
    settingsFile: string,
    updater: (current: S) => S | Promise<S>
): Promise<S> {
    return withSettingsLock(settingsFile, async () => {
        const current = await readSettingsRaw<S>(settingsFile)
        const updated = await updater(current)
        await writeSettings(settingsFile, updated as Settings)
        return updated
    })
}

/** 读任意 JSON 对象（不存在返回空对象，解析失败抛错）——供泛型受限写使用 */
async function readSettingsRaw<S>(settingsFile: string): Promise<S> {
    if (!existsSync(settingsFile)) {
        return {} as S
    }
    return JSON.parse(await readFile(settingsFile, 'utf8')) as S
}
