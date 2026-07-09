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

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMobiApi } from '@/core/data/api/client'
import type { FileNode, ListFilesResponse } from '@/core/data/api/types'

/**
 * 前端防御性上限（与 CLI MAX_RESULTS 对齐）。导出供 FileTreeView 复用「是否截断」判断，
 * 避免两份常量靠注释对齐后 drift。
 */
export const MAX_DISPLAY = 50
/** 防抖延迟：避免逐字符搜索 */
const DEBOUNCE_MS = 300
/**
 * loading 显示延迟：fetch 在此时长内完成则不进 loading 态。
 * 快网下避免 Input 转圈一闪而过；弱网下才显示，给用户「正在搜」的反馈。
 */
const LOADING_DELAY = 400

/**
 * 文件树筛选框用的「按关键字搜文件」hook。
 *
 * - 走 session 通道 search-files 端点，传 type='file' 只取文件（ripgrep）
 * - 防抖 300ms + AbortController 取消上一次，避免逐字符打爆后端
 * - 空 query 不搜索（FileTreeView 此时显示原树）
 * - 前端再 filter 一次 type='file'（防御后端误混目录）+ cap MAX_DISPLAY
 *
 * 与 composer 的 useFileListing 不同：那套含目录、为 mention 路径输入设计（双通道 + 缓存），
 * 这里只要纯文件关键字搜索，故独立实现。
 */
export function useDebouncedFileSearch(sessionId: string, query: string): {
    results: FileNode[]
    isLoading: boolean
} {
    const api = useMobiApi()
    const [results, setResults] = useState<FileNode[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const abortRef = useRef<AbortController | null>(null)
    /** loading 延迟计时器：fetch 快时取消，不触发 loading 态 */
    const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    /**
     * 请求代际守卫：每次发起新请求自增，finally 只在「当前请求仍是最新代」时复位 loading。
     * 防止慢请求 A 的 finally 在快请求 B 已进入 loading 后过早熄灭 spinner。
     */
    const generationRef = useRef(0)

    const clearLoadingTimer = useCallback(() => {
        if (loadingTimerRef.current) {
            clearTimeout(loadingTimerRef.current)
            loadingTimerRef.current = null
        }
    }, [])

    useEffect(() => {
        const trimmed = query.trim()
        if (!trimmed) {
            abortRef.current?.abort()
            clearLoadingTimer()
            setResults([])
            setIsLoading(false)
            return
        }

        // 取消上一次进行中的请求（防抖竞态：旧结果覆盖新结果）
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller
        // 标记本次请求代际；finally 据此判断是否仍是最新请求
        const myGeneration = ++generationRef.current

        const timer = setTimeout(async () => {
            // 延迟显示 loading：fetch 在 LOADING_DELAY 内完成则不进 loading 态（快网不闪烁）
            loadingTimerRef.current = setTimeout(() => setIsLoading(true), LOADING_DELAY)
            try {
                const res = await api.sessions.searchFiles(sessionId, trimmed, 'file', {
                    signal: controller.signal,
                })
                if (controller.signal.aborted) return

                // fetch 完成，取消未触发的 loading（快网下 isLoading 始终 false）
                clearLoadingTimer()

                const data = res.data as ListFilesResponse
                if (!data.success || !data.entries) {
                    setResults([])
                    return
                }

                const files: FileNode[] = data.entries
                    .filter((e) => e.type === 'file')
                    .map((e) => ({
                        name: e.name,
                        path: e.path ?? e.name,
                        type: 'file' as const,
                        size: e.size,
                        modified: e.modified,
                    }))
                    .slice(0, MAX_DISPLAY)

                setResults(files)
            } catch {
                if (!controller.signal.aborted) setResults([])
            } finally {
                clearLoadingTimer()
                // 仅当仍是最新代请求时复位 loading；
                // 否则把 loading 的控制权交给后来居上的新请求（它有自己的 loading 定时器 + finally）
                if (generationRef.current === myGeneration) {
                    setIsLoading(false)
                }
            }
        }, DEBOUNCE_MS)

        return () => {
            clearTimeout(timer)
            clearLoadingTimer()
            controller.abort()
        }
    }, [sessionId, query, api, clearLoadingTimer])

    return { results, isLoading }
}
