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

import { useMemo } from 'react'
import {
    toCommandSuggestions,
    filterCommands,
    type SlashCommandSuggestionItem,
} from '@/domain/command/slashCommandHelper'
import type { Command } from '@/core/data/api/types'

/**
 * 斜杠命令建议 Hook
 *
 * 根据过滤文本返回建议列表，按使用频率排序
 *
 * @param commands 命令列表（由调用方通过 useDirectoryCommands 获取）
 * @param isLoading 命令列表是否仍在加载
 * @param isOpen 下拉是否打开（关闭时跳过过滤计算）
 * @param filterText 过滤文本（不含 / 前缀）
 * @param workingDir 当前工作目录，用于绑定使用统计
 */
export function useSlashCommandSuggestion(
    commands: Command[],
    isLoading: boolean,
    isOpen: boolean,
    filterText: string,
    workingDir?: string,
): {
    items: SlashCommandSuggestionItem[]
    isLoading: boolean
} {
    const items = useMemo(() => {
        if (!isOpen) return []
        const suggestions = toCommandSuggestions(commands, workingDir)
        return filterCommands(suggestions, filterText)
    }, [commands, isOpen, filterText, workingDir])

    return { items, isLoading }
}
