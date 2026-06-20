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

/**
 * 通用两栏分栏布局（主面板 | 次要面板）。
 *
 * 设计要点（复刻 AppSidebar 的丝滑感，避免内容被挤压）：
 * - 桌面：左栏 flex 自适应 + 可拖拽分隔条 + 右栏「外层 width 动画 / 内层固定裁剪」。
 *   右栏内层固定为展开时的真实宽度，收起时外层 width 过渡到 0，内容只被裁剪不被挤压。
 * - 移动：两栏绝对定位全尺寸，靠 transform 平移切换，零宽度变化 → 零重排零挤压。
 *
 * 受控组件：expanded / splitRatio 由外部持有，通过回调变更。
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import styled from '@emotion/styled'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { computeSplitRatio, shouldCollapseOnDrag, DEFAULT_LEFT_MIN_RATIO } from './splitLayoutUtils'

export interface SplitLayoutProps {
    /** 左侧（主）面板内容 */
    left: ReactNode
    /** 右侧（次要）面板内容 */
    right: ReactNode
    /** 右侧面板是否展开 */
    expanded: boolean
    /** 左侧占比 0~1（展开时；移动端不适用） */
    splitRatio: number
    /** 展开/收起变更 */
    onExpandedChange: (expanded: boolean) => void
    /** 左侧占比变更（拖拽时触发） */
    onSplitRatioChange: (ratio: number) => void
    /** 左侧最小占比，默认 0.2（安全宽度，不可拖到 0） */
    leftMinRatio?: number
}

// 与 AppSidebar 一致的动画时长/缓动
const DURATION = '0.3s'
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'

/** 桌面左栏：flex 自适应。内容随宽度重排（主面板通常是文字流，重排可接受）。 */
const LeftFlex = styled.div`
    height: 100%;
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
`

/** 桌面右栏外层：width 动画 + 裁剪（与 AppSidebar 同款）。 */
const RightClipOuter = styled.div<{ $width: string }>`
    height: 100%;
    width: ${p => p.$width};
    flex-shrink: 0;
    overflow: hidden;
    transition: width ${DURATION} ${EASING};
`

/** 桌面右栏内层：固定宽度（展开时的真实宽度），不随外层动画重排。 */
const RightClipInner = styled.div<{ $width: number; $visible: boolean }>`
    width: ${p => p.$width}px;
    height: 100%;
    opacity: ${p => (p.$visible ? 1 : 0)};
    pointer-events: ${p => (p.$visible ? 'auto' : 'none')};
    transition: opacity 0.2s ease;
`

/** 可拖拽分隔条（仅桌面 + 展开时显示）。 */
const Divider = styled.div<{ $active: boolean }>`
    width: 4px;
    height: 100%;
    flex-shrink: 0;
    cursor: col-resize;
    background: ${p => (p.$active
        ? 'var(--ant-color-border)'
        : 'var(--ant-color-border-secondary)')};
    transition: background 0.15s ease;
    &:hover {
        background: var(--ant-color-border);
    }
`

/** 移动端容器：两栏绝对定位全尺寸，transform 平移切换。 */
const MobileContainer = styled.div`
    position: relative;
    height: 100%;
    overflow: hidden;
`

const MobilePane = styled.div<{ $tx: string }>`
    position: absolute;
    inset: 0;
    transform: translateX(${p => p.$tx});
    transition: transform ${DURATION} ${EASING};
    will-change: transform;
`

export function SplitLayout({
    left,
    right,
    expanded,
    splitRatio,
    onExpandedChange,
    onSplitRatioChange,
    leftMinRatio = DEFAULT_LEFT_MIN_RATIO,
}: SplitLayoutProps) {
    const isMobile = useIsMobile()
    const containerRef = useRef<HTMLDivElement>(null)
    const [containerWidth, setContainerWidth] = useState(0)
    const [dragging, setDragging] = useState(false)

    // 测量容器宽度（桌面右栏内层固定宽度需要）
    useEffect(() => {
        if (isMobile) return
        const el = containerRef.current
        if (!el) return
        const update = () => setContainerWidth(el.clientWidth)
        update()
        const ro = new ResizeObserver(update)
        ro.observe(el)
        return () => ro.disconnect()
    }, [isMobile])

    const rightFraction = 1 - splitRatio

    // 拖拽分隔条：pointer 事件统一处理鼠标/触摸/触控笔
    const handleDividerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault()
        const el = containerRef.current
        if (!el) return
        const target = e.currentTarget
        target.setPointerCapture(e.pointerId)
        setDragging(true)

        const handleMove = (ev: PointerEvent) => {
            const rect = el.getBoundingClientRect()
            const ratio = computeSplitRatio(ev.clientX, rect.left, rect.width, leftMinRatio)
            if (shouldCollapseOnDrag(ratio)) {
                onExpandedChange(false)
            } else {
                onExpandedChange(true)
                onSplitRatioChange(ratio)
            }
        }
        const handleUp = (ev: PointerEvent) => {
            target.releasePointerCapture(ev.pointerId)
            setDragging(false)
            window.removeEventListener('pointermove', handleMove)
            window.removeEventListener('pointerup', handleUp)
        }
        window.addEventListener('pointermove', handleMove)
        window.addEventListener('pointerup', handleUp)
    }, [leftMinRatio, onExpandedChange, onSplitRatioChange])

    if (isMobile) {
        return (
            <MobileContainer ref={containerRef}>
                {/* 收起：左侧全屏；展开：左侧向左滑出 */}
                <MobilePane $tx={expanded ? '-100%' : '0'}>{left}</MobilePane>
                {/* 收起：右侧在屏外右侧；展开：滑入全屏 */}
                <MobilePane $tx={expanded ? '0' : '100%'}>{right}</MobilePane>
            </MobileContainer>
        )
    }

    return (
        <div ref={containerRef} style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
            <LeftFlex>{left}</LeftFlex>
            {expanded && (
                <Divider
                    $active={dragging}
                    onPointerDown={handleDividerPointerDown}
                    role="separator"
                    aria-orientation="vertical"
                />
            )}
            <RightClipOuter $width={expanded ? `${rightFraction * 100}%` : '0'}>
                <RightClipInner
                    $width={Math.max(0, rightFraction * containerWidth)}
                    $visible={expanded}
                >
                    {right}
                </RightClipInner>
            </RightClipOuter>
        </div>
    )
}
