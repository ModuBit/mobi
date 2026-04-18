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
import { useSlashCommands } from '@/hooks/queries/useSlashCommands'
import { useSkills } from '@/hooks/queries/useSkills'
import {
    mergeCommandsAndSkills,
    filterCommands,
    type SlashCommandSuggestionItem,
} from './slashCommandHelper'

/**
 * 斜杠命令建议 Hook
 *
 * 合并 SlashCommand 和 Skill 数据源，根据过滤文本返回建议列表
 *
 * @param sessionId 会话 ID
 * @param isOpen 下拉是否打开（关闭时禁用数据获取）
 * @param filterText 过滤文本
 */
export function useSlashCommandSuggestion(
    sessionId: string | null,
    isOpen: boolean,
    filterText: string,
): {
    items: SlashCommandSuggestionItem[]
    isLoading: boolean
} {
    // isOpen 为 false 时传 null，禁用查询
    const effectiveSessionId = isOpen ? sessionId : null

    const commandsQuery = useSlashCommands(effectiveSessionId)
    const skillsQuery = useSkills(effectiveSessionId)

    const isLoading = commandsQuery.isLoading || skillsQuery.isLoading

    const items = useMemo(() => {
        const commands = commandsQuery.data ?? []
        const skills = skillsQuery.data ?? []
        const merged = mergeCommandsAndSkills(commands, skills)
        return filterCommands(merged, filterText)
    }, [commandsQuery.data, skillsQuery.data, filterText])

    return { items, isLoading }
}
