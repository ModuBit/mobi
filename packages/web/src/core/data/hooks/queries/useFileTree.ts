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
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'
import type { FileNode, ListDirectoryResponse } from '@/core/data/api/types'

export type { FileNode }

/**
 * 把 hub 的目录响应映射为 FileNode[]：
 * hub 的 entry 只有 name，需按被列目录的 dirPath 拼出完整相对路径。
 * 过滤掉 'other' 类型。dirPath '.' 视为根。
 *
 * 同时透传 truncated/total：listDirectory（树浏览）在条目数达上限时截断，
 * 前端据此在目录末尾挂「仅展示前 N 项」提示节点。搜索路径不置位。
 */
export function parseDirectoryEntries(data: ListDirectoryResponse, dirPath: string): {
    entries: FileNode[]
    truncated: boolean
    total: number
} {
    const base = !dirPath || dirPath === '.' ? '' : `${dirPath}/`
    type FileOrDir = { name: string; type: 'file' | 'directory'; size?: number; modified?: number }
    const entries = (data.entries ?? [])
        .filter((e): e is FileOrDir => e.type === 'file' || e.type === 'directory')
        .map((e) => ({
            name: e.name,
            path: `${base}${e.name}`,
            type: e.type,
            size: e.size,
            modified: e.modified,
        }))
    return {
        entries,
        truncated: data.truncated ?? false,
        total: data.total ?? entries.length,
    }
}

/**
 * 文件内容：二进制流结果。
 * - blob：原始内容（按 mime 在前端三分发：文本 → blob.text()、图片 → objectURL、二进制 → 提示下载）
 * - mime：来自 hub 的 Content-Type
 * - etag：来自 hub 的 ETag，用于后续 304 协商
 * null 表示尚未加载或 304 命中（保持旧缓存）。
 */
export type FileContent = { blob: Blob; mime: string; etag?: string }

/**
 * 获取文件内容（二进制流）。
 * read-file 为标准 HTTP 端点：非 2xx 走 axios throw → useQuery error；
 * 304 命中（命中协商缓存）时返回 null，由 react-query 保持旧 data。
 *
 * 第三个参数 enabled 用于「meta 先行」协调：FileContentView 拿到 meta 后，
 * 对超大文件 / 不支持预览类型（PDF/音视频）跳过 content 拉取（省流量、省解码）。
 * 默认 true 保持其他调用方行为不变。
 *
 * 第四个参数 etag 为显式缓存驱动：把 meta 的 etag 并入 queryKey，meta refetch 拿到新 etag →
 * queryKey 变化 → content 自动 refetch。触发 meta refetch 的两条路：
 * - Ellipsis「刷新」项 invalidate meta（无条件生效，用户主动兜底的主路径）
 * - 窗口聚焦（refetchOnWindowFocus 默认开）——但受全局 staleTime 30s 约束：
 *   新鲜期内切回窗口不会 refetch，故聚焦更新是「尽力而为」，不能当作及时性保证。
 */
export function useFileContent(sessionId: string | null, filePath: string | null, enabled = true, etag?: string) {
    const api = useMobiApi()

    return useQuery({
        queryKey: queryKeys.sessionFile(sessionId!, filePath!, etag),
        queryFn: async () => {
            if (!sessionId || !filePath) return null
            // 304 命中 → 端点不下发 body，这里返回 null（与「未加载」同义），
            // 浏览器侧缓存主要靠 react-query cache + refetch 协商
            return await api.files.read(sessionId, filePath)
        },
        enabled: !!sessionId && !!filePath && enabled,
    })
}

/**
 * 文件元数据：mime / size / etag。
 * 用于在不拉取文件体的前提下，决定渲染策略（如代码高亮 vs 二进制提示）
 * 或做协商缓存的条件请求。
 */
export type FileMeta = { mime: string; size: number; etag: string }

/**
 * 获取文件元数据（mime/size/etag）。
 * hub 返回 success:false 或缺少 meta 时抛错，由 react-query 透出 error。
 */
export function useFileMeta(sessionId: string | null, filePath: string | null) {
    const api = useMobiApi()

    return useQuery({
        queryKey: queryKeys.sessionFileMeta(sessionId!, filePath!),
        queryFn: async () => {
            if (!sessionId || !filePath) return null
            const res = await api.files.meta(sessionId, filePath)
            if (res.data.success === false || !res.data.meta) {
                throw new Error(res.data.error ?? 'file-meta failed')
            }
            return res.data.meta
        },
        enabled: !!sessionId && !!filePath,
    })
}
