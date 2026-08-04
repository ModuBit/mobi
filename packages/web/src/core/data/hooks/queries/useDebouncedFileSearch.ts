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
    /**
     * 本次搜索是否失败。与 `results: []` 分开表达——两者语义不同：
     * 空数组是「搜过了，确实没有匹配」，failed 是「没搜到答案」。
     * 压成同一个状态会让网络故障显示成「无匹配文件」，用户据此以为文件被删了。
     */
    failed: boolean
    /** 以当前 query 重新搜索（手动刷新用）；query 为空时为 no-op */
    refetch: () => void
} {
    const api = useMobiApi()
    const [results, setResults] = useState<FileNode[]>([])
    const [failed, setFailed] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    /**
     * 手动刷新计数：自增即重跑下方 effect（query 不变也能重发请求）。
     * 与 query 一同作为 effect 依赖，是「重新搜索」的唯一触发口。
     */
    const [refreshNonce, setRefreshNonce] = useState(0)
    const abortRef = useRef<AbortController | null>(null)
    /** loading 延迟计时器：fetch 快时取消，不触发 loading 态 */
    const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    /**
     * 请求代际守卫：每次发起新请求自增，finally 只在「当前请求仍是最新代」时复位 loading。
     * 防止慢请求 A 的 finally 在快请求 B 已进入 loading 后过早熄灭 spinner。
     */
    const generationRef = useRef(0)
    /**
     * 上一次 effect 运行时的 nonce。用于区分本次重跑的来源：
     * nonce 变了 → 手动刷新触发，立即发起（点刷新不该再等 300ms）；
     * nonce 没变 → 用户在打字（query 变化触发），照常防抖。
     */
    const lastNonceRef = useRef(0)
    /**
     * 当前 results 属于哪个搜索词。
     * 失败时保留旧 results（供渲染层显示「旧结果 + 失败提示」），但那只在同一搜索词内说得通——
     * 换词后旧结果就是错的答案，必须先清空。这个 ref 就是判据。
     */
    const resultsQueryRef = useRef('')

    const clearLoadingTimer = useCallback(() => {
        if (loadingTimerRef.current) {
            clearTimeout(loadingTimerRef.current)
            loadingTimerRef.current = null
        }
    }, [])

    useEffect(() => {
        // 先认领 nonce（哪怕下方因空 query 提前返回也要认领），
        // 否则空 query 期间的 refetch 会把「下一次打字」误判成手动刷新而跳过防抖
        const isManualRefresh = refreshNonce !== lastNonceRef.current
        lastNonceRef.current = refreshNonce

        const trimmed = query.trim()
        if (!trimmed) {
            abortRef.current?.abort()
            clearLoadingTimer()
            setResults([])
            resultsQueryRef.current = ''
            // 退出搜索模式（清空输入框）→ 上次的失败判定作废，否则再进搜索时残留旧错误
            setFailed(false)
            setIsLoading(false)
            return
        }

        // 换了搜索词 → 旧结果属于上一个词，立即作废（失败时的「保留旧结果」只在同一词内成立，
        // 否则会拿 'foo' 的结果冒充 'bar' 的）。同时清失败态，避免旧错误跨词残留
        if (resultsQueryRef.current !== trimmed) {
            resultsQueryRef.current = trimmed
            setResults([])
            setFailed(false)
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
                // success:false 来自 cli 侧 rpcError（ripgrep 挂了/路径非法等），是故障而非空结果。
                // 保留上次的 results：渲染层据此显示「旧结果 + 失败提示条」而非清空
                if (!data.success || !data.entries) {
                    setFailed(true)
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
                setFailed(false)
            } catch {
                // abort 是我们主动取消（防抖/换 query），不是失败——此时新请求接手，别打上失败标记。
                // 同样保留上次 results（见上方 success:false 分支的说明）
                if (!controller.signal.aborted) setFailed(true)
            } finally {
                clearLoadingTimer()
                // 仅当仍是最新代请求时复位 loading；
                // 否则把 loading 的控制权交给后来居上的新请求（它有自己的 loading 定时器 + finally）
                if (generationRef.current === myGeneration) {
                    setIsLoading(false)
                }
            }
        }, isManualRefresh ? 0 : DEBOUNCE_MS)

        return () => {
            clearTimeout(timer)
            clearLoadingTimer()
            controller.abort()
        }
    }, [sessionId, query, refreshNonce, api, clearLoadingTimer])

    const refetch = useCallback(() => setRefreshNonce((n) => n + 1), [])

    return { results, isLoading, failed, refetch }
}
