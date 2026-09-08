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
 * 带路径解析的校验结果（validateReadPath / validateWritePath 专用判别联合）：
 * valid=true 时 guaranteed 携带展开 ~ 后的绝对路径——调用方直接用它读写，
 * 杜绝「校验对象 ≠ 实际读写对象」的二次手抄解析漂移。
 */
export type PathResolution =
    | { valid: true; resolvedPath: string }
    | { valid: false; error: string }

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
 * 校验 target 是否落在 base 目录内（含等于 base）。
 * 用于 serve-file 的 cwd 边界：相对路径 resolve 后必须仍在 session 工作目录内。
 * resolve 已规范化 `..`，所以 `/proj/../etc` 会先 resolve 成 `/etc` 再判定 → 正确逃出。
 */
export function isWithinDir(target: string, base: string): boolean {
    if (!base) return false
    const norm = (p: string) => process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p)
    const t = norm(target)
    const b = norm(base)
    const prefix = b.endsWith(sep) ? b : b + sep
    return t === b || t.startsWith(prefix)
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

/**
 * `~` 前缀展开为 homeDir：仅支持裸 `~` 与 `~/` 前缀（HOME_PREFIX_RE 单源判定）；
 * `~user` 多用户语义不支持，按字面路径处理。非 `~` 开头或 homeDir 为空时原样返回——
 * homeDir 为空时 `~` 前缀路径的拒绝由 validateReadPath / validateWritePath 显式承担。
 */
export function expandHomePath(targetPath: string, homeDir: string): string {
    if (HOME_PREFIX_RE.test(targetPath)) {
        return homeDir ? resolve(homeDir, targetPath === '~' ? '' : targetPath.slice(2)) : targetPath
    }
    return targetPath
}

/** `~` 前缀（裸 `~` 或 `~/`）——homeDir 缺失时保留语义、显式拒绝，而非当字面目录名放行 */
const HOME_PREFIX_RE = /^~(\/|$)/

/**
 * 读路径解析（读边界的唯一解析出口）：`~` 展开后相对 cwd resolve。
 * validateReadPath 与所有需要 abs 路径的调用方共用，保证「校验对象 = 实际读取对象」。
 */
export function resolveReadPath(targetPath: string, workingDirectory: string, homeDir: string): string {
    return resolve(workingDirectory, expandHomePath(targetPath, homeDir))
}

/**
 * 读边界校验（ADR 0004）：允许集 = cwd 子树 ∪ (home 子树 − 黑名单)，其余一律拒绝。
 *
 * - 黑名单先于一切允许域判定：cwd 恰为 home 时 `.ssh` 等仍受保护；黑名单只匹配
 *   home 直接子级，cwd 内同名目录（如 `src/.config/`、`.mobi/uploads/` 附件）不误伤
 * - `~` 前缀先展开再判定（resolve(cwd, '~/x') 会把 `~` 当字面目录名，必须先行展开）；
 *   homeDir 缺失时 `~` 前缀显式拒绝——语义保留给 home 展开，不降级为字面目录名
 * - 相对/绝对双支持：`resolve(cwd, path)` 的 POSIX 语义——绝对路径忽略 cwd 直接采用
 * - valid 时返回 resolvedPath（展开后的绝对路径），调用方直接用它做实际读取
 */
export function validateReadPath(targetPath: string, workingDirectory: string, homeDir: string): PathResolution {
    if (!homeDir && HOME_PREFIX_RE.test(targetPath)) {
        return { valid: false, error: `Access denied: '~' paths require a configured home directory` }
    }
    const resolvedTarget = resolveReadPath(targetPath, workingDirectory, homeDir)

    if (homeDir && isWithinBlacklistedDir(resolvedTarget, homeDir)) {
        return { valid: false, error: `Access denied: Path '${targetPath}' is in a protected directory` }
    }
    if (isWithinDir(resolvedTarget, workingDirectory)) return { valid: true, resolvedPath: resolvedTarget }
    if (homeDir) {
        const homeCheck = validateHomeDirPath(resolvedTarget, homeDir)
        if (!homeCheck.valid) return { valid: false, error: homeCheck.error ?? `Access denied: Path '${targetPath}' is outside the home directory` }
        return { valid: true, resolvedPath: resolvedTarget }
    }
    return { valid: false, error: `Access denied: Path '${targetPath}' is outside the working directory` }
}

/**
 * 写边界校验（ADR 0004）：严格 cwd 子树，`~` 展开内聚于此——调用方无需记忆
 * 「写前先展开」。与读边界分离：读放宽不放大写风险。homeDir 缺失时 `~` 前缀
 * 显式拒绝（同读边界）。valid 时返回 resolvedPath，调用方直接用它做实际写入。
 */
export function validateWritePath(targetPath: string, workingDirectory: string, homeDir: string): PathResolution {
    if (!homeDir && HOME_PREFIX_RE.test(targetPath)) {
        return { valid: false, error: `Access denied: '~' paths require a configured home directory` }
    }
    const resolvedTarget = resolveReadPath(targetPath, workingDirectory, homeDir)
    if (isWithinDir(resolvedTarget, workingDirectory)) return { valid: true, resolvedPath: resolvedTarget }
    return { valid: false, error: `Access denied: Path '${targetPath}' is outside the working directory` }
}
