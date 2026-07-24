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

/** 路径截断长度常量 */
export const PATH_TRUNCATE = {
    /** 短截断：工具卡片标题 */
    SHORT: 35,
    /** 中等截断：工具卡片标题 */
    MEDIUM: 40,
    /** 长截断：DiffView 头部 */
    LONG: 50,
} as const

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
 * 归一化目录路径：去除尾部斜杠（多个 / 或 \），根路径保留为 "/"
 * 用于统一 cwd 作为缓存 key，避免 /a/b 与 /a/b/ 产生不同缓存条目
 */
export function normalizeDirectoryPath(path: string): string {
    if (!path) return path
    // 仅由斜杠组成的路径（如 "/"、"//"）归一化为根目录
    if (/^[\\/]+$/.test(path)) return '/'
    return path.replace(/[\\/]+$/, '')
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

/** relativePath 结果：ok=true 给 posix 相对路径；ok=false 表示越界或非法（调用方应降级提示） */
export type RelativeResult = { ok: true; rel: string } | { ok: false }

/**
 * 计算 filePath 相对 baseDir 的 posix 相对路径（浏览器环境，纯字符串，无 node:path）。
 * 仅当 filePath 真正落在 baseDir 内时返回 ok；越界 / 相等 / 空串返回 ok:false。
 * 用于 HTML 预览拼接 serve-file URL：把文件绝对路径转成相对 cwd 的 path 段。
 *
 * 段级比较（非 startsWith）以防前缀同名误判：/project 不会被视为 /proj 内。
 */
export function relativePath(baseDir: string, filePath: string): RelativeResult {
    if (!baseDir || !filePath) return { ok: false }
    // 词法规范化：\ → /，拆段时消解 . 与 ..（如 /proj/../etc → /etc），否则越界检测失效
    const norm = (p: string) => {
        const segs: string[] = []
        for (const seg of p.replace(/\\/g, '/').split('/')) {
            if (!seg || seg === '.') continue
            if (seg === '..') { segs.pop(); continue }
            segs.push(seg)
        }
        return segs
    }
    const base = norm(baseDir)
    const file = norm(filePath)
    // base 必须是 file 的前缀（filePath 在 baseDir 下）
    if (base.length > file.length) return { ok: false }
    for (let i = 0; i < base.length; i++) {
        if (base[i] !== file[i]) return { ok: false }
    }
    const rel = file.slice(base.length).join('/')
    return rel ? { ok: true, rel } : { ok: false }
}

/**
 * 将 posix 相对路径按段 URL 编码，保留 / 分隔符（供 path 段路由如 serve-file/:path 使用）。
 */
export function encodePathSegments(rel: string): string {
    return rel.split('/').map(encodeURIComponent).join('/')
}
