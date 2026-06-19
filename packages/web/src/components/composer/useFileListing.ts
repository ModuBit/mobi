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
import type { ListFilesResponse } from '@/core/data/api/types'
import type { CapabilityTarget, SearchFilesFn, ListDirectoryFn } from '@/core/data/hooks/queries/useDirectoryCapabilities'
import type { FileListingInput, FileSuggestionItem } from './useSessionFileListing'

interface CachedEntry {
    name: string
    type: 'file' | 'directory' | 'other'
    path?: string
}

function isInsideWorkingDir(input: string): boolean {
    if (!input) return true
    if (input.startsWith('/')) return false
    if (input.startsWith('~')) return false
    if (input.includes('..')) return false
    return true
}

function isSearchInput(input: string): boolean {
    if (!input || input === '.') return false
    return isInsideWorkingDir(input)
}

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

function filterEntries(entries: CachedEntry[], prefix: string, useContains: boolean): CachedEntry[] {
    if (!prefix) return entries
    const lower = prefix.toLowerCase()
    return useContains
        ? entries.filter(e => e.name.toLowerCase().includes(lower))
        : entries.filter(e => e.name.toLowerCase().startsWith(lower))
}

/**
 * 双通道文件列表 hook
 *
 * 与 useSessionFileListing 逻辑相同，但通过注入的 searchFiles / listDirectory
 * 函数支持 session 和 machine 两种通道。
 *
 * @param searchFiles 搜索文件函数（来自 useDirectoryCapabilities）
 * @param listDirectory 列出目录函数（来自 useDirectoryCapabilities）
 * @param target 资源定位目标，用于缓存失效
 * @param input @ 后面的输入信息，null 表示关闭
 */
export function useFileListing(
    searchFiles: SearchFilesFn | null,
    listDirectory: ListDirectoryFn | null,
    target: CapabilityTarget | null,
    input: FileListingInput | null,
): {
    items: FileSuggestionItem[]
    isLoading: boolean
} {
    const [items, setItems] = useState<FileSuggestionItem[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const abortRef = useRef<AbortController | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const cacheRef = useRef<Map<string, CachedEntry[]>>(new Map())
    const prevTargetRef = useRef<CapabilityTarget | null>(target)
    const currentPrefixRef = useRef<string>('')
    const filterContainsRef = useRef(false)

    // target 切换时清空缓存
    useEffect(() => {
        const prev = prevTargetRef.current
        if (prev !== target) {
            cacheRef.current.clear()
            prevTargetRef.current = target
        }
    }, [target])

    const doSearch = useCallback(async (
        searchFn: SearchFilesFn,
        query: string,
    ) => {
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        setIsLoading(true)
        try {
            const res = await searchFn(query, { signal: controller.signal })
            if (controller.signal.aborted) return

            const data = res.data as ListFilesResponse
            if (!data.success || !data.entries) {
                setItems([])
                return
            }

            const entries: CachedEntry[] = data.entries
                .filter(e => e.type === 'file' || e.type === 'directory')
                .map(e => ({ name: e.name, type: e.type, path: e.path }))

            setItems(toSuggestionItems(entries))
        } catch {
            if (!controller.signal.aborted) {
                setItems([])
            }
        } finally {
            if (!controller.signal.aborted) {
                setIsLoading(false)
            }
        }
    }, [])

    const doListDirectory = useCallback(async (
        listFn: ListDirectoryFn,
        dirPath: string,
    ) => {
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        setIsLoading(true)
        try {
            const res = await listFn(dirPath, { signal: controller.signal })
            if (controller.signal.aborted) return

            const data = res.data as ListFilesResponse
            if (!data.success || !data.entries) {
                setItems([])
                return
            }

            const entries: CachedEntry[] = data.entries
                .filter(e => e.type === 'file' || e.type === 'directory')
                .map(e => ({ name: e.name, type: e.type, path: e.path }))

            cacheRef.current.set(dirPath, entries)

            setItems(toSuggestionItems(filterEntries(entries, currentPrefixRef.current, filterContainsRef.current)))
        } catch {
            if (!controller.signal.aborted) {
                setItems([])
            }
        } finally {
            if (!controller.signal.aborted) {
                setIsLoading(false)
            }
        }
    }, [])

    useEffect(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }

        if (!target || !input || !searchFiles || !listDirectory) {
            setItems([])
            setIsLoading(false)
            return
        }

        const mentionInput = input.mentionInput

        if (isSearchInput(mentionInput)) {
            currentPrefixRef.current = ''

            timerRef.current = setTimeout(() => {
                doSearch(searchFiles, mentionInput)
            }, 300)

            return () => {
                if (timerRef.current) clearTimeout(timerRef.current)
                abortRef.current?.abort()
            }
        }

        const { listPath, prefix } = resolveListPath(mentionInput)
        currentPrefixRef.current = prefix
        filterContainsRef.current = !isInsideWorkingDir(mentionInput)

        const cached = cacheRef.current.get(listPath)
        if (cached) {
            setItems(toSuggestionItems(filterEntries(cached, prefix, filterContainsRef.current)))
            return
        }

        timerRef.current = setTimeout(() => {
            doListDirectory(listDirectory, listPath)
        }, 300)

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current)
            abortRef.current?.abort()
        }
    }, [target, input, searchFiles, listDirectory, doSearch, doListDirectory])

    return { items, isLoading }
}
