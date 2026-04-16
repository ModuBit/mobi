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

import { useCallback, useMemo, useState } from 'react'

const STORAGE_KEY = 'mobi:recentPaths'
const LAST_MACHINE_KEY = 'mobi:lastMachineId'
const MAX_PATHS_PER_MACHINE = 5

type RecentPathsData = Record<string, string[]>

/**
 * 从 localStorage 加载最近路径
 */
function loadRecentPaths(): RecentPathsData {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        return stored ? JSON.parse(stored) : {}
    } catch {
        return {}
    }
}

/**
 * 保存最近路径到 localStorage
 */
function saveRecentPaths(data: RecentPathsData): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
        // 忽略存储错误
    }
}

/**
 * 管理最近使用路径的 Hook
 */
export function useRecentPaths() {
    const [data, setData] = useState<RecentPathsData>(loadRecentPaths)

    /**
     * 获取指定机器的最近路径
     */
    const getRecentPaths = useCallback((machineId: string | null): string[] => {
        if (!machineId) return []
        return data[machineId] ?? []
    }, [data])

    /**
     * 添加最近路径
     */
    const addRecentPath = useCallback((machineId: string, path: string): void => {
        const trimmed = path.trim()
        if (!trimmed) return

        setData((prev) => {
            const existing = prev[machineId] ?? []
            // 移除已存在的路径，然后添加到开头
            const filtered = existing.filter((p) => p !== trimmed)
            const updated = [trimmed, ...filtered].slice(0, MAX_PATHS_PER_MACHINE)

            const newData = { ...prev, [machineId]: updated }
            saveRecentPaths(newData)
            return newData
        })
    }, [])

    /**
     * 获取上次使用的机器 ID
     */
    const getLastUsedMachineId = useCallback((): string | null => {
        try {
            return localStorage.getItem(LAST_MACHINE_KEY)
        } catch {
            return null
        }
    }, [])

    /**
     * 设置上次使用的机器 ID
     */
    const setLastUsedMachineId = useCallback((machineId: string): void => {
        try {
            localStorage.setItem(LAST_MACHINE_KEY, machineId)
        } catch {
            // 忽略存储错误
        }
    }, [])

    return useMemo(() => ({
        getRecentPaths,
        addRecentPath,
        getLastUsedMachineId,
        setLastUsedMachineId,
    }), [getRecentPaths, addRecentPath, getLastUsedMachineId, setLastUsedMachineId])
}
