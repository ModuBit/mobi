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
 *
 * 编辑器是异步挂载的（immediatelyRender:false）：挂载首帧拿不到 .ProseMirror 时
 * 逐帧重试，直到出现或超出上限；出现后用 MutationObserver 兜住「编辑器 setProps /
 * 重建 DOM 把 role 等属性冲掉」的情况（属性与期望不一致时补回）。
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
        let cancelled = false
        let frame: number | null = null
        let observer: MutationObserver | null = null
        let retries = 0
        // ~2s 内等编辑器挂载；仍未出现则等下一次状态变化触发本 effect 重跑
        const MAX_FRAMES = 120

        const expectedAttrs = (): Record<string, string | null> => ({
            role: 'combobox',
            'aria-autocomplete': 'list',
            'aria-expanded': expanded ? 'true' : 'false',
            'aria-controls': expanded && listId ? listId : null,
            'aria-activedescendant': expanded && listId && activeIndex >= 0
                ? `${listId}-option-${activeIndex}`
                : null,
        })

        /** 写入期望属性；null 值表示移除。返回是否发生了改动 */
        const apply = (inputEl: HTMLElement): boolean => {
            let changed = false
            for (const [name, value] of Object.entries(expectedAttrs())) {
                if (value == null) {
                    if (inputEl.hasAttribute(name)) {
                        inputEl.removeAttribute(name)
                        changed = true
                    }
                } else if (inputEl.getAttribute(name) !== value) {
                    inputEl.setAttribute(name, value)
                    changed = true
                }
            }
            return changed
        }

        const findInput = (): HTMLElement | null => (
            wrapperRef.current?.querySelector('.ProseMirror') as HTMLElement | null
        )

        const attach = () => {
            if (cancelled) return
            const inputEl = findInput()
            if (!inputEl) {
                if (retries++ < MAX_FRAMES) frame = requestAnimationFrame(attach)
                return
            }
            apply(inputEl)
            observer = new MutationObserver(() => {
                if (cancelled) return
                // 只在属性被外部改写时补写（apply 自身写入后属性已一致，不会自激循环）
                apply(inputEl)
            })
            observer.observe(inputEl, {
                attributes: true,
                attributeFilter: ['role', 'aria-autocomplete', 'aria-expanded', 'aria-controls', 'aria-activedescendant'],
            })
        }

        attach()
        return () => {
            cancelled = true
            if (frame != null) cancelAnimationFrame(frame)
            observer?.disconnect()
        }
    }, [wrapperRef, expanded, listId, activeIndex, count])
}
