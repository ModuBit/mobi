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

import type { UploadFileResponse } from '@/core/data/api/types'
import { ALLOWED_EXTENSIONS_SET, ALLOWED_EXTENSIONS, BLOCKED_EXTENSIONS_SET, MAX_UPLOAD_BYTES } from '@mobi/shared/upload'
import type { BlockFileRef } from '@/domain/chat/composerSegments'
import { uuid } from './uuid'

/**
 * 文件附件类型
 */
export type FileAttachment = {
    /** 唯一标识 */
    id: string
    /** 原始文件对象（恢复态附件为占位空 File） */
    file: File
    /** 上传状态 */
    status: 'uploading' | 'complete' | 'error'
    /** 服务器路径（上传成功后的项目相对路径） */
    path?: string
    /** 错误信息 */
    error?: string
    /** 上传进度（0-100，uploading 状态时实时更新） */
    progress?: number
    /**
     * 顶层文件名（恢复态专用）：从草稿恢复的附件无可用 File 元信息，
     * 渲染层优先读此字段，回退 file.name。正常上传态不填。
     */
    name?: string
    /**
     * 顶层文件大小字节数（恢复态专用）：占位空 File 的 size 恒为 0，
     * 渲染层优先读此字段，回退 file.size。正常上传态不填。
     */
    size?: number
    /**
     * 顶层 MIME（恢复态专用）：分段建模时的 attachmentMimeType 存证。
     * 占位 File 的 type 恒空串，若丢弃此值仅靠扩展名兜底会让 EXT_TO_MIME 未覆盖的
     * 白名单扩展（如 .tiff，MIME 为 image/tiff）在恢复后错分进 document 桶。
     * 正常上传态不填。
     */
    mimeType?: string
}

/**
 * 上传函数类型
 */
export type UploadFunction = (sessionId: string, file: File) => Promise<UploadFileResponse>

/**
 * 校验文件是否允许上传
 * @returns 错误信息，null 表示通过
 */
export function validateFile(file: File): string | null {
    const ext = getExtension(file.name)
    if (BLOCKED_EXTENSIONS_SET.has(ext)) {
        return `文件类型 "${ext}" 不允许上传`
    }
    if (!ALLOWED_EXTENSIONS_SET.has(ext)) {
        return `文件类型 "${ext}" 暂不支持`
    }
    if (file.size > MAX_UPLOAD_BYTES) {
        return `文件大小超过限制（最大 50MB）`
    }
    if (file.size === 0) {
        return '不能上传空文件'
    }
    return null
}

/**
 * 获取文件扩展名（小写）
 */
function getExtension(filename: string): string {
    const dotIndex = filename.lastIndexOf('.')
    if (dotIndex === -1) return ''
    return filename.slice(dotIndex).toLowerCase()
}

/**
 * 获取白名单扩展名列表（用于 input accept 属性）
 */
export function getAcceptExtensions(): string {
    return Array.from(ALLOWED_EXTENSIONS).join(',')
}

/**
 * 扩展名 → MIME 映射：发送分段化后 block source 需要 mimeType，
 * 但「恢复态附件」的占位 File 无可靠 MIME（构造 File 的 type 恒空串），按扩展名兜底。
 * 键为带点小写扩展名（与 getExtension 输出直接配套）。
 */
const EXT_TO_MIME: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/vnd.microsoft.icon',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain', '.csv': 'text/csv', '.md': 'text/markdown', '.html': 'text/html', '.xml': 'application/xml',
    '.json': 'application/json', '.zip': 'application/zip',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/** 图片扩展名集合：isImageFileAttachment 的扩展名兜底用 */
const IMAGE_EXT_SET = new Set(Object.entries(EXT_TO_MIME).filter(([, m]) => m.startsWith('image/')).map(([e]) => e))

/**
 * 判定附件是否为图片类型。
 * 判定优先级：恢复态顶层 MIME（分段建模时存证，避免 .tiff 等未入 EXT_TO_MIME 的
 * 白名单扩展恢复后桶翻转）> 占位/真实 File 的 type > 扩展名兜底。
 * 图片与文档在发送时分桶为 image / document block，两入口（粘贴、上传）共用此判定。
 */
export function isImageFileAttachment(attachment: FileAttachment): boolean {
    if (attachment.mimeType?.startsWith('image/')) return true
    if (attachment.file.size > 0 && attachment.file.type.startsWith('image/')) return true
    const filename = attachment.name ?? attachment.file.name
    return IMAGE_EXT_SET.has(getExtension(filename))
}

/**
 * 取附件 MIME 类型。优先级同 isImageFileAttachment：恢复态顶层 MIME 存证 >
 * file.type（真实上传态可靠；恢复态恒空串）> 扩展名兜底 > 通用二进制类型。
 */
export function attachmentMimeType(attachment: FileAttachment): string {
    if (attachment.file.type) return attachment.file.type
    if (attachment.mimeType) return attachment.mimeType
    const filename = attachment.name ?? attachment.file.name
    return EXT_TO_MIME[getExtension(filename)] ?? 'application/octet-stream'
}

/**
 * 上传完成的附件 → 分段文件引用双桶（document / image）。
 *
 * 投影与分桶判定的单一来源：isImageFileAttachment 分桶 + attachmentMimeType 补 MIME，
 * 发送序列化（ChatComposer.segmentBuckets）与草稿持久化（useComposerDraft 保存路径）共用；
 * 未完成上传（uploading/error/无 path）没有 path 无法进分段，投影前过滤。
 */
export function bucketCompletedAttachments(attachments: readonly FileAttachment[]): {
    files: BlockFileRef[]
    images: BlockFileRef[]
} {
    const files: BlockFileRef[] = []
    const images: BlockFileRef[] = []
    for (const a of attachments) {
        if (a.status !== 'complete' || !a.path) continue
        const ref: BlockFileRef = {
            id: a.id,
            filename: a.name ?? a.file.name,
            path: a.path,
            mimeType: attachmentMimeType(a),
            size: a.size ?? a.file.size,
        }
        ;(isImageFileAttachment(a) ? images : files).push(ref)
    }
    return { files, images }
}

/**
 * 分段文件引用 → 恢复态占位附件（草稿恢复 / 排队编辑 / rewind 回填的逆向还原）。
 * 占位 File 不再上传，仅供渲染层 name fallback；mimeType 以分段建模时的存证优先直通，
 * 缺失时经 attachmentMimeType 扩展名兜底重 derive，与分段建模语义自洽。
 */
export function fileRefToPlaceholderAttachment(ref: BlockFileRef): FileAttachment {
    return {
        id: ref.id,
        // 占位 File：仅供渲染层 name fallback，不再触发上传
        file: new File([], ref.filename),
        status: 'complete' as const,
        path: ref.path,
        name: ref.filename,
        size: ref.size,
        ...(ref.mimeType ? { mimeType: ref.mimeType } : {}),
    }
}

/**
 * 创建文件附件对象
 */
export function createFileAttachment(file: File): FileAttachment {
    return {
        id: uuid(),
        file,
        status: 'uploading',
    }
}
