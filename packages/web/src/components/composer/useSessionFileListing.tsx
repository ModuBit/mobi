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
import { useMobiApi } from '@/api/client'
import { useAuthStore } from '@/stores/authStore'
import type { ListFilesResponse } from '@/api/types'

export interface FileListingInput {
    /** @ 后面的文本，如 "src/" 或 "../" */
    mentionInput: string
    /** session 工作目录，用于解析相对路径 */
    workingDir: string
}

export interface FileSuggestionItem {
    label: string
    value: string
    isDirectory: boolean
    /** 完整相对路径（ripgrep 模式时返回） */
    path?: string
}

interface CachedEntry {
    name: string
    type: 'file' | 'directory' | 'other'
    path?: string
}

/**
 * 判断输入是否应触发 ripgrep 搜索（与后端 isSearchQuery 逻辑一致）
 * 非空、非 "."、非绝对路径、不含 ".."
 */
function isSearchInput(input: string): boolean {
    if (!input || input === '.') return false
    if (input.startsWith('/')) return false
    if (input.includes('..')) return false
    return true
}

/**
 * 解析路径：提取父目录和前缀（仅目录浏览模式使用）
 * 返回用于 API 请求的路径（相对于 workingDir）
 */
function resolveListPath(input: string): { listPath: string; prefix: string } {
    if (!input) return { listPath: '.', prefix: '' }

    const lastSlash = input.lastIndexOf('/')
    if (lastSlash === -1) {
        return { listPath: '.', prefix: input }
    }

    const dirPart = input.slice(0, lastSlash) || '.'
    const prefixPart = input.slice(lastSlash + 1)
    return { listPath: dirPart, prefix: prefixPart }
}

function toSuggestionItems(entries: CachedEntry[]): FileSuggestionItem[] {
    return entries.map(e => ({
        label: e.path ?? e.name,
        value: e.path ?? e.name,
        isDirectory: e.type === 'directory',
        path: e.path,
    }))
}

function filterByPrefix(entries: CachedEntry[], prefix: string): CachedEntry[] {
    if (!prefix) return entries
    const lower = prefix.toLowerCase()
    return entries.filter(e => e.name.toLowerCase().startsWith(lower))
}

/**
 * Session 维度文件列表 hook
 * 基于 @ 后的输入动态加载文件和目录列表
 */
export function useSessionFileListing(
    sessionId: string | null,
    input: FileListingInput | null,
): {
    items: FileSuggestionItem[]
    isLoading: boolean
} {
    const { token } = useAuthStore()
    const api = useMobiApi(token)

    const [items, setItems] = useState<FileSuggestionItem[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const abortRef = useRef<AbortController | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const cacheRef = useRef<Map<string, CachedEntry[]>>(new Map())
    const prevSessionIdRef = useRef<string | null>(sessionId)
    const currentPrefixRef = useRef<string>('')

    // sessionId 变化时清空缓存
    useEffect(() => {
        if (prevSessionIdRef.current !== sessionId) {
            cacheRef.current.clear()
            prevSessionIdRef.current = sessionId
        }
    }, [sessionId])

    const fetchFiles = useCallback(async (sId: string, listPath: string) => {
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        setIsLoading(true)
        try {
            const res = await api.sessions.listFiles(sId, listPath, { signal: controller.signal })
            if (controller.signal.aborted) return

            const data = res.data as ListFilesResponse
            if (!data.success || !data.entries) {
                setItems([])
                return
            }

            const entries: CachedEntry[] = data.entries
                .filter(e => e.type === 'file' || e.type === 'directory')
                .map(e => ({ name: e.name, type: e.type, path: e.path }))

            cacheRef.current.set(listPath, entries)

            // 应用当前前缀过滤
            setItems(toSuggestionItems(filterByPrefix(entries, currentPrefixRef.current)))
        } catch {
            if (!controller.signal.aborted) {
                setItems([])
            }
        } finally {
            if (!controller.signal.aborted) {
                setIsLoading(false)
            }
        }
    }, [api.sessions])

    useEffect(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }

        if (!sessionId || !input) {
            setItems([])
            setIsLoading(false)
            return
        }

        const mentionInput = input.mentionInput

        // 搜索模式：直接发送完整输入触发 ripgrep
        if (isSearchInput(mentionInput)) {
            currentPrefixRef.current = ''

            // 搜索结果不缓存（结果随 query 变化）
            timerRef.current = setTimeout(() => {
                fetchFiles(sessionId, mentionInput)
            }, 300)

            return () => {
                if (timerRef.current) {
                    clearTimeout(timerRef.current)
                }
                abortRef.current?.abort()
            }
        }

        // 目录浏览模式：解析路径并缓存
        const { listPath, prefix } = resolveListPath(mentionInput)
        currentPrefixRef.current = prefix

        const cached = cacheRef.current.get(listPath)
        if (cached) {
            setItems(toSuggestionItems(filterByPrefix(cached, prefix)))
            return
        }

        timerRef.current = setTimeout(() => {
            fetchFiles(sessionId, listPath)
        }, 300)

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current)
            }
            abortRef.current?.abort()
        }
    }, [sessionId, input, fetchFiles])

    return { items, isLoading }
}
