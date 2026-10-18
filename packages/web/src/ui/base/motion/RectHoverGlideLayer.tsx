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

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import styled from '@emotion/styled'
import { motion, useReducedMotion } from 'motion/react'
import { spring } from './presets'
import { motionTokens } from './motionTokens'

/** 相对容器 padding box 的矩形 + 是否可见（不可见时保留末次几何只淡出） */
interface Rect {
    x: number
    y: number
    w: number
    h: number
    visible: boolean
}

/**
 * 矩形悬停滑移层：几何取「行内某个元素」的实测矩形（如树的标题内层），
 * 而不是行本身——底色与文字同宽，缩进与行尾留白不铺色。
 *
 * 与 HoverGlideLayer 同一约定：指针追踪与 state 都收在本组件里，列表零重渲染；
 * 不同之处是它需要 x/width 几何，因此自己驱动 motion 的四个量。
 * hideOnScroll：虚拟列表滚动后行的几何整体失效，先淡出，下一次指针移动重新定位。
 *
 * 几何量（x/y/width/height）直接走弹簧而不是 transform scale：本层是绝对定位的空
 * 覆盖层，尺寸变化只影响它自身、不触发行与列表重排；若用 scaleX/scaleY 模拟宽度，
 * 非等比缩放会把圆角拉成椭圆。
 */
const Fill = styled(motion.span)`
    position: absolute;
    top: 0;
    left: 0;
    /* -1 + 容器 isolation：落在内容之下、容器背景之上 */
    z-index: -1;
    pointer-events: none;
`

interface RectHoverGlideLayerProps {
    /** 定位与搜索容器（需 position: relative / isolation: isolate） */
    containerRef: RefObject<HTMLElement | null>
    /** 行选择器（默认 data-glide-row 约定） */
    rowSelector?: string
    /** 行内测量目标选择器：几何取它的矩形 */
    measureSelector: string
    /** 滚动时淡出（虚拟列表） */
    hideOnScroll?: boolean
    $background: string
    $radius?: string
    className?: string
}

export function RectHoverGlideLayer({
    containerRef,
    rowSelector = '[data-glide-row]',
    measureSelector,
    hideOnScroll,
    $background,
    $radius = 'var(--radius-control-sm)',
    className,
}: RectHoverGlideLayerProps) {
    const reduced = useReducedMotion()
    const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0, visible: false })
    const titleRef = useRef<HTMLElement | null>(null)
    /** 首次落位 / 隐藏后再出现直接就位：只有连续换行才滑移，避免从旧几何或 0 点长途飞入 */
    const placedRef = useRef(false)

    const hide = useCallback(() => {
        titleRef.current = null
        placedRef.current = false
        setRect((prev) => (prev.visible ? { ...prev, visible: false } : prev))
    }, [])

    useEffect(() => {
        if (rect.visible) placedRef.current = true
    }, [rect.visible])

    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        const handleOver = (event: PointerEvent) => {
            const row = (event.target as Element).closest<HTMLElement>(rowSelector)
            const measured = row?.querySelector<HTMLElement>(measureSelector) ?? row
            if (!measured || !container.contains(measured)) {
                hide()
                return
            }
            if (measured === titleRef.current) return
            titleRef.current = measured
            const r = measured.getBoundingClientRect()
            const w = container.getBoundingClientRect()
            setRect({ x: r.left - w.left, y: r.top - w.top, w: r.width, h: r.height, visible: true })
        }
        const handleLeave = () => hide()
        const handleScroll = () => hide()
        container.addEventListener('pointerover', handleOver)
        container.addEventListener('pointerleave', handleLeave)
        if (hideOnScroll) container.addEventListener('scroll', handleScroll, true)
        return () => {
            container.removeEventListener('pointerover', handleOver)
            container.removeEventListener('pointerleave', handleLeave)
            if (hideOnScroll) container.removeEventListener('scroll', handleScroll, true)
        }
    }, [containerRef, rowSelector, measureSelector, hideOnScroll, hide])

    return (
        <Fill
            aria-hidden="true"
            className={className}
            initial={false}
            animate={{
                x: rect.x,
                y: rect.y,
                width: rect.w,
                height: rect.h,
                opacity: rect.visible ? 1 : 0,
            }}
            transition={
                reduced || (rect.visible && !placedRef.current)
                    ? { duration: 0 }
                    : { default: spring.glide, opacity: { duration: motionTokens.duration.instant } }
            }
            style={{ borderRadius: $radius, background: $background }}
        />
    )
}
