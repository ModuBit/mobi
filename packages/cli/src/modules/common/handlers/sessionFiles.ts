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
import { join, resolve } from 'path'
import { homedir } from 'os'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { validatePath } from '../pathSecurity'
import { getErrorMessage, rpcError } from '../rpcResponses'
import { run as runRipgrep } from '@/modules/ripgrep/index'

/** 最大返回条目数 */
const MAX_RESULTS = 50

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
    const lines = output.split('\n').filter(line => line.length > 0)
    return lines.slice(0, limit).map(line => {
        const name = line.includes('/') ? line.slice(line.lastIndexOf('/') + 1) : line
        return { name, type: 'file' as const, path: line }
    })
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
 * 使用 ripgrep 模糊搜索文件和目录（路径子串匹配）
 * @param workingDirectory 工作目录
 * @param query 搜索关键词（在完整路径中做子串匹配）
 */
async function searchFiles(workingDirectory: string, query: string): Promise<FileEntry[]> {
    try {
        const result = await runRipgrep(['--files'], { cwd: workingDirectory })

        if (result.exitCode !== 0 && result.exitCode !== 1) {
            logger.debug(`ripgrep 异常退出 (code=${result.exitCode}): ${result.stderr}`)
            return []
        }

        // 按路径段拆分 query，做有序匹配
        // 如 "docs/hub" → ['docs','hub']，匹配 "docs/conventions/hub.md"
        const queryParts = query.toLowerCase().split('/').filter(p => p.length > 0)

        const matchedLines = result.stdout
            .split('\n')
            .filter(line => line.length > 0 && pathMatchesQuery(line.toLowerCase(), queryParts))

        const dirEntries = extractMatchingDirs(matchedLines, queryParts)
        const fileEntries = parseRipgrepOutput(matchedLines.join('\n'), MAX_RESULTS)

        return [...dirEntries, ...fileEntries].slice(0, MAX_RESULTS)
    } catch (error) {
        logger.debug('ripgrep 搜索失败:', error)
        return []
    }
}

/**
 * 列出指定目录下的文件和子目录
 * @param targetPath 目标目录的绝对路径
 */
async function listDirectory(targetPath: string): Promise<FileEntry[]> {
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

    // 目录优先，同类型按名称排序
    fileEntries.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1
        if (a.type !== 'directory' && b.type === 'directory') return 1
        return a.name.localeCompare(b.name)
    })

    // 限制返回条目数
    return fileEntries.slice(0, MAX_RESULTS)
}

/**
 * 判断路径是否在工作目录范围内
 */
function isWithinWorkingDir(targetPath: string, workingDirectory: string): boolean {
    const resolved = resolve(workingDirectory, targetPath)
    const normalizedTarget = process.platform === 'win32' ? resolved.toLowerCase() : resolved
    const normalizedWorkingDir = process.platform === 'win32' ? workingDirectory.toLowerCase() : workingDirectory
    const prefix = normalizedWorkingDir.endsWith('/') ? normalizedWorkingDir : normalizedWorkingDir + '/'
    return normalizedTarget === normalizedWorkingDir || normalizedTarget.startsWith(prefix)
}

export function registerSessionFilesHandler(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    // 接口 1：ripgrep 模糊搜索（工作目录内）
    rpcHandlerManager.registerHandler<{ query: string }, ListSessionFilesResponse>('searchSessionFiles', async (data) => {
        logger.debug('Search session files request:', data.query)

        try {
            const entries = await searchFiles(workingDirectory, data.query)
            return { success: true, entries }
        } catch (error) {
            return rpcError(getErrorMessage(error, 'Failed to search files'))
        }
    })

    // 接口 2：目录列表（工作目录内 + 外）
    rpcHandlerManager.registerHandler<ListSessionFilesRequest, ListSessionFilesResponse>('listSessionDirectory', async (data) => {
        logger.debug('List session directory request:', data.path)

        try {
            let targetPath = data.path || '.'

            // 展开 ~/ 为 home 目录
            if (targetPath.startsWith('~')) {
                targetPath = join(homedir(), targetPath.slice(1))
            }

            // 工作目录内：校验路径安全性
            if (isWithinWorkingDir(targetPath, workingDirectory)) {
                const validation = validatePath(targetPath, workingDirectory)
                if (!validation.valid) {
                    return rpcError(validation.error ?? 'Invalid path')
                }
            }

            const resolvedPath = resolve(workingDirectory, targetPath)
            const entries = await listDirectory(resolvedPath)
            return { success: true, entries }
        } catch (error) {
            return rpcError(getErrorMessage(error, 'Failed to list directory'))
        }
    })
}
