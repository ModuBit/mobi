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

import { File, Folder } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SuggestionList, type SuggestionRow } from '@/ui/base/interactive/suggestion-list/SuggestionList'
import type { FileSuggestionItem } from './useSessionFileListing'
import { DropdownContainer } from './DropdownContainer'

/** listbox id：Composer 用它把 textarea 的 aria-controls/activedescendant 关联到列表 */
export const MENTION_LISTBOX_ID = 'mobi-mention-listbox'

interface MentionDropdownProps {
    items: FileSuggestionItem[]
    loading: boolean
    activeIndex: number
    /** @ 后的当前查询词，仅用于匹配高亮 */
    query: string
    onSelect: (item: FileSuggestionItem) => void
    onHover: (index: number) => void
}

/** @ 文件引用下拉列表 */
export function MentionDropdown({
    items,
    loading,
    activeIndex,
    query,
    onSelect,
    onHover,
}: MentionDropdownProps) {
    const { t } = useTranslation()

    // 空目录且无查询词时没有可展示的内容，直接不渲染面板
    if (items.length === 0 && !loading && !query) return null

    const rows: SuggestionRow[] = items.map(item => ({
        key: item.value,
        label: item.label,
        icon: item.isDirectory
            ? <Folder size={16} strokeWidth={1.75} />
            : <File size={16} strokeWidth={1.75} />,
        // 目录标记紧跟名字（如 src/features/chat/），不甩到行尾与滚动条挤在一起
        suffix: item.isDirectory ? '/' : undefined,
    }))

    return (
        <DropdownContainer>
            <SuggestionList
                listId={MENTION_LISTBOX_ID}
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
