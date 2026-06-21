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
import type { ListFilesResponse } from '@/core/data/api/types'

export interface FileListingInput {
    /** @ 后面的文本，如 "src/" 或 "~/.mobi" */
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

export function useSessionFileListing(
    sessionId: string | null,
    input: FileListingInput | null,
): {
    items: FileSuggestionItem[]
    isLoading: boolean
} {
    const api = useMobiApi()

    const [items, setItems] = useState<FileSuggestionItem[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const abortRef = useRef<AbortController | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const cacheRef = useRef<Map<string, CachedEntry[]>>(new Map())
    const prevSessionIdRef = useRef<string | null>(sessionId)
    const currentPrefixRef = useRef<string>('')
    const filterContainsRef = useRef(false)

    useEffect(() => {
        if (prevSessionIdRef.current !== sessionId) {
            cacheRef.current.clear()
            prevSessionIdRef.current = sessionId
        }
    }, [sessionId])

    const doSearch = useCallback(async (sId: string, query: string) => {
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        setIsLoading(true)
        try {
            const res = await api.sessions.searchFiles(sId, query, { signal: controller.signal })
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
    }, [api.sessions])

    const doListDirectory = useCallback(async (sId: string, dirPath: string) => {
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        setIsLoading(true)
        try {
            const res = await api.sessions.listDirectory(sId, dirPath, { signal: controller.signal })
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

        if (isSearchInput(mentionInput)) {
            currentPrefixRef.current = ''

            timerRef.current = setTimeout(() => {
                doSearch(sessionId, mentionInput)
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
            doListDirectory(sessionId, listPath)
        }, 300)

        return () => {
            if (timerRef.current) clearTimeout(timerRef.current)
            abortRef.current?.abort()
        }
    }, [sessionId, input, doSearch, doListDirectory])

    return { items, isLoading }
}
