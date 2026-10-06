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
import { mkdir, open, readFile, rename, stat, unlink, writeFile, chmod, type FileHandle } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Daemon 专属设置（settings.daemon.json）。
 *
 * 2026-09-05 起配置文件按部署归属拆分：daemon 与 cli 支持不同机器部署，
 * daemon 不再与 cli 共享一份 settings.json（cli 侧为 settings.cli.json）。
 * 2026-10-06 起 hub 概念随单机 daemon 定稿更名 daemon（remove-machine 501），
 * 文件名 settings.hub.json → settings.daemon.json（读旧写新，见 migrateSettings）。
 */
export interface Settings {
    /** CLI 接入验证基准（daemon 权威；co-located 首启会同步一份到 settings.cli.json） */
    cliApiToken?: string
    /** Web 浏览器登录凭证（纯 daemon；settingsWatcher 热更新） */
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
    /** 实例名称（PWA 实例标识）；旧名 hubName 由读取侧兼容（serverSettings 读旧写新） */
    daemonName?: string
}

/** daemon 配置文件（本文件字段的唯一持久化位置） */
export function getSettingsFile(dataDir: string): string {
    return join(dataDir, 'settings.daemon.json')
}

/** 文件名定稿前的旧名（迁移源；迁移后 rename 为新名，见 migrateSettings） */
export function getLegacyHubSettingsFile(dataDir: string): string {
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

    // 锁文件落盘前确保父目录存在（与 writeSettings 的 mkdir 一致），
    // 否则对尚不存在目录的首次写会在 open 锁文件时 ENOENT
    if (!existsSync(dirname(settingsFile))) {
        await mkdir(dirname(settingsFile), { recursive: true, mode: 0o700 })
    }

    const lockFile = settingsFile + '.lock'
    let fileHandle: FileHandle | null = null
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

/**
 * 原子写 temp + rename；调用方须自行持锁（经 withSettingsLock），
 * 或直接用 updateSettingsFile（锁内的读-改-写）——否则会与 cli 受限写互踩（lost update）。
 */
export async function writeSettings(settingsFile: string, settings: Settings): Promise<void> {
    const dir = dirname(settingsFile)
    if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true, mode: 0o700 })
    }

    const tmpFile = settingsFile + '.tmp'
    await writeFile(tmpFile, JSON.stringify(settings, null, 2))
    // settings 含 token 凭证（ticket-21 收紧）：落盘前限权，rename 保留 tmp 权限——
    // chmod 在 rename 前做，避免内容已就位但权限还宽的窗口
    await chmod(tmpFile, 0o600)
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
        // mutate 前快照：updater 两种风格都兼容——原地修改（writeValue 契约）与新对象（spread）
        const before = JSON.stringify(current)
        const updated = await updater(current)
        // 值未变不写盘：get-or-create 命中、迁移补缺无缺等纯读路径不刷新 mtime
        //（否则每次 hub 启动多次无谓 I/O，且触发 settingsWatcher 的目录事件）
        if (JSON.stringify(updated) === before) {
            return updated
        }
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
