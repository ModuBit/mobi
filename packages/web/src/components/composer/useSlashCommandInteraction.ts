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

import { useState, useCallback, useMemo } from 'react'
import { detectSlashAtCursor, type SlashCommandSuggestionItem } from '@/domain/command/slashCommandHelper'
import { useSlashCommandSuggestion } from './useSlashCommandSuggestion'
import { recordCommandUsage } from '@/core/lib/commandUsage'
import type { Command } from '@/core/data/api/types'

export interface SlashSelectionResult {
    text: string
    cursorPos: number | null
}

interface UseSlashCommandInteractionParams {
    sessionId: string | null
    workingDir: string | undefined
    commandsData: Command[] | undefined
}

/**
 * / 斜杠命令交互 hook
 * 封装 slash 命令状态管理、检测、选择和键盘导航
 */
export function useSlashCommandInteraction({
    sessionId,
    workingDir,
    commandsData,
}: UseSlashCommandInteractionParams) {
    const [isOpen, setIsOpen] = useState(false)
    const [filter, setFilter] = useState('')
    const [activeIndex, setActiveIndex] = useState(0)
    const [activeCommand, setActiveCommand] = useState<{ value: string; hint: string } | null>(null)

    const { items, isLoading } = useSlashCommandSuggestion(
        isOpen ? sessionId : null,
        isOpen,
        filter,
        workingDir,
    )

    const scrollIntoActive = useCallback((node: HTMLDivElement | null) => {
        node?.scrollIntoView({ block: 'nearest' })
    }, [])

    const processChange = useCallback((text: string, cursorPos: number): boolean => {
        const slashFilter = detectSlashAtCursor(text, cursorPos)
        if (slashFilter !== null) {
            setFilter(slashFilter)
            setIsOpen(true)
            setActiveIndex(0)
            return true
        }

        if (isOpen) {
            setIsOpen(false)
            setFilter('')
        }

        // 文本不匹配已选命令时清理提示状态
        if (activeCommand && text !== `${activeCommand.value} `) {
            setActiveCommand(null)
        }

        // 手动输入 /command + 空格后，匹配参数提示
        const cmdMatch = text.match(/^\/(\S+) $/)
        if (cmdMatch && !activeCommand) {
            const cmdName = `/${cmdMatch[1]}`
            const cmd = commandsData?.find(c =>
                (c.name.startsWith('/') ? c.name : `/${c.name}`) === cmdName
            )
            if (cmd?.argumentHint) {
                setActiveCommand({ value: cmdName, hint: cmd.argumentHint })
            }
        }

        return false
    }, [isOpen, activeCommand, commandsData])

    const selectItem = useCallback((item: SlashCommandSuggestionItem, text: string): SlashSelectionResult | null => {
        if (!isOpen) return null

        const slashEnd = 1 + filter.length
        const after = text.slice(slashEnd)
        const newText = `${item.value} ${after}`

        setActiveCommand(item.argumentHint ? { value: item.value, hint: item.argumentHint } : null)
        setIsOpen(false)
        setFilter('')

        if (workingDir) {
            recordCommandUsage(workingDir, item.value)
        }

        return {
            text: newText,
            cursorPos: item.value.length + 1,
        }
    }, [isOpen, filter, workingDir])

    const selectCurrent = useCallback((text: string): SlashSelectionResult | null => {
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
                setFilter('')
                return true
        }
        return false
    }, [isOpen, items.length])

    const close = useCallback(() => {
        setIsOpen(false)
        setFilter('')
    }, [])

    const reset = useCallback(() => {
        setIsOpen(false)
        setFilter('')
        setActiveCommand(null)
    }, [])

    return useMemo(() => ({
        isOpen,
        items,
        isLoading,
        activeIndex,
        activeCommand,
        setActiveIndex,
        scrollIntoActive,
        processChange,
        selectItem,
        selectCurrent,
        handleKeyDown,
        close,
        reset,
    }), [isOpen, items, isLoading, activeIndex, activeCommand, setActiveIndex, scrollIntoActive, processChange, selectItem, selectCurrent, handleKeyDown, close, reset])
}
