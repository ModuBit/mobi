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
import { useAuthStore } from '@/stores/authStore'
import { useMobiApi } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import type { FileNode } from '@/api/types'

export type { FileNode }

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
            // API 返回格式可能是 { files: [...] } 或直接 [...]
            const data = res.data as { files?: FileNode[] } | FileNode[]
            return (Array.isArray(data) ? data : data.files || []) as FileNode[]
        },
        enabled: !!token && !!sessionId,
    })
}

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
            // API 返回格式可能是 { content: string } 或直接 string
            const data = res.data as { content?: string } | string
            return typeof data === 'string' ? data : data.content || ''
        },
        enabled: !!token && !!sessionId && !!filePath,
    })
}
