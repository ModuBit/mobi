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

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'
import type { FileAttachment, UploadFunction } from '@/lib/fileAttachments'
import type { AttachmentMetadata } from '@mobi/shared'
import { createFileAttachment } from '@/lib/fileAttachments'

/**
 * Composer 上下文状态
 */
interface ComposerContextState {
    /** 输入文本 */
    text: string
    /** 光标位置 */
    cursorPosition: number
    /** 文件附件列表 */
    attachments: FileAttachment[]
    /** 是否正在发送 */
    isSending: boolean
    /** 是否可以发送 */
    canSend: boolean
}

/**
 * Composer 上下文操作
 */
interface ComposerContextActions {
    /** 设置文本 */
    setText: (text: string) => void
    /** 设置光标位置 */
    setCursorPosition: (position: number) => void
    /** 添加附件 */
    addAttachment: (file: File) => Promise<void>
    /** 移除附件 */
    removeAttachment: (id: string) => void
    /** 清空所有附件 */
    clearAttachments: () => void
    /** 发送消息 */
    send: () => void
    /** 清空输入 */
    clear: () => void
}

/**
 * Composer 上下文类型
 */
interface ComposerContextValue extends ComposerContextState, ComposerContextActions {
    /** 获取附件元数据列表（用于发送消息） */
    getAttachmentMetadata: () => AttachmentMetadata[]
}

const ComposerContext = createContext<ComposerContextValue | null>(null)

/**
 * Composer Provider 属性
 */
interface ComposerProviderProps {
    children: ReactNode
    /** 上传函数 */
    uploadFunction?: UploadFunction
    /** 发送回调 */
    onSend: (text: string, attachments?: AttachmentMetadata[]) => void
    /** 是否禁用 */
    disabled?: boolean
    /** 最大附件数量 */
    maxAttachments?: number
}

/**
 * Composer Provider 组件
 */
export function ComposerProvider({
    children,
    uploadFunction,
    onSend,
    disabled = false,
    maxAttachments = 10
}: ComposerProviderProps) {
    const [text, setText] = useState('')
    const [cursorPosition, setCursorPosition] = useState(0)
    const [attachments, setAttachments] = useState<FileAttachment[]>([])
    const [isSending, setIsSending] = useState(false)

    // 判断是否可以发送
    const canSend = useMemo(() => {
        if (disabled || isSending) return false
        if (!text.trim() && attachments.length === 0) return false
        // 检查所有附件是否已上传完成
        const allUploaded = attachments.every(a => a.status === 'complete')
        return allUploaded
    }, [disabled, isSending, text, attachments])

    // 添加附件
    const addAttachment = useCallback(async (file: File) => {
        if (attachments.length >= maxAttachments) {
            console.warn('已达到最大附件数量限制')
            return
        }

        const attachment = createFileAttachment(file)
        setAttachments(prev => [...prev, attachment])

        // 如果有上传函数，执行上传
        if (uploadFunction) {
            try {
                const result = await uploadFunction(file)
                if (result.success && result.path) {
                    setAttachments(prev =>
                        prev.map(a =>
                            a.id === attachment.id
                                ? { ...a, status: 'complete' as const, path: result.path }
                                : a
                        )
                    )
                } else {
                    setAttachments(prev =>
                        prev.map(a =>
                            a.id === attachment.id
                                ? { ...a, status: 'error' as const, error: result.error || '上传失败' }
                                : a
                        )
                    )
                }
            } catch (error) {
                setAttachments(prev =>
                    prev.map(a =>
                        a.id === attachment.id
                            ? { ...a, status: 'error' as const, error: String(error) }
                            : a
                    )
                )
            }
        } else {
            // 没有上传函数，直接标记为完成
            setAttachments(prev =>
                prev.map(a =>
                    a.id === attachment.id
                        ? { ...a, status: 'complete' as const }
                        : a
                )
            )
        }
    }, [attachments.length, maxAttachments, uploadFunction])

    // 移除附件
    const removeAttachment = useCallback((id: string) => {
        setAttachments(prev => prev.filter(a => a.id !== id))
    }, [])

    // 清空所有附件
    const clearAttachments = useCallback(() => {
        setAttachments([])
    }, [])

    // 获取附件元数据
    const getAttachmentMetadata = useCallback((): AttachmentMetadata[] => {
        return attachments
            .filter(a => a.status === 'complete' && a.path)
            .map(a => ({
                id: a.id,
                filename: a.file.name,
                mimeType: a.file.type || 'application/octet-stream',
                size: a.file.size,
                path: a.path!
            }))
    }, [attachments])

    // 发送消息
    const send = useCallback(() => {
        if (!canSend) return

        setIsSending(true)
        try {
            const metadata = getAttachmentMetadata()
            onSend(text, metadata.length > 0 ? metadata : undefined)
            // 发送后清空
            setText('')
            clearAttachments()
        } finally {
            setIsSending(false)
        }
    }, [canSend, getAttachmentMetadata, onSend, text, clearAttachments])

    // 清空输入
    const clear = useCallback(() => {
        setText('')
        setCursorPosition(0)
        clearAttachments()
    }, [clearAttachments])

    const value = useMemo<ComposerContextValue>(() => ({
        text,
        cursorPosition,
        attachments,
        isSending,
        canSend,
        setText,
        setCursorPosition,
        addAttachment,
        removeAttachment,
        clearAttachments,
        getAttachmentMetadata,
        send,
        clear
    }), [
        text,
        cursorPosition,
        attachments,
        isSending,
        canSend,
        addAttachment,
        removeAttachment,
        clearAttachments,
        getAttachmentMetadata,
        send,
        clear
    ])

    return (
        <ComposerContext.Provider value={value}>
            {children}
        </ComposerContext.Provider>
    )
}

/**
 * 使用 Composer 上下文 Hook
 */
export function useComposer(): ComposerContextValue {
    const context = useContext(ComposerContext)
    if (!context) {
        throw new Error('useComposer must be used within a ComposerProvider')
    }
    return context
}
