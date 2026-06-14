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

import { useState, useCallback, useRef } from 'react'
import { message } from 'antd'
import type { DirectoryCapabilities } from '@/core/data/hooks/queries/useDirectoryCapabilities'
import type { FileAttachment } from '@/core/lib/fileAttachments'
import { createFileAttachment, validateFile, getAcceptExtensions } from '@/core/lib/fileAttachments'
import type { UploadFileResponse } from '@/core/data/api/types'

// 粘贴图片 MIME → 扩展名
const MIME_TO_EXT: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/svg+xml': '.svg',
    'image/bmp': '.bmp',
}

// 粘贴非图片 MIME → 扩展名
const NON_IMAGE_MIME_TO_EXT: Record<string, string> = {
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'text/csv': '.csv',
    'text/html': '.html',
    'text/markdown': '.md',
    'application/json': '.json',
    'application/zip': '.zip',
    'application/xml': '.xml',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'application/msword': '.doc',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.ms-powerpoint': '.ppt',
}

/** 从图片 MIME 类型推断文件扩展名，未知类型回退到 .png */
function imageExtFromMime(mimeType: string): string {
    return MIME_TO_EXT[mimeType] ?? '.png'
}

/**
 * 统一的附件管理 hook
 *
 * 封装上传、删除、粘贴、拖拽等附件操作，
 * 供 ChatComposer 和 NewSessionPage 共享
 */
export function useAttachmentHandling(capabilities: DirectoryCapabilities) {
    const [attachments, setAttachments] = useState<FileAttachment[]>([])
    const abortControllersRef = useRef<Map<string, AbortController>>(new Map())

    // 拖拽状态（计数器解决子元素间 dragenter/dragleave 频繁触发问题）
    const [isDragOver, setIsDragOver] = useState(false)
    const dragCounterRef = useRef(0)

    // 上传附件到服务器
    const uploadAttachment = useCallback(async (attachmentId: string, file: File) => {
        const controller = new AbortController()
        abortControllersRef.current.set(attachmentId, controller)
        try {
            const response = await capabilities.uploadFile(file, { signal: controller.signal })
            const data = response.data as UploadFileResponse
            if (import.meta.env.DEV) console.log('[Upload] 响应', attachmentId, data)
            if (data.success && data.path) {
                setAttachments(prev => prev.map(a =>
                    a.id === attachmentId
                        ? { ...a, status: 'complete' as const, path: data.path }
                        : a
                ))
            } else {
                setAttachments(prev => prev.map(a =>
                    a.id === attachmentId
                        ? { ...a, status: 'error' as const, error: data.error || '上传失败' }
                        : a
                ))
            }
        } catch (err) {
            if (import.meta.env.DEV) console.error('[Upload] 上传失败', attachmentId, err)
            if (controller.signal.aborted) return
            setAttachments(prev => prev.map(a =>
                a.id === attachmentId
                    ? { ...a, status: 'error' as const, error: err instanceof Error ? err.message : '上传失败' }
                    : a
            ))
        } finally {
            abortControllersRef.current.delete(attachmentId)
        }
    }, [capabilities])

    // 校验并上传文件列表（粘贴 / 拖拽 / 选择文件共享）
    const processFiles = useCallback((files: File[]) => {
        if (import.meta.env.DEV) console.log('[Upload] processFiles', files.map(f => `${f.name}(${f.size})`))
        for (const file of files) {
            const error = validateFile(file)
            if (error) {
                message.warning(error)
                continue
            }
            const attachment = createFileAttachment(file)
            setAttachments(prev => [...prev, attachment])
            uploadAttachment(attachment.id, file)
        }
    }, [uploadAttachment])

    const handleAttach = useCallback(() => {
        const input = document.createElement('input')
        input.type = 'file'
        input.multiple = true
        input.accept = getAcceptExtensions()
        input.onchange = (e) => {
            const files = (e.target as HTMLInputElement).files
            if (import.meta.env.DEV) console.log('[Upload] input.onchange 触发, files=', files?.length ?? 0)
            if (!files) return
            processFiles(Array.from(files))
        }
        if (import.meta.env.DEV) console.log('[Upload] handleAttach → input.click()')
        input.click()
    }, [processFiles])

    const handleRemoveAttachment = useCallback((id: string) => {
        const controller = abortControllersRef.current.get(id)
        if (controller) {
            controller.abort()
            abortControllersRef.current.delete(id)
        }
        setAttachments(prev => {
            const attachment = prev.find(a => a.id === id)
            if (attachment?.status === 'complete' && attachment.path) {
                capabilities.deleteUpload(attachment.path).catch(() => {
                    // 删除失败静默处理
                })
            }
            return prev.filter(a => a.id !== id)
        })
    }, [capabilities])

    // 粘贴上传处理
    const handlePaste = useCallback((e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items
        if (!items) return

        // 检测是否有文件项
        const fileItems = Array.from(items).filter(item => item.kind === 'file')
        if (fileItems.length === 0) return

        // 阻止浏览器默认粘贴行为，避免文件名等文本被插入 textarea
        e.preventDefault()

        // 粘贴的文件可能缺少有效文件名，需修正后交给 processFiles
        const namedFiles: File[] = []
        for (const item of fileItems) {
            const file = item.getAsFile()
            if (!file) continue

            // 为粘贴的文件生成文件名
            // CLI 会在文件名后追加短 ID 保证唯一，这里只需提供语义化的基础名。
            const isImage = file.type.startsWith('image/')
            const originalName = file.name
            // 浏览器常见的粘贴图片占位名，不算有效文件名
            const isPlaceholder = !originalName
                || /^(image|screenshot|paste|clipboard|unknown)(\.\w+)?$/i.test(originalName)
                || originalName === 'file'
            let fileName: string
            if (isPlaceholder) {
                // 占位名：用简短语义名 + 扩展名，CLI 会追加唯一 ID
                const ext = isImage
                    ? imageExtFromMime(file.type)
                    : (NON_IMAGE_MIME_TO_EXT[file.type] ?? '')
                fileName = isImage ? `image${ext}` : `file${ext}`
            } else {
                // 浏览器提供了有效的原始文件名，直接使用
                fileName = originalName
            }

            namedFiles.push(new File([file], fileName, { type: file.type }))
        }

        processFiles(namedFiles)
    }, [processFiles])

    // 拖拽上传事件处理
    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        dragCounterRef.current++
        if (dragCounterRef.current === 1) {
            setIsDragOver(true)
        }
    }, [])

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault()
    }, [])

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        dragCounterRef.current--
        if (dragCounterRef.current === 0) {
            setIsDragOver(false)
        }
    }, [])

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault()
        dragCounterRef.current = 0
        setIsDragOver(false)

        const files = e.dataTransfer?.files
        if (!files || files.length === 0) return

        processFiles(Array.from(files))
    }, [processFiles])

    // 重置附件状态
    const resetAttachments = useCallback(() => {
        setAttachments([])
    }, [])

    return {
        attachments,
        setAttachments,
        isDragOver,
        handleAttach,
        handleRemoveAttachment,
        handlePaste,
        handleDragEnter,
        handleDragOver,
        handleDragLeave,
        handleDrop,
        resetAttachments,
    }
}
