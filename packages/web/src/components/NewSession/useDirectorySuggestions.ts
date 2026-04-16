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

import { useMemo } from 'react'
import type { Session } from '@mobi/shared'

/**
 * 从会话列表和最近路径中提取目录建议
 * @param machineId 当前选中的机器 ID
 * @param sessions 会话列表
 * @param recentPaths 最近使用的路径
 * @returns 目录路径列表
 */
export function useDirectorySuggestions(
    machineId: string | null,
    sessions: Session[],
    recentPaths: string[]
): string[] {
    return useMemo(() => {
        // 过滤当前机器的会话
        const machineSessions = machineId
            ? sessions.filter((session) => session.metadata?.machineId === machineId)
            : sessions

        // 提取会话路径
        const sessionPaths = machineSessions
            .map((session) => session.metadata?.path)
            .filter((path): path is string => Boolean(path))

        // 提取 worktree 基础路径
        const worktreePaths = machineSessions
            .map((session) => session.metadata?.worktree?.basePath)
            .filter((path): path is string => Boolean(path))

        // 去重最近路径
        const dedupedRecent = [...new Set(recentPaths)]
        const recentSet = new Set(dedupedRecent)

        // 合并其他路径（排除已存在的最近路径）
        const otherPaths = [...new Set([...sessionPaths, ...worktreePaths])]
            .filter((path) => !recentSet.has(path))
            .sort((a, b) => a.localeCompare(b))

        return [...dedupedRecent, ...otherPaths]
    }, [machineId, sessions, recentPaths])
}
