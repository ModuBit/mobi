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
import type { ListDirectoryResponse } from '@/api/types'

export interface DirectoryOption {
    /** 完整路径 */
    value: string
    /** 显示名称 */
    label: string
}

/**
 * 解析输入路径，提取父目录和前缀
 * /home/ad → { parentPath: '/home', prefix: 'ad' }
 * /home/admin/ → { parentPath: '/home/admin', prefix: '' }
 */
function parsePathInput(input: string): { parentPath: string; prefix: string } | null {
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
 * 防抖异步获取目录子目录列表
 */
export function useDirectoryListing(
    machineId: string | null,
    directory: string
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

    const fetchDirectories = useCallback(async (mId: string, parentPath: string, prefix: string) => {
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller

        setIsLoading(true)
        try {
            const res = await api.machines.listDirectory(mId, parentPath)
            if (controller.signal.aborted) return

            const data = res.data as ListDirectoryResponse
            if (!data.success || !data.entries) {
                setOptions([])
                return
            }

            const lowerPrefix = prefix.toLowerCase()
            const filtered = data.entries
                .filter((entry) => entry.name.toLowerCase().startsWith(lowerPrefix))
                .map((entry) => {
                    const fullPath = parentPath === '/' ? `/${entry.name}` : `${parentPath}/${entry.name}`
                    return { value: fullPath, label: entry.name }
                })

            setOptions(filtered)
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

        const parsed = parsePathInput(directory)
        if (!parsed) {
            setOptions([])
            return
        }

        // 300ms 防抖
        timerRef.current = setTimeout(() => {
            fetchDirectories(machineId, parsed.parentPath, parsed.prefix)
        }, 300)

        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current)
            }
            abortRef.current?.abort()
        }
    }, [machineId, directory, fetchDirectories])

    return { options, isLoading }
}
