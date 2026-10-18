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

/** 行的默认标记（与 HoverGlideLayer / GlideLayer 约定一致） */
const ROW_SELECTOR = '[data-glide-row]'
/** 激活行的默认标记 */
const ACTIVE_SELECTOR = '[data-glide-active="true"]'

interface GlideHighlightOptions {
    /** 行元素选择器：激活元素在行内部时，向上找最近的行 */
    rowSelector?: string
    /** 激活行标记选择器 */
    activeSelector?: string
}

/**
 * 选中滑移高亮的元素追踪（不含渲染）：解析出「当前哪一行是激活态」，
 * 交给 GlideLayer 做弹簧挪动。悬停追踪由 HoverGlideLayer 自己承担（不重渲染列表）。
 *
 * 每次 commit 后重新解析（故意不给依赖数组）：行会随数据到达、筛选、虚拟滚动
 * 重新挂载，调用方无法可靠地声明「什么时候该重找」；一次 querySelector 的成本
 * 远小于让调用方猜依赖。行/激活标记走 data-glide-* 约定，调用点通常无需传参。
 * 容器需 `position: relative`，GlideLayer 与行平级渲染。
 */
export function useGlideHighlight<T extends HTMLElement = HTMLDivElement>({
    rowSelector = ROW_SELECTOR,
    activeSelector = ACTIVE_SELECTOR,
}: GlideHighlightOptions = {}) {
    const containerRef = useRef<T>(null)
    const [activeEl, setActiveEl] = useState<HTMLElement | null>(null)

    useLayoutEffect(() => {
        const container = containerRef.current
        if (!container) {
            setActiveEl(null)
            return
        }
        const hit = container.querySelector<HTMLElement>(activeSelector)
        setActiveEl(hit ? (hit.closest<HTMLElement>(rowSelector) ?? hit) : null)
    })

    return { containerRef, activeEl }
}
