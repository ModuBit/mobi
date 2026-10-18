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

import { useLayoutEffect, useRef, useState } from 'react'

interface GlideHighlightOptions {
    /** 行元素选择器：hover 追踪与选中回落都以它为准 */
    rowSelector: string
    /** 激活行标记选择器（命中元素会向上找最近的 rowSelector） */
    activeSelector: string
    /** 激活项的信号（activeId / pathname 等），变化时重新解析激活行 */
    activeKey: unknown
    /** 触屏表面（移动端）没有 hover，传 false 关闭悬停追踪 */
    hover?: boolean
}

/**
 * 列表滑移高亮的元素追踪（不含渲染）：把「鼠标停在哪个行」「当前哪一行是激活态」
 * 解析成 DOM 元素，交给 GlideLayer 做弹簧挪动。
 *
 * 约定：行上加 `data-*` 标记（rowSelector 命中），激活行加 activeSelector 标记；
 * 容器需 `position: relative`，GlideLayer 与行平级渲染。
 * 用 useLayoutEffect 同步激活行，避免首帧从旧位置滑过来。
 */
export function useGlideHighlight<T extends HTMLElement = HTMLDivElement>({
    rowSelector,
    activeSelector,
    activeKey,
    hover = true,
}: GlideHighlightOptions) {
    const containerRef = useRef<T>(null)
    const [hoverEl, setHoverEl] = useState<HTMLElement | null>(null)
    const [activeEl, setActiveEl] = useState<HTMLElement | null>(null)

    useLayoutEffect(() => {
        const container = containerRef.current
        if (!container) {
            setActiveEl(null)
            return
        }
        const hit = container.querySelector<HTMLElement>(activeSelector)
        setActiveEl(hit ? (hit.closest<HTMLElement>(rowSelector) ?? hit) : null)
    }, [activeKey, activeSelector, rowSelector])

    const onPointerOver = hover
        ? (event: React.PointerEvent<HTMLElement>) => {
              const container = containerRef.current
              const hit = (event.target as Element).closest<HTMLElement>(rowSelector)
              const row = hit && container?.contains(hit) ? hit : null
              if (row !== hoverEl) setHoverEl(row)
          }
        : undefined

    const onPointerLeave = hover
        ? () => {
              if (hoverEl) setHoverEl(null)
          }
        : undefined

    return { containerRef, hoverEl, activeEl, onPointerOver, onPointerLeave }
}
