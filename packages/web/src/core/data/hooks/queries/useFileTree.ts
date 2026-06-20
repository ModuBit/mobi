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
import type { FileNode } from '@/core/data/api/types'

export type { FileNode }

/** hub list-directory 响应（{ success, entries: [{name, type, ...}] }，无 path 字段） */
type DirectoryResponse = {
    success?: boolean
    entries?: { name: string; type: 'file' | 'directory' | 'other' }[]
    error?: string
}

/**
 * 把 hub 的目录响应映射为 FileNode[]：
 * hub 的 entry 只有 name，需按被列目录的 dirPath 拼出完整相对路径。
 * 过滤掉 'other' 类型。dirPath '.' 视为根。
 */
export function parseDirectoryEntries(data: DirectoryResponse, dirPath: string): FileNode[] {
    const base = !dirPath || dirPath === '.' ? '' : `${dirPath}/`
    type Entry = { name: string; type: 'file' | 'directory' }
    return (data.entries ?? [])
        .filter((e): e is Entry => e.type === 'file' || e.type === 'directory')
        .map((e) => ({ name: e.name, path: `${base}${e.name}`, type: e.type }))
}

/**
 * 获取目录下的文件列表
 */
export function useFileTree(sessionId: string | null, path: string) {
    const { token } = useAuthStore()
    const api = useMobiApi(token)

    return useQuery({
        queryKey: queryKeys.sessionDirectory(sessionId!, path),
        queryFn: async () => {
            if (!sessionId) return []
            const res = await api.files.list(sessionId, path)
            return parseDirectoryEntries(res.data as DirectoryResponse, path)
        },
        enabled: !!token && !!sessionId,
    })
}

/** hub read-file 响应（{ success, content }） */
type ReadFileResponse = { success?: boolean; content?: string; error?: string }

/**
 * 获取文件内容
 */
export function useFileContent(sessionId: string | null, filePath: string | null) {
    const { token } = useAuthStore()
    const api = useMobiApi(token)

    return useQuery({
        queryKey: queryKeys.sessionFile(sessionId!, filePath!),
        queryFn: async () => {
            if (!sessionId || !filePath) return null
            const res = await api.files.read(sessionId, filePath)
            return (res.data as ReadFileResponse).content ?? ''
        },
        enabled: !!token && !!sessionId && !!filePath,
    })
}
