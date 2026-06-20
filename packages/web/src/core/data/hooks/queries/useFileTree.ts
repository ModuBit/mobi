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

import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'
import type { FileNode, ListDirectoryResponse, FileReadResponse } from '@/core/data/api/types'

export type { FileNode }

/**
 * 把 hub 的目录响应映射为 FileNode[]：
 * hub 的 entry 只有 name，需按被列目录的 dirPath 拼出完整相对路径。
 * 过滤掉 'other' 类型。dirPath '.' 视为根。
 */
export function parseDirectoryEntries(data: ListDirectoryResponse, dirPath: string): FileNode[] {
    const base = !dirPath || dirPath === '.' ? '' : `${dirPath}/`
    type FileOrDir = { name: string; type: 'file' | 'directory' }
    return (data.entries ?? [])
        .filter((e): e is FileOrDir => e.type === 'file' || e.type === 'directory')
        .map((e) => ({ name: e.name, path: `${base}${e.name}`, type: e.type }))
}

/**
 * 获取目录下的文件列表。
 * hub 返回 success:false（runner 未就绪/无权限等）时抛错，由 react-query 透出 error，
 * 调用方据此显示错误态而非误导性的「空目录」。
 */
export function useFileTree(sessionId: string | null, path: string) {
    const { token } = useAuthStore()
    const api = useMobiApi(token)

    return useQuery({
        queryKey: queryKeys.sessionDirectory(sessionId!, path),
        queryFn: async () => {
            if (!sessionId) return []
            const res = await api.files.list(sessionId, path)
            const data = res.data as ListDirectoryResponse
            if (data.success === false) {
                throw new Error(data.error ?? 'list-directory failed')
            }
            return parseDirectoryEntries(data, path)
        },
        enabled: !!token && !!sessionId,
    })
}

/**
 * 获取文件内容。
 * hub 返回 success:false 时抛错，透出 error，避免把读取失败静默成「空文件」。
 */
export function useFileContent(sessionId: string | null, filePath: string | null) {
    const { token } = useAuthStore()
    const api = useMobiApi(token)

    return useQuery({
        queryKey: queryKeys.sessionFile(sessionId!, filePath!),
        queryFn: async () => {
            if (!sessionId || !filePath) return null
            const res = await api.files.read(sessionId, filePath)
            const data = res.data as FileReadResponse
            if (data.success === false) {
                throw new Error(data.error ?? 'read-file failed')
            }
            return data.content ?? ''
        },
        enabled: !!token && !!sessionId && !!filePath,
    })
}
