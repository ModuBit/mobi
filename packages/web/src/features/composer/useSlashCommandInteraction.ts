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

import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
    detectSlashAtCursor,
    slashCommandText,
    type SlashCommandInsert,
    type SlashCommandSuggestionItem,
} from '@/domain/command/slashCommandHelper'
import { useSlashCommandSuggestion } from './useSlashCommandSuggestion'
import { recordCommandUsage } from '@/core/lib/commandUsage'
import type { Command } from '@/core/data/api/types'

export interface SlashSelectionResult {
    text: string
    cursorPos: number | null
    /**
     * 原子节点插入参数（composer 把命令收成不可拆节点用）。
     * from/to 为纯文本 offset 区间：from 命中前导普通空格时含该空格；
     * to 吸收命令词之后的普通空格（节点自带尾随空格，不吸收会叠加成双空格），
     * 制表符等其余空白保留在正文。两者都由节点 attrs 原样还原，文本字面量不变。
     */
    slashCommand?: SlashCommandInsert
}

interface UseSlashCommandInteractionParams {
    commandsData: Command[]
    commandsLoading: boolean
    workingDir: string | undefined
}

/**
 * / 斜杠命令交互 hook
 * 封装 slash 命令状态管理、检测、选择和键盘导航
 */
export function useSlashCommandInteraction({
    commandsData,
    commandsLoading,
    workingDir,
}: UseSlashCommandInteractionParams) {
    const [isOpen, setIsOpen] = useState(false)
    const [filter, setFilter] = useState('')
    const [activeIndex, setActiveIndex] = useState(0)
    const [activeCommand, setActiveCommand] = useState<{ value: string; hint: string; description?: string } | null>(null)
    // 当前触发 / 的位置（与 @mention 的 mentionAtIndexRef 对齐），用于选择时按位置切分文本
    const slashIndexRef = useRef(0)

    const { items, isLoading } = useSlashCommandSuggestion(
        commandsData,
        commandsLoading,
        isOpen,
        filter,
        workingDir,
    )

    // 命令集收缩时夹取下标：否则 Enter/Tab 取到 items[越界] === undefined
    useEffect(() => {
        setActiveIndex(prev => (items.length ? Math.min(prev, items.length - 1) : 0))
    }, [items])

    const processChange = useCallback((text: string, cursorPos: number): boolean => {
        const slash = detectSlashAtCursor(text, cursorPos)
        if (slash) {
            slashIndexRef.current = slash.slashIndex
            setFilter(slash.filter)
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
            const cmd = commandsData.find(c =>
                (c.name.startsWith('/') ? c.name : `/${c.name}`) === cmdName
            )
            if (cmd?.argumentHint || cmd?.description) {
                setActiveCommand({ value: cmdName, hint: cmd.argumentHint ?? '', description: cmd.description })
            }
        }

        return false
    }, [isOpen, activeCommand, commandsData])

    const selectItem = useCallback((item: SlashCommandSuggestionItem, text: string): SlashSelectionResult | null => {
        if (!isOpen) return null

        // 按 / 触发位置切分：from = 原子替换起点，rawAfter = 命令词之后到末尾的文本
        const slashIndex = slashIndexRef.current
        // 只吸收普通空格作为节点前导分隔（制表符/换行不吸收：节点的 renderText 只会
        // 还原普通空格，吸收它们会改写字面量；行首本身即是 CC 认可的边界）
        const leadingSpace = slashIndex > 0 && text[slashIndex - 1] === ' '
        // 原子替换的起点：命中前导空格时把该空格一并收进节点
        const from = leadingSpace ? slashIndex - 1 : slashIndex
        // 原子替换的终点：吸收命令词之后的普通空格（节点自带尾随空格，
        // 不吸收会叠加成双空格；制表符等其余空白留给正文——节点 renderText
        // 只还原普通空格，吸收会改写字面量，纪律与前导侧一致）
        const rawAfter = text.slice(slashIndex + 1 + filter.length)
        const absorbedGap = (rawAfter.match(/^ */) ?? [''])[0]
        const to = slashIndex + 1 + filter.length + absorbedGap.length
        // 插入后的参数文本：去掉参数的前导普通空格，由节点自带的尾随空格作为唯一分隔
        const after = rawAfter.replace(/^ +/, '')
        const command = item.value.startsWith('/') ? item.value.slice(1) : item.value
        // 单一口径：原子 attrs → 字面量。fallback 文本与光标都由同一函数派生，
        // 不会再出现「原子路径 / 文本路径」两套空白规则
        const literal = slashCommandText({ command, leadingSpace, trailingSpace: true })

        setActiveCommand(
            (item.argumentHint || item.description)
                ? { value: item.value, hint: item.argumentHint ?? '', description: item.description }
                : null,
        )
        setIsOpen(false)
        setFilter('')

        if (workingDir) {
            recordCommandUsage(workingDir, item.value)
        }

        return {
            text: text.slice(0, from) + literal + after,
            // 光标停在「命令 + 分隔空格」之后，即参数起始（无参数时为文本末尾，便于继续输入）
            cursorPos: from + literal.length,
            // 原子节点：把 /命令 收成不可拆节点；前导空白一并收进节点，
            // 由节点的 renderText 还原（CC 的边界识别依赖这个分隔空白）
            slashCommand: { command, from, to, leadingSpace },
        }
    }, [isOpen, filter, workingDir])

    const selectCurrent = useCallback((text: string): SlashSelectionResult | null => {
        if (!isOpen || items.length === 0) return null
        return selectItem(items[activeIndex], text)
    }, [isOpen, items, activeIndex, selectItem])

    // 键位事件参数取结构类型（key/preventDefault）：React 合成事件与 ChatInput 转发的
    // 原生 KeyboardEvent 都满足（composer 换底座后两个来源并存）
    const handleKeyDown = useCallback((e: { key: string; preventDefault(): void }): boolean => {
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
        slashIndexRef.current = 0
    }, [])

    return useMemo(() => ({
        isOpen,
        items,
        isLoading,
        activeIndex,
        activeCommand,
        /** / 后的当前过滤词，供建议列表做匹配高亮 */
        filter,
        setActiveIndex,
        processChange,
        selectItem,
        selectCurrent,
        handleKeyDown,
        close,
        reset,
    }), [isOpen, items, isLoading, activeIndex, activeCommand, filter, setActiveIndex, processChange, selectItem, selectCurrent, handleKeyDown, close, reset])
}
