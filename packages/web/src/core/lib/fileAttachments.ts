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

/**
 * 文件附件类型
 */
export type FileAttachment = {
    /** 唯一标识 */
    id: string
    /** 原始文件对象 */
    file: File
    /** 上传状态 */
    status: 'uploading' | 'complete' | 'error'
    /** 服务器路径（上传成功后的项目相对路径） */
    path?: string
    /** 错误信息 */
    error?: string
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
 * 创建文件附件对象
 */
export function createFileAttachment(file: File): FileAttachment {
    return {
        id: crypto.randomUUID(),
        file,
        status: 'uploading',
    }
}
