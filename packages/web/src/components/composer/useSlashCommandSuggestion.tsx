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
import { useCommands } from '@/core/data/hooks/queries/useCommands'
import {
    toCommandSuggestions,
    filterCommands,
    type SlashCommandSuggestionItem,
} from './slashCommandHelper'

/**
 * 斜杠命令建议 Hook
 *
 * 根据过滤文本返回建议列表，按使用频率排序
 *
 * @param sessionId 会话 ID
 * @param isOpen 下拉是否打开（关闭时禁用数据获取）
 * @param filterText 过滤文本（不含 / 前缀）
 * @param workingDir 当前工作目录，用于绑定使用统计
 */
export function useSlashCommandSuggestion(
    sessionId: string | null,
    isOpen: boolean,
    filterText: string,
    workingDir?: string,
): {
    items: SlashCommandSuggestionItem[]
    isLoading: boolean
} {
    // isOpen 为 false 时传 null，禁用查询
    const effectiveSessionId = isOpen ? sessionId : null

    const commandsQuery = useCommands(effectiveSessionId)

    const items = useMemo(() => {
        const commands = commandsQuery.data ?? []
        const suggestions = toCommandSuggestions(commands, workingDir)
        return filterCommands(suggestions, filterText)
    }, [commandsQuery.data, filterText, workingDir])

    return { items, isLoading: commandsQuery.isLoading }
}
