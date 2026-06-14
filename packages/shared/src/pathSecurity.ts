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

import { resolve, sep } from 'path'

export interface PathValidationResult {
    valid: boolean
    error?: string
}

/**
 * 校验路径是否在 homeDir 范围内
 * @param targetPath 目标路径（绝对路径）
 * @param homeDir 用户 home 目录（绝对路径）
 */
export function validateHomeDirPath(targetPath: string, homeDir: string): PathValidationResult {
    if (!homeDir) {
        return { valid: false, error: 'Home directory not configured' }
    }

    const resolvedTarget = resolve(targetPath)
    const resolvedHome = resolve(homeDir)

    const normalizedTarget = process.platform === 'win32' ? resolvedTarget.toLowerCase() : resolvedTarget
    const normalizedHome = process.platform === 'win32' ? resolvedHome.toLowerCase() : resolvedHome
    const homePrefix = normalizedHome.endsWith(sep) ? normalizedHome : normalizedHome + sep

    if (normalizedTarget !== normalizedHome && !normalizedTarget.startsWith(homePrefix)) {
        return { valid: false, error: `Access denied: Path '${targetPath}' is outside the home directory` }
    }

    return { valid: true }
}

/**
 * 默认风险目录黑名单（相对 home 的目录名）
 * 含密钥/凭证/工具配置等敏感目录，禁止 ripgrep/list 访问
 */
export const DEFAULT_BLACKLISTED_DIR_NAMES = [
    '.ssh', '.aws', '.gnupg', '.config', '.claude', '.agents', '.mobi',
] as const

/**
 * 解析黑名单目录绝对路径（默认 + 环境变量扩展）
 * 环境变量 MOBI_SEARCH_BLACKLIST 为逗号分隔的额外目录名（相对 home），如 ".secrets,private"
 */
export function resolveBlacklistedDirs(homeDir: string): string[] {
    const extra = process.env.MOBI_SEARCH_BLACKLIST
        ?.split(',').map(s => s.trim()).filter(Boolean) ?? []
    const names = [...DEFAULT_BLACKLISTED_DIR_NAMES, ...extra]
    return [...new Set(names)].map(name => resolve(homeDir, name))
}

/**
 * 校验路径是否落入风险目录黑名单（仅匹配 home 直接子级，避免误伤项目内同名目录）
 * @returns true 表示路径被黑名单拦截
 */
export function isWithinBlacklistedDir(targetPath: string, homeDir: string): boolean {
    if (!homeDir) return false
    const normalizedTarget = resolve(targetPath)
    const blocked = resolveBlacklistedDirs(homeDir)
    const norm = (p: string) => process.platform === 'win32' ? p.toLowerCase() : p
    const target = norm(normalizedTarget)
    return blocked.some(dir => {
        const normalizedDir = norm(dir)
        const prefix = normalizedDir.endsWith(sep) ? normalizedDir : normalizedDir + sep
        return target === normalizedDir || target.startsWith(prefix)
    })
}
