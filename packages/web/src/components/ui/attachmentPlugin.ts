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

import type { TokenizerAndRendererExtension } from 'marked'

/** 匹配 @.mobi/uploads/YYYY-MM/filename */
const ATTACHMENT_RE = /@(\.mobi\/uploads\/\d{4}-\d{2}\/[\w\-\.]+)/

/**
 * 根据文件扩展名获取文件类型图标
 */
function getFileTypeIcon(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return '🖼️'
    if (['pdf'].includes(ext)) return '📄'
    if (['doc', 'docx', 'txt', 'rtf', 'md'].includes(ext)) return '📝'
    if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊'
    if (['ppt', 'pptx'].includes(ext)) return '📽️'
    if (['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a'].includes(ext)) return '🎵'
    if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext)) return '🎬'
    if (['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'].includes(ext)) return '📦'
    return '📎'
}

/**
 * 从路径中提取文件名（移除时间戳前缀）
 */
function extractFilename(path: string): string {
    const parts = path.split('/')
    const fullName = parts[parts.length - 1] ?? ''
    // 移除时间戳前缀 (数字-)
    const withoutTimestamp = fullName.replace(/^\d+-/, '')
    return withoutTimestamp || fullName
}

/**
 * Markdown inline 扩展：将 @.mobi/uploads/... 渲染为 <attachment-ref> 标签
 */
export function attachmentInlineExtension(): TokenizerAndRendererExtension {
    return {
        name: 'attachmentRef',
        level: 'inline',
        start(src: string) {
            const idx = src.indexOf('@.mobi/')
            return idx >= 0 ? idx : undefined
        },
        tokenizer(src: string) {
            const match = src.match(ATTACHMENT_RE)
            if (!match) return undefined

            const fullPath = match[1]
            const filename = extractFilename(fullPath)
            const icon = getFileTypeIcon(filename)

            return {
                type: 'attachmentRef',
                raw: match[0],
                path: fullPath,
                filename,
                icon,
            }
        },
        renderer(token) {
            const { path, filename, icon } = token as unknown as {
                path: string
                filename: string
                icon: string
            }
            return `<attachment-ref data-path="${path}" data-filename="${filename}" data-icon="${icon}">${icon} ${filename}</attachment-ref>`
        },
    }
}
