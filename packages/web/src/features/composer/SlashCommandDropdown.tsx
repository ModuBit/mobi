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

import { Sparkles, SquareSlash } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SuggestionList, type SuggestionRow } from '@/ui/base/interactive/suggestion-list/SuggestionList'
import type { SlashCommandSuggestionItem } from '@/domain/command/slashCommandHelper'
import { DropdownContainer } from './DropdownContainer'

/** listbox id：Composer 用它把 textarea 的 aria-controls/activedescendant 关联到列表 */
export const SLASH_LISTBOX_ID = 'mobi-slash-listbox'

/**
 * CC 内置命令的名字色：light 陶土暖橙、dark antd gold，经 CSS 变量随主题切换
 * （variables.css 定义 + base.css dark 覆盖，色值经用户确认）。
 */
const BUILTIN_COMMAND_COLOR = 'var(--mobi-command-builtin)'

interface SlashCommandDropdownProps {
    items: SlashCommandSuggestionItem[]
    loading: boolean
    activeIndex: number
    /** / 后的当前过滤词，仅用于匹配高亮 */
    query: string
    onSelect: (item: SlashCommandSuggestionItem) => void
    onHover: (index: number) => void
}

/** 斜杠命令下拉列表 */
export function SlashCommandDropdown({
    items,
    loading,
    activeIndex,
    query,
    onSelect,
    onHover,
}: SlashCommandDropdownProps) {
    const { t } = useTranslation()

    // 无命令且无过滤词时没有可展示的内容，直接不渲染面板
    if (items.length === 0 && !loading && !query) return null

    // 图标区分命令来源：CC 内置命令（builtin）用斜杠方框，其余（skill / plugin / MCP
    // 定义的命令）用星芒。SDK 的 SlashCommand 只有 builtin 这一个来源标记，没有更细的
    // plugin/user/project 之分，所以非内置统一归为「skill 类」
    const rows: SuggestionRow[] = items.map(item => ({
        key: item.value,
        label: item.label,
        meta: item.description || undefined,
        icon: item.builtin
            ? <SquareSlash size={16} strokeWidth={1.75} />
            : <Sparkles size={16} strokeWidth={1.75} />,
        // 参数提示紧跟命令名（行内短标记），不再甩到行尾
        suffix: item.argumentHint || undefined,
        labelStyle: item.builtin ? { color: BUILTIN_COMMAND_COLOR } : undefined,
    }))

    return (
        <DropdownContainer>
            <SuggestionList
                listId={SLASH_LISTBOX_ID}
                items={rows}
                activeIndex={activeIndex}
                onActiveIndexChange={onHover}
                onSelect={(index) => onSelect(items[index])}
                query={query}
                loading={loading}
                emptyText={query
                    ? t('common.noMatchesFor', { query })
                    : t('common.noMatches')}
            />
        </DropdownContainer>
    )
}
