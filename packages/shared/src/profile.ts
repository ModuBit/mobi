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
 * Profile 环境隔离机制
 *
 * 通过 --profile <name> 参数加载 ~/.mobi/profiles/<name>.env 文件，
 * 将其中定义的环境变量注入 process.env（不覆盖已有值）。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'

/** 获取默认 MOBI_HOME 目录（固定，不随 profile 切换） */
function getDefaultMobiHome(): string {
    return process.env.MOBI_HOME
        ? process.env.MOBI_HOME.replace(/^~/, homedir())
        : join(homedir(), '.mobi')
}

/** 获取 profile 文件所在目录 */
export function getProfilesDir(customDir?: string): string {
    return customDir ?? join(getDefaultMobiHome(), 'profiles')
}

/** 获取指定 profile 的文件路径 */
export function getProfilePath(name: string, customDir?: string): string {
    return join(getProfilesDir(customDir), `${name}.env`)
}

/** 列出所有已定义的 profile 名称 */
export function listProfiles(customDir?: string): string[] {
    const dir = getProfilesDir(customDir)
    if (!existsSync(dir)) {
        return []
    }

    try {
        return readdirSync(dir)
            .filter(f => f.endsWith('.env'))
            .map(f => basename(f, '.env'))
            .sort()
    } catch {
        return []
    }
}

/**
 * 解析 env 文件内容为键值对
 * - 支持 # 注释和空行
 * - 值可以包含等号
 * - 不做变量插值
 */
export function parseEnvFile(content: string): Record<string, string> {
    const result: Record<string, string> = {}

    for (const rawLine of content.split('\n')) {
        // 去除前后空格
        const line = rawLine.trim()
        // 跳过空行和注释
        if (!line || line.startsWith('#')) {
            continue
        }

        const eqIndex = line.indexOf('=')
        if (eqIndex === -1) {
            continue
        }

        const key = line.slice(0, eqIndex).trim()
        const value = line.slice(eqIndex + 1).trim()

        if (key) {
            result[key] = value
        }
    }

    return result
}

/**
 * 从命令行参数中提取 --profile 名称，加载对应 env 文件注入 process.env
 *
 * - 已设置的环境变量不会被覆盖（保证显式环境变量优先）
 * - --profile 参数会从 args 数组中原地移除，避免下游命令误解析
 * - 支持两种格式：`--profile name` 和 `--profile=name`
 *
 * @param args 命令行参数数组（会被原地修改）
 * @param customDir 可选的 profile 目录覆盖（用于测试）
 * @returns 实际加载的 profile 名称，或 undefined
 */
export function loadProfile(
    args: string[],
    customDir?: string
): string | undefined {
    // 查找 --profile 参数
    let profileName: string | undefined
    let profileIndex = -1
    let removeCount = 0

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--profile' && i + 1 < args.length) {
            profileName = args[i + 1]
            profileIndex = i
            removeCount = 2
            break
        }
        if (args[i].startsWith('--profile=')) {
            profileName = args[i].slice('--profile='.length)
            profileIndex = i
            removeCount = 1
            break
        }
    }

    if (profileName === undefined) {
        return undefined
    }

    // 读取并解析 profile 文件
    const profilePath = getProfilePath(profileName, customDir)
    if (!existsSync(profilePath)) {
        throw new Error(
            `Profile "${profileName}" 不存在。` +
            `请创建 ${profilePath} 文件。` +
            `可用 profiles: ${listProfiles(customDir).join(', ') || '无'}`
        )
    }

    const content = readFileSync(profilePath, 'utf-8')
    const envVars = parseEnvFile(content)

    // 注入环境变量（不覆盖已有值）
    for (const [key, value] of Object.entries(envVars)) {
        if (process.env[key] === undefined) {
            process.env[key] = value
        }
    }

    // 从 args 中移除 --profile 参数
    args.splice(profileIndex, removeCount)

    return profileName
}
