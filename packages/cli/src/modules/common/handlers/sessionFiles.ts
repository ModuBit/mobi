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

import { logger } from '@/ui/logger'
import { readdir, stat } from 'fs/promises'
import { join, resolve, isAbsolute } from 'path'
import { homedir } from 'os'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { validatePath, isWithinBlacklistedDir } from '../pathSecurity'
import { getErrorMessage, rpcError } from '../rpcResponses'
import { runStream as runRipgrepStream } from '@/modules/ripgrep/index'

const MAX_RESULTS = 50
const MAX_SEARCH_DEPTH = 10

interface ListSessionFilesRequest {
    path: string
}

interface FileEntry {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
    /** 相对于工作目录的完整路径（搜索模式下填充） */
    path?: string
}

interface ListSessionFilesResponse {
    success: boolean
    entries?: FileEntry[]
    error?: string
}

/**
 * 判断路径是否应触发 ripgrep 搜索
 * - 空字符串 → false（目录浏览 "."）
 * - 以 / 开头 → false（绝对路径，使用 readdir）
 * - 以 ~ 开头 → false（home 目录，使用 readdir）
 * - 包含 .. → false（父级引用，使用 readdir）
 * - 其余 → true（使用 ripgrep 模糊搜索）
 */
export function isSearchQuery(path: string): boolean {
    if (path === '' || path === '.') return false
    if (path.startsWith('/')) return false
    if (path.startsWith('~')) return false
    if (path.includes('..')) return false
    return true
}

/**
 * 解析 ripgrep --files 的输出为 FileEntry 数组
 * @param output ripgrep 的标准输出
 * @param limit 最大返回条目数
 */
export function parseRipgrepOutput(output: string, limit: number): FileEntry[] {
    const results: FileEntry[] = []
    let start = 0
    while (start < output.length && results.length < limit) {
        let end = output.indexOf('\n', start)
        if (end === -1) end = output.length
        const line = output.slice(start, end)
        if (line.length > 0) {
            const name = line.includes('/') ? line.slice(line.lastIndexOf('/') + 1) : line
            results.push({ name, type: 'file' as const, path: line })
        }
        start = end + 1
    }
    return results
}

/**
 * 路径段有序匹配：queryParts 各段按顺序出现在 filePath 中
 * 如 ['docs','hub'] 匹配 'docs/conventions/hub.md'
 */
export function pathMatchesQuery(filePath: string, queryParts: string[]): boolean {
    let from = 0
    for (const part of queryParts) {
        const idx = filePath.indexOf(part, from)
        if (idx === -1) return false
        from = idx + part.length
    }
    return true
}

/**
 * 从匹配的文件路径中提取名称匹配的目录
 * 去重，只返回最短匹配路径
 */
function extractMatchingDirs(
    matchedLines: string[],
    queryParts: string[],
): FileEntry[] {
    const seen = new Set<string>()
    const dirs: FileEntry[] = []

    for (const line of matchedLines) {
        const parts = line.split('/')
        for (let i = 1; i < parts.length; i++) {
            const dirPath = parts.slice(0, i).join('/')
            if (seen.has(dirPath)) continue
            if (pathMatchesQuery(dirPath.toLowerCase(), queryParts)) {
                seen.add(dirPath)
                dirs.push({ name: parts[i - 1], type: 'directory', path: dirPath })
            }
        }
    }

    return dirs
}

/**
 * 按类型过滤搜索结果（search-files 的 type 参数实现）。
 * - type='file' → 仅文件（fileEntries 已在调用前 cap 到 MAX_RESULTS）
 * - type='directory' → 仅目录，cap MAX_RESULTS
 * - 不传 → 目录 + 文件合并 cap MAX_RESULTS（向后兼容：composer @ 默认行为）
 */
export function applyTypeFilter(
    dirEntries: FileEntry[],
    fileEntries: FileEntry[],
    type?: 'file' | 'directory',
): FileEntry[] {
    if (type === 'file') return fileEntries
    if (type === 'directory') return dirEntries.slice(0, MAX_RESULTS)
    return [...dirEntries, ...fileEntries].slice(0, MAX_RESULTS)
}

/**
 * 从 query 中解析最长已存在的目录前缀
 * 如 "docs/architecture/hu" → { dirPrefix: "docs/architecture", matchParts: ["hu"] }
 * 如 "hub" → { dirPrefix: "", matchParts: ["hub"] }
 */
async function resolveDirPrefix(
    workingDirectory: string,
    queryParts: string[],
): Promise<{ dirPrefix: string; matchParts: string[] }> {
    if (queryParts.length <= 1) {
        return { dirPrefix: '', matchParts: queryParts }
    }

    let dirPrefix = ''
    let consumedParts = 0
    for (let i = 0; i < queryParts.length - 1; i++) {
        const candidate = dirPrefix ? `${dirPrefix}/${queryParts[i]}` : queryParts[i]
        try {
            const s = await stat(join(workingDirectory, candidate))
            if (!s.isDirectory()) break
            dirPrefix = candidate
            consumedParts = i + 1
        } catch {
            break
        }
    }

    return { dirPrefix, matchParts: queryParts.slice(consumedParts) }
}

/**
 * 使用 ripgrep 模糊搜索文件和目录（路径子串匹配）
 */
async function searchFiles(workingDirectory: string, query: string, type?: 'file' | 'directory'): Promise<FileEntry[]> {
    try {
        const allParts = query.toLowerCase().split('/').filter(p => p.length > 0)
        const { dirPrefix, matchParts } = await resolveDirPrefix(workingDirectory, allParts)

        const rgCwd = dirPrefix ? join(workingDirectory, dirPrefix) : workingDirectory
        const prefixPath = dirPrefix ? dirPrefix + '/' : ''

        const matchedLines: string[] = []
        const maxCollect = MAX_RESULTS * 2

        await runRipgrepStream(
            ['--files', '--max-depth', String(MAX_SEARCH_DEPTH)],
            (line) => {
                if (matchParts.length === 0 || pathMatchesQuery(line.toLowerCase(), matchParts)) {
                    matchedLines.push(line)
                }
                return matchedLines.length < maxCollect
            },
            { cwd: rgCwd },
        )

        const fullPaths = matchedLines.map(l => prefixPath + l)
        // 补 size/modified：让搜索结果 Tooltip 与树展开视图信息密度一致（stat 失败降级无元信息）
        const fileEntries: FileEntry[] = await Promise.all(
            fullPaths.slice(0, MAX_RESULTS).map(async (p) => {
                const name = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p
                try {
                    const stats = await stat(join(workingDirectory, p))
                    return {
                        name,
                        type: 'file' as const,
                        path: p,
                        size: stats.size,
                        modified: stats.mtime.getTime(),
                    }
                } catch {
                    return { name, type: 'file' as const, path: p }
                }
            }),
        )
        // type=file 时跳过 extractMatchingDirs（仅文件场景无需推导目录，省后处理）
        const dirEntries = type === 'file' ? [] : extractMatchingDirs(fullPaths, allParts)

        return applyTypeFilter(dirEntries, fileEntries, type)
    } catch (error) {
        logger.debug('ripgrep 搜索失败:', error)
        return []
    }
}

/**
 * 按前缀过滤条目名（大小写不敏感，startsWith 语义）
 *
 * 大目录（如 home）下条目可能远超 MAX_RESULTS，若先 slice 再过滤，
 * 字母序靠后的匹配项（如 `workspace`）会被截掉。
 * 故在排序/截断前先用 prefix 收窄候选集，保证匹配项必在结果内。
 *
 * @param entries 待过滤条目
 * @param prefix 名字前缀，空值返回原数组（保持目录浏览全量行为）
 */
export function filterByPrefix(entries: FileEntry[], prefix?: string): FileEntry[] {
    if (!prefix) return entries
    const lower = prefix.toLowerCase()
    return entries.filter((e) => e.name.toLowerCase().startsWith(lower))
}

async function listDirectory(targetPath: string, prefix?: string): Promise<FileEntry[]> {
    const entries = await readdir(targetPath, { withFileTypes: true })

    const fileEntries: FileEntry[] = await Promise.all(
        entries.map(async (entry) => {
            const fullPath = join(targetPath, entry.name)
            let type: 'file' | 'directory' | 'other' = 'other'
            let size: number | undefined
            let modified: number | undefined

            if (entry.isDirectory()) {
                type = 'directory'
            } else if (entry.isFile()) {
                type = 'file'
            }

            try {
                const stats = await stat(fullPath)
                size = stats.size
                modified = stats.mtime.getTime()
            } catch {
                // 无法获取 stat 的文件跳过
            }

            return { name: entry.name, type, size, modified }
        })
    )

    // 先按 prefix 过滤，再排序、再截断 —— 避免大目录下匹配项被 MAX_RESULTS 截掉
    const filtered = filterByPrefix(fileEntries, prefix)
    filtered.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1
        if (a.type !== 'directory' && b.type === 'directory') return 1
        return a.name.localeCompare(b.name)
    })

    return filtered.slice(0, MAX_RESULTS)
}

function isWithinWorkingDir(targetPath: string, workingDirectory: string): boolean {
    const resolved = resolve(workingDirectory, targetPath)
    const normalizedTarget = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    const normalizedWorkingDir = process.platform === 'win32' ? workingDirectory.toLowerCase() : workingDirectory
    const prefix = normalizedWorkingDir.endsWith('/') ? normalizedWorkingDir : normalizedWorkingDir + '/'
    return normalizedTarget === normalizedWorkingDir || normalizedTarget.startsWith(prefix)
}

/**
 * 校验 RPC 参数中的 cwd 是否在安全范围内
 * 纵深防御：即使 hub 侧已校验，CLI 侧也确保 cwd 在 home 目录内
 */
function validateRpcCwd(cwd: string): boolean {
    const resolved = resolve(cwd)
    const home = homedir()
    const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    const normalizedHome = process.platform === 'win32' ? home.toLowerCase() : home
    const homePrefix = normalizedHome.endsWith('/') ? normalizedHome : normalizedHome + '/'
    return normalized === normalizedHome || normalized.startsWith(homePrefix)
}

export function registerSessionFilesHandler(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    // 接口 1：ripgrep 模糊搜索（工作目录内）
    rpcHandlerManager.registerHandler<{ query: string, cwd?: string, type?: 'file' | 'directory' }, ListSessionFilesResponse>('searchSessionFiles', async (data) => {
        // 优先使用 RPC 参数中的 cwd，否则使用注册时的 workingDirectory
        const effectiveCwd = data.cwd || workingDirectory
        if (data.cwd && !validateRpcCwd(data.cwd)) {
            return rpcError('Invalid cwd: path is outside home directory')
        }
        if (data.cwd && isWithinBlacklistedDir(data.cwd, homedir())) {
            return rpcError('Access denied: path is in a restricted directory')
        }
        logger.debug('Search session files request:', data.query)

        try {
            const entries = await searchFiles(effectiveCwd, data.query, data.type)
            return { success: true, entries }
        } catch (error) {
            return rpcError(getErrorMessage(error, 'Failed to search files'))
        }
    })

    // 接口 2：目录列表（工作目录内 + 外）
    rpcHandlerManager.registerHandler<ListSessionFilesRequest & { cwd?: string; prefix?: string }, ListSessionFilesResponse>('listSessionDirectory', async (data) => {
        // 优先使用 RPC 参数中的 cwd，否则使用注册时的 workingDirectory
        const effectiveCwd = data.cwd || workingDirectory
        if (data.cwd && !validateRpcCwd(data.cwd)) {
            return rpcError('Invalid cwd: path is outside home directory')
        }
        if (data.cwd && isWithinBlacklistedDir(data.cwd, homedir())) {
            return rpcError('Access denied: path is in a restricted directory')
        }
        logger.debug('List session directory request:', data.path)

        try {
            let targetPath = data.path || '.'

            // 展开 ~/ 为 home 目录
            if (targetPath.startsWith('~')) {
                targetPath = join(homedir(), targetPath.slice(1))
            }

            // 解析为绝对路径：已是绝对路径时直接使用，否则相对 effectiveCwd 解析
            const resolvedPath = isAbsolute(targetPath)
                ? targetPath
                : resolve(effectiveCwd, targetPath)

            // 工作目录内：校验路径安全性
            if (isWithinWorkingDir(resolvedPath, effectiveCwd)) {
                const validation = validatePath(resolvedPath, effectiveCwd)
                if (!validation.valid) {
                    return rpcError(validation.error ?? 'Invalid path')
                }
            } else {
                // 工作目录外：验证目标是存在的目录
                try {
                    const stats = await stat(resolvedPath)
                    if (!stats.isDirectory()) {
                        return rpcError('Path is not a directory')
                    }
                } catch {
                    return rpcError('Directory does not exist or is not accessible')
                }
            }

            const entries = await listDirectory(resolvedPath, data.prefix)
            return { success: true, entries }
        } catch (error) {
            return rpcError(getErrorMessage(error, 'Failed to list directory'))
        }
    })
}
