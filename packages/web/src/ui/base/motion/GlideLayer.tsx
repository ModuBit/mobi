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

import { useEffect, useState, type RefObject } from 'react'
import styled from '@emotion/styled'
import { GlidingHighlight } from './GlidingHighlight'

/**
 * 列表滑移底色层（hover / 选中通用的视觉件）。
 *
 * 由 GlidingHighlight 弹簧跟随目标行的 top/height；放在列表容器里、行之前，
 * 容器需 `position: relative`，行需处于定位层（或用 z-index 保证盖在层上）。
 * 与行的两种目标配合使用：悬停见 HoverGlideLayer（自管指针），选中见 useGlideHighlight。
 */
export const GlideLayer = styled(GlidingHighlight)<{ $background: string; $radius?: string }>`
    position: absolute;
    right: 0;
    left: 0;
    border-radius: ${(p) => p.$radius ?? 'var(--radius-icon)'};
    background: ${(p) => p.$background};
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--mobi-duration-fast) var(--mobi-ease-out);
    &[data-on] {
        opacity: 1;
    }
    @media (prefers-reduced-motion: reduce) {
        transition: none;
    }
`

interface HoverGlideLayerProps {
    /** 列表容器：既是行标记的搜索范围，也是滑移层的定位容器 */
    containerRef: RefObject<HTMLElement | null>
    /** 行选择器，默认 data-glide-row 约定 */
    rowSelector?: string
    $background: string
    $radius?: string
}

/**
 * 悬停滑移层：自己监听容器的 pointerover / pointerleave 并持有悬停行 state。
 *
 * 悬停状态不放进列表组件：列表组件持有它会导致每次换行都重渲染整个列表
 * （会话行 / 树节点都未 memo）。状态收在这一层里，列表本身零重渲染。
 */
export function HoverGlideLayer({
    containerRef,
    rowSelector = '[data-glide-row]',
    $background,
    $radius,
}: HoverGlideLayerProps) {
    const [hoverEl, setHoverEl] = useState<HTMLElement | null>(null)

    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        const handleOver = (event: PointerEvent) => {
            const hit = (event.target as Element).closest<HTMLElement>(rowSelector)
            setHoverEl(hit && container.contains(hit) ? hit : null)
        }
        const handleLeave = () => setHoverEl(null)
        container.addEventListener('pointerover', handleOver)
        container.addEventListener('pointerleave', handleLeave)
        return () => {
            container.removeEventListener('pointerover', handleOver)
            container.removeEventListener('pointerleave', handleLeave)
        }
    }, [containerRef, rowSelector])

    return <GlideLayer target={hoverEl} $background={$background} $radius={$radius} />
}
