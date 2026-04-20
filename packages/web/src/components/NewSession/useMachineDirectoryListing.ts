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
import { useAuthStore } from '@/core/data/stores/authStore'
import type { ListDirectoryResponse } from '@/core/data/api/types'

export interface DirectoryOption {
    /** 完整路径 */
    value: string
    /** 显示名称 */
    label: string
}

function isHiddenDir(name: string): boolean {
    return name.startsWith('.')
}

/**
 * 解析路径的最后一段为前缀
 * /home/admin/git → { parentPath: '/home/admin', prefix: 'git' }
 */
export function parsePrefixInput(input: string): { parentPath: string; prefix: string } | null {
    if (!input.startsWith('/')) return null

    const lastSlash = input.lastIndexOf('/')
    if (lastSlash === 0) {
        return { parentPath: '/', prefix: input.slice(1) }
    }

    const parentPath = input.slice(0, lastSlash) || '/'
    const prefix = input.slice(lastSlash + 1)
    return { parentPath, prefix }
}

/**
 * 检查输入是否精确匹配缓存中的某个目录（即输入了一个完整有效的目录路径）
 */
function isExactDirectoryMatch(
    input: string,
    cache: Map<string, DirectoryOption[]>,
): boolean {
    const parsed = parsePrefixInput(input)
    if (!parsed) return false
    const { parentPath, prefix } = parsed
    const parentEntries = cache.get(parentPath)
    if (!parentEntries) return false
    return parentEntries.some((e) => e.label === prefix)
}

/**
 * 目录列表缓存 + 本地过滤
 *
 * - 路径以 / 结尾时请求 API（如 /home/admin/）
 * - 输入精确匹配缓存中的目录时也请求 API，展示其子目录
 * - homeDir 视为已知目录，直接请求子目录
 * - 请求结果按父路径缓存
 * - 输入前缀时从缓存本地过滤（如 /home/admin/git → 从 /home/admin 缓存中过滤 git）
 * - 隐藏目录默认不展示，仅当前缀以 . 开头时展示
 */
export function useMachineDirectoryListing(
    machineId: string | null,
    directory: string,
    homeDir?: string,
): {
    options: DirectoryOption[]
    isLoading: boolean
} {
    const { token } = useAuthStore()
    const api = useMobiApi(token)

    const [options, setOptions] = useState<DirectoryOption[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const abortRef = useRef<AbortController | null>(null)
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const cacheRef = useRef<Map<string, DirectoryOption[]>>(new Map())
    const prevMachineIdRef = useRef<string | null>(machineId)

    // machineId 变化时清空缓存
    useEffect(() => {
        if (prevMachineIdRef.current !== machineId) {
            cacheRef.current.clear()
            prevMachineIdRef.current = machineId
        }
    }, [machineId])

    const fetchDirectories = useCallback(async (mId: string, parentPath: string) => {
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        setIsLoading(true)
        try {
            const res = await api.machines.listDirectory(mId, parentPath, { signal: controller.signal })
            if (controller.signal.aborted) return

            const data = res.data as ListDirectoryResponse
            if (!data.success || !data.entries) {
                setOptions([])
                return
            }

            const entries = data.entries.map((entry) => {
                const fullPath = parentPath === '/' ? `/${entry.name}` : `${parentPath}/${entry.name}`
                return { value: fullPath, label: entry.name }
            })

            cacheRef.current.set(parentPath, entries)
            setOptions(entries.filter((e) => !isHiddenDir(e.label)))
        } catch {
            if (!controller.signal.aborted) {
                setOptions([])
            }
        } finally {
            if (!controller.signal.aborted) {
                setIsLoading(false)
            }
        }
    }, [api.machines])

    useEffect(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }

        if (!machineId || !directory.startsWith('/')) {
            setOptions([])
            setIsLoading(false)
            return
        }

        // 判断是否需要请求子目录：以 / 结尾，或精确匹配缓存目录，或等于 homeDir
        const shouldFetchChildren = directory.endsWith('/')
            || isExactDirectoryMatch(directory, cacheRef.current)
            || (Boolean(homeDir) && directory === homeDir)

        if (shouldFetchChildren) {
            const parentPath = directory.endsWith('/')
                ? (directory.slice(0, -1) || '/')
                : directory

            const cached = cacheRef.current.get(parentPath)
            if (cached) {
                setOptions(cached.filter((e) => !isHiddenDir(e.label)))
                return
            }

            timerRef.current = setTimeout(() => {
                fetchDirectories(machineId, parentPath)
            }, 300)
        } else {
            const parsed = parsePrefixInput(directory)
            if (!parsed) {
                setOptions([])
                return
            }

            const { parentPath, prefix } = parsed
            const cached = cacheRef.current.get(parentPath)
            if (!cached) {
                setOptions([])
                return
            }

            const lowerPrefix = prefix.toLowerCase()
            const showHidden = isHiddenDir(prefix)
            const filtered = cached.filter((entry) => {
                if (!entry.label.toLowerCase().includes(lowerPrefix)) return false
                if (!showHidden && isHiddenDir(entry.label)) return false
                return true
            })
            setOptions(filtered)
        }

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current)
            }
            abortRef.current?.abort()
        }
    }, [machineId, directory, fetchDirectories])

    return { options, isLoading }
}
