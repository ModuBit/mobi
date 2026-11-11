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

import { useEffect } from 'react'
import type { RefObject } from 'react'

/** 当前展开的建议列表（mention / slash 二者互斥，未展开为 null） */
export interface ActiveSuggestionList {
    listId: string
    activeIndex: number
    count: number
}

/**
 * 建议列表 ARIA：输入控件（ChatInput 的 .ProseMirror）由组件自管，属性经 DOM 直写。
 *
 * 两个 composer 页（新会话 / 聊天）共用同一份属性方案，id 约定 `${listId}-option-<index>`
 * 与 SuggestionList 保持一致。
 */
export function useSuggestionListAria(
    wrapperRef: RefObject<HTMLElement | null>,
    suggestion: ActiveSuggestionList | null,
) {
    const listId = suggestion?.listId ?? null
    const activeIndex = suggestion?.activeIndex ?? -1
    const count = suggestion?.count ?? 0
    // listbox 只在有候选项时真正挂载（空态/加载态只渲染占位）：expanded 与 controls
    // 必须跟着实际挂载走，否则 aria-controls 指向不存在的 id
    const expanded = listId !== null && count > 0

    useEffect(() => {
        const inputEl = wrapperRef.current?.querySelector('.ProseMirror')
        if (!inputEl) return
        inputEl.setAttribute('role', 'combobox')
        inputEl.setAttribute('aria-autocomplete', 'list')
        inputEl.setAttribute('aria-expanded', expanded ? 'true' : 'false')
        if (!expanded || !listId) {
            inputEl.removeAttribute('aria-controls')
            inputEl.removeAttribute('aria-activedescendant')
            return
        }
        inputEl.setAttribute('aria-controls', listId)
        if (activeIndex >= 0) {
            inputEl.setAttribute('aria-activedescendant', `${listId}-option-${activeIndex}`)
        } else {
            inputEl.removeAttribute('aria-activedescendant')
        }
    }, [wrapperRef, expanded, listId, activeIndex, count])
}
