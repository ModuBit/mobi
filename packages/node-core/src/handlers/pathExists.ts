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

/**
 * path-exists 实现（ticket-17 自 apiMachine 注册闭包抽出，本地化直调目标）。
 * 注册闭包与 LocalExecutor 共用，行为单源。
 */

import { stat } from 'node:fs/promises'

export interface PathExistsRequest {
    paths: string[]
}

export interface PathExistsResponse {
    exists: Record<string, boolean>
}

/** 批量探测路径存在性；非目录也算不存在（沿用 machine 通道原语义：仅目录算 exists） */
export async function checkPathsExistImpl(paths: unknown): Promise<PathExistsResponse> {
    const paramPaths = (paths as Partial<PathExistsRequest> | null | undefined)?.paths
    const rawPaths: unknown[] = Array.isArray(paramPaths) ? paramPaths : []
    const uniquePaths = Array.from(new Set(rawPaths.filter((path): path is string => typeof path === 'string')))
    const exists: Record<string, boolean> = {}

    await Promise.all(uniquePaths.map(async (path) => {
        const trimmed = path.trim()
        if (!trimmed) return
        try {
            const stats = await stat(trimmed)
            exists[trimmed] = stats.isDirectory()
        } catch {
            exists[trimmed] = false
        }
    }))

    return { exists }
}
