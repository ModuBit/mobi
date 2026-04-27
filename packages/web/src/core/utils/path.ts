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

import type { SessionMetadataSummary } from '@/core/data/api/types'

/**
 * 解析显示路径（相对于项目根目录）
 */
export function resolveDisplayPath(path: string, metadata: SessionMetadataSummary | null): string {
    if (!metadata?.path) return path

    const root = metadata.path
    const lowerPath = path.toLowerCase()
    const lowerRoot = root.toLowerCase()
    if (!lowerPath.startsWith(lowerRoot)) return path

    const remainder = path.slice(root.length)
    if (remainder !== '' && !remainder.startsWith('/') && !remainder.startsWith('\\')) return path

    let out = remainder
    if (out.startsWith('/') || out.startsWith('\\')) {
        out = out.slice(1)
    }
    return out.length === 0 ? '<root>' : out
}

/**
 * 获取路径的文件名部分
 */
export function basename(path: string): string {
    const normalized = path.replace(/\\/g, '/')
    const parts = normalized.split('/').filter(Boolean)
    return parts.length > 0 ? parts[parts.length - 1] : path
}

/**
 * 截断路径左侧（保留文件名和右侧路径部分）
 * 例如: "a/b/c/d/file.ts" -> "...c/d/file.ts"
 */
export function truncatePathLeft(path: string, maxLen: number): string {
    if (path.length <= maxLen) return path

    // 确保至少保留文件名
    const name = basename(path)
    const ellipsis = '...'

    // 如果文件名本身就很长，直接截断
    if (name.length >= maxLen - ellipsis.length) {
        return ellipsis + name.slice(-(maxLen - ellipsis.length))
    }

    // 从左侧开始截断，保留右侧路径
    const keepLen = maxLen - ellipsis.length
    return ellipsis + path.slice(-keepLen)
}
