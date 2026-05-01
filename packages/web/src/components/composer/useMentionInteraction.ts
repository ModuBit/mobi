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

import { useState, useCallback, useMemo, useRef } from 'react'
import { detectMentionAtCursor, buildMentionPath } from '@/domain/command/mentionParser'
import { useSessionFileListing, type FileListingInput, type FileSuggestionItem } from './useSessionFileListing'

export interface MentionSelectionResult {
    text: string
    cursorPos: number | null
}

interface UseMentionInteractionParams {
    sessionId: string | null
    workingDir: string | undefined
}

/**
 * @ 文件引用交互 hook
 * 封装 mention 状态管理、检测、选择和键盘导航
 */
export function useMentionInteraction({
    sessionId,
    workingDir,
}: UseMentionInteractionParams) {
    const [isOpen, setIsOpen] = useState(false)
    const [mentionInput, setMentionInput] = useState<FileListingInput | null>(null)
    const [activeIndex, setActiveIndex] = useState(0)
    const mentionAtIndexRef = useRef(-1)

    const { items, isLoading } = useSessionFileListing(
        isOpen ? sessionId : null,
        mentionInput,
    )

    const scrollIntoActive = useCallback((node: HTMLDivElement | null) => {
        node?.scrollIntoView({ block: 'nearest' })
    }, [])

    const processChange = useCallback((text: string, cursorPos: number): boolean => {
        const mention = detectMentionAtCursor(text, cursorPos)
        if (mention) {
            mentionAtIndexRef.current = mention.atIndex
            setMentionInput({
                mentionInput: mention.afterAt,
                workingDir: workingDir ?? '',
            })
            setIsOpen(true)
            setActiveIndex(0)
            return true
        }
        return false
    }, [workingDir])

    const selectItem = useCallback((item: FileSuggestionItem, text: string): MentionSelectionResult | null => {
        if (!isOpen || !mentionInput) return null

        const atIndex = mentionAtIndexRef.current
        const afterLen = mentionInput.mentionInput.length
        const before = atIndex >= 0 ? text.slice(0, atIndex) : text
        const after = atIndex >= 0 ? text.slice(atIndex + 1 + afterLen) : ''

        if (item.isDirectory) {
            const dirPath = item.path ? item.path + '/' : buildMentionPath(mentionInput.mentionInput, item.value) + '/'
            mentionAtIndexRef.current = atIndex
            setMentionInput({
                mentionInput: dirPath,
                workingDir: mentionInput.workingDir,
            })
            setActiveIndex(0)
            return {
                text: `${before}@${dirPath}${after}`,
                cursorPos: atIndex + 1 + dirPath.length,
            }
        }

        const mentionPath = item.path ?? buildMentionPath(mentionInput.mentionInput, item.value)
        setIsOpen(false)
        setMentionInput(null)
        return {
            text: `${before}@${mentionPath} ${after}`,
            cursorPos: before.length + 1 + mentionPath.length + 1,
        }
    }, [isOpen, mentionInput])

    const selectCurrent = useCallback((text: string): MentionSelectionResult | null => {
        if (!isOpen || items.length === 0) return null
        return selectItem(items[activeIndex], text)
    }, [isOpen, items, activeIndex, selectItem])

    const handleKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
        if (!isOpen || items.length === 0) return false

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault()
                setActiveIndex(prev => (prev + 1) % items.length)
                return true
            case 'ArrowUp':
                e.preventDefault()
                setActiveIndex(prev => (prev - 1 + items.length) % items.length)
                return true
            case 'Escape':
                e.preventDefault()
                setIsOpen(false)
                setMentionInput(null)
                return true
        }
        return false
    }, [isOpen, items.length])

    const close = useCallback(() => {
        setIsOpen(false)
        setMentionInput(null)
        mentionAtIndexRef.current = -1
    }, [])

    return useMemo(() => ({
        isOpen,
        items,
        isLoading,
        activeIndex,
        setActiveIndex,
        scrollIntoActive,
        processChange,
        selectItem,
        selectCurrent,
        handleKeyDown,
        close,
    }), [isOpen, items, isLoading, activeIndex, setActiveIndex, scrollIntoActive, processChange, selectItem, selectCurrent, handleKeyDown, close])
}
