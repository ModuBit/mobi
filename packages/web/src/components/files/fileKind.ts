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

import { FILE_SIZE_LIMITS, NATIVE_MEDIA_EXT } from '@/core/config/fileLimits'
import type { FileMeta } from '@/core/data/hooks/queries/useFileTree'

/** 文件类型判定结果（判别联合）—— 由 resolveFileKind 从 meta+路径推导 */
export type FileKind =
    | { kind: 'pdf' }
    | { kind: 'image' }
    | { kind: 'media-native'; isAudio: boolean }
    | { kind: 'media-download' } // 非原生音视频 → 提示下载
    | { kind: 'markdown' }
    | { kind: 'text'; highlight: boolean }
    | { kind: 'binary' } // 不可直显 → 提示下载

/** text-like mime 集合（text/* 外补几个常见的结构化文本） */
const TEXT_LIKE_MIMES = [
    'application/json',
    'application/xml',
    'application/x-sh',
    'application/sql',
    'application/toml',
]

function isTextLikeMime(mime: string): boolean {
    return mime.startsWith('text/') || TEXT_LIKE_MIMES.includes(mime)
}

/**
 * 按 mime + 扩展名推文件类型（纯函数，无副作用）。
 * 判定优先级与原 FileContentView 的 mime 布尔 flag 完全一致：
 * pdf → 音视频(原生/下载) → image → 非 text-like(binary) → markdown → text。
 */
export function resolveFileKind(meta: FileMeta, filePath: string): FileKind {
    const { mime, size } = meta

    if (mime === 'application/pdf') return { kind: 'pdf' }

    if (mime.startsWith('audio/') || mime.startsWith('video/')) {
        const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase()
        return NATIVE_MEDIA_EXT.includes(ext)
            ? { kind: 'media-native', isAudio: mime.startsWith('audio/') }
            : { kind: 'media-download' }
    }

    if (mime.startsWith('image/')) return { kind: 'image' }

    if (!isTextLikeMime(mime)) return { kind: 'binary' }

    if (mime === 'text/markdown') return { kind: 'markdown' }

    return { kind: 'text', highlight: size < FILE_SIZE_LIMITS.textHighlight }
}
