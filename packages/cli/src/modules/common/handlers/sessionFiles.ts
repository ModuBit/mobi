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
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { getErrorMessage, rpcError } from '../rpcResponses'

interface ListSessionFilesRequest {
    path: string
}

interface FileEntry {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

interface ListSessionFilesResponse {
    success: boolean
    entries?: FileEntry[]
    error?: string
}

export function registerSessionFilesHandler(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    rpcHandlerManager.registerHandler<ListSessionFilesRequest, ListSessionFilesResponse>('listSessionFiles', async (data) => {
        logger.debug('List session files request:', data.path)

        const targetPath = data.path || '.'

        try {
            const resolvedPath = resolve(workingDirectory, targetPath)
            const entries = await readdir(resolvedPath, { withFileTypes: true })

            const fileEntries: FileEntry[] = await Promise.all(
                entries.map(async (entry) => {
                    const fullPath = join(resolvedPath, entry.name)
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

            return { success: true, entries: fileEntries }
        } catch (error) {
            return rpcError(getErrorMessage(error, 'Failed to list files'))
        }
    })
}
