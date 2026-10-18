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
 * 建议列表 ARIA：textarea 由 antd X Sender 管理，属性经 DOM 直写。
 * 不在 Sender 上声明 role/aria——Sender 会把 restProps 同时铺到根容器，
 * 整个输入卡会被读成 combobox。
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

    useEffect(() => {
        const textarea = wrapperRef.current?.querySelector('textarea')
        if (!textarea) return
        textarea.setAttribute('role', 'combobox')
        textarea.setAttribute('aria-autocomplete', 'list')
        textarea.setAttribute('aria-expanded', listId ? 'true' : 'false')
        if (!listId) {
            textarea.removeAttribute('aria-controls')
            textarea.removeAttribute('aria-activedescendant')
            return
        }
        textarea.setAttribute('aria-controls', listId)
        if (count > 0 && activeIndex >= 0) {
            textarea.setAttribute('aria-activedescendant', `${listId}-option-${activeIndex}`)
        } else {
            textarea.removeAttribute('aria-activedescendant')
        }
    }, [wrapperRef, listId, activeIndex, count])
}
