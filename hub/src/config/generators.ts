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

import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { readSettingsOrThrow, writeSettings, type Settings } from './settings'

/**
 * 获取或创建操作的结果类型
 * @template T - 值的类型
 * @property value - 获取或创建的值
 * @property created - 是否为新创建的值（true 表示新创建，false 表示已存在）
 */
export type GetOrCreateResult<T> = {
    value: T
    created: boolean
}

/**
 * 设置值读取结果类型
 * @template T - 值的类型
 * @property value - 读取到的值
 * @property writeBack - 是否需要将设置写回文件（用于修复或迁移场景）
 */
export type SettingsValueReadResult<T> = {
    value: T
    writeBack?: boolean
}

/**
 * 从设置文件中获取或创建配置值
 *
 * 该函数实现了"存在则读取，不存在则生成并保存"的模式，适用于需要持久化的配置项初始化场景。
 *
 * @template T - 配置值的类型
 * @param options.settingsFile - 设置文件的路径
 * @param options.readValue - 从设置对象中读取值的函数，返回 null 表示值不存在
 * @param options.writeValue - 将值写入设置对象的函数
 * @param options.generate - 生成新值的函数（当值不存在时调用）
 * @returns 包含值和创建状态的 Promise
 *
 * @example
 * ```typescript
 * const result = await getOrCreateSettingsValue({
 *   settingsFile: '/path/to/settings.json',
 *   readValue: (settings) => settings.apiKey ? { value: settings.apiKey } : null,
 *   writeValue: (settings, value) => { settings.apiKey = value },
 *   generate: () => crypto.randomUUID()
 * })
 * console.log(result.value)   // API密钥
 * console.log(result.created) // 是否为新创建
 * ```
 */
export async function getOrCreateSettingsValue<T>(options: {
    settingsFile: string
    readValue: (settings: Settings) => SettingsValueReadResult<T> | null
    writeValue: (settings: Settings, value: T) => void
    generate: () => T
}): Promise<GetOrCreateResult<T>> {
    const settings = await readSettingsOrThrow(options.settingsFile)
    const existing = options.readValue(settings)
    if (existing) {
        if (existing.writeBack) {
            await writeSettings(options.settingsFile, settings)
        }
        return { value: existing.value, created: false }
    }

    const generated = options.generate()
    options.writeValue(settings, generated)
    await writeSettings(options.settingsFile, settings)
    return { value: generated, created: true }
}

/**
 * 获取或创建 JSON 文件内容
 *
 * 该函数实现了"文件存在则读取，不存在则生成并写入"的模式，适用于独立的 JSON 配置文件管理。
 * 会自动创建不存在的父目录，并设置适当的文件权限。
 *
 * @template T - JSON 内容的类型
 * @param options.filePath - JSON 文件的路径
 * @param options.readValue - 从原始字符串解析值的函数
 * @param options.writeValue - 将值序列化为字符串的函数
 * @param options.generate - 生成新值的函数（当文件不存在时调用）
 * @param options.fileMode - 文件权限模式，默认 0o600（仅所有者可读写）
 * @param options.dirMode - 目录权限模式，默认 0o700（仅所有者可访问）
 * @returns 包含值和创建状态的 Promise
 *
 * @example
 * ```typescript
 * interface TokenStore { accessToken: string; refreshToken: string }
 *
 * const result = await getOrCreateJsonFile<TokenStore>({
 *   filePath: '/path/to/tokens.json',
 *   readValue: (raw) => JSON.parse(raw),
 *   writeValue: (value) => JSON.stringify(value, null, 2),
 *   generate: () => ({ accessToken: '', refreshToken: '' })
 * })
 * console.log(result.value)   // TokenStore 对象
 * console.log(result.created) // 是否为新创建
 * ```
 */
export async function getOrCreateJsonFile<T>(options: {
    filePath: string
    readValue: (raw: string) => T
    writeValue: (value: T) => string
    generate: () => T
    fileMode?: number
    dirMode?: number
}): Promise<GetOrCreateResult<T>> {
    const fileMode = options.fileMode ?? 0o600
    const dirMode = options.dirMode ?? 0o700

    if (existsSync(options.filePath)) {
        await chmod(options.filePath, fileMode).catch(() => {})
        const raw = await readFile(options.filePath, 'utf8')
        return { value: options.readValue(raw), created: false }
    }

    const generated = options.generate()
    const dir = dirname(options.filePath)
    if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true, mode: dirMode })
    }

    await writeFile(options.filePath, options.writeValue(generated), { mode: fileMode })
    await chmod(options.filePath, fileMode).catch(() => {})
    return { value: generated, created: true }
}
