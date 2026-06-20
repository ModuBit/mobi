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
 * - 桌面：两栏均「外层宽度动画 / 内层固定裁剪」。
 *   内层固定为各自的自然宽度，外层收起/展开/最大化时 width 过渡，
 *   内容只被裁剪不被挤压。
 * - 可拖拽分隔条调整比例（主面板有最小占比保护，拖不到 0）。
 * - 次要面板可「最大化」（主面板归零、次要占满），这是主面板归零的唯一途径。
 * - 移动：两栏绝对定位全尺寸，transform 平移切换，零宽度变化 → 零重排零挤压。
 *
 * 受控组件：expanded / splitRatio / secondaryMaximized 由外部持有，通过回调变更。
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
    /** 左侧占比 0~1（展开且未最大化时；移动端不适用） */
    splitRatio: number
    /** 右侧是否最大化（左侧归零、右侧占满；仅桌面 + 展开时生效） */
    secondaryMaximized: boolean
    /** 展开/收起变更 */
    onExpandedChange: (expanded: boolean) => void
    /** 左侧占比变更（拖拽时触发） */
    onSplitRatioChange: (ratio: number) => void
    /** 左侧最小占比，默认 0.2（安全宽度，拖动不可突破；最大化不受此限） */
    leftMinRatio?: number
    /** 默认左侧占比，拖拽至收起后重新展开时恢复用，默认 0.5 */
    defaultSplitRatio?: number
}

// 与 AppSidebar 一致的动画时长/缓动
const DURATION = '0.3s'
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'

/**
 * 桌面左栏外层：flex 自适应（宽度随右栏外层动画而变）。
 * overflow hidden 裁剪内层固定宽度内容 → 归零时不挤压。
 */
const LeftFlex = styled.div`
    height: 100%;
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
`

/** 桌面左栏内层：固定自然宽度，不随外层动画重排（裁剪而非挤压）。 */
const LeftClipInner = styled.div<{ $width: number }>`
    width: ${p => p.$width}px;
    height: 100%;
`

/** 桌面右栏外层：width 动画 + 裁剪（与 AppSidebar 同款）。拖动时禁用过渡以跟手。 */
const RightClipOuter = styled.div<{ $width: string; $dragging: boolean }>`
    height: 100%;
    width: ${p => p.$width};
    flex-shrink: 0;
    overflow: hidden;
    transition: ${p => (p.$dragging ? 'none' : `width ${DURATION} ${EASING}`)};
`

/** 桌面右栏内层：固定自然宽度，不随外层动画重排。 */
const RightClipInner = styled.div<{ $width: number; $visible: boolean }>`
    width: ${p => p.$width}px;
    height: 100%;
    opacity: ${p => (p.$visible ? 1 : 0)};
    pointer-events: ${p => (p.$visible ? 'auto' : 'none')};
    transition: opacity 0.2s ease;
`

/**
 * 可拖拽分隔条（仅桌面 + 展开 + 未最大化时显示）。
 * 命中区域 8px 宽松好抓，可见分割线 2px（伪元素居中）。
 */
const Divider = styled.div`
    position: relative;
    width: 8px;
    height: 100%;
    flex-shrink: 0;
    cursor: col-resize;

    /* 可见分割线 */
    &::before {
        content: '';
        position: absolute;
        top: 0;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 2px;
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
    secondaryMaximized,
    onExpandedChange,
    onSplitRatioChange,
    leftMinRatio = DEFAULT_LEFT_MIN_RATIO,
    defaultSplitRatio = 0.5,
}: SplitLayoutProps) {
    const isMobile = useIsMobile()
    const containerRef = useRef<HTMLDivElement>(null)
    const [containerWidth, setContainerWidth] = useState(0)
    const [dragging, setDragging] = useState(false)

    // 测量容器宽度（内层固定宽度需要）
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
                // 拖到收起：重置占比为默认值，避免再次展开时右侧过窄
                onExpandedChange(false)
                onSplitRatioChange(defaultSplitRatio)
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
    }, [leftMinRatio, defaultSplitRatio, onExpandedChange, onSplitRatioChange])

    if (isMobile) {
        // 移动端不支持最大化，仅展开/收起切换
        return (
            <MobileContainer ref={containerRef}>
                {/* 收起：左侧全屏；展开：左侧向左滑出 */}
                <MobilePane $tx={expanded ? '-100%' : '0'}>{left}</MobilePane>
                {/* 收起：右侧在屏外右侧；展开：滑入全屏 */}
                <MobilePane $tx={expanded ? '0' : '100%'}>{right}</MobilePane>
            </MobileContainer>
        )
    }

    // 右栏可见：展开或最大化（最大化隐含展开）
    const rightVisible = expanded || secondaryMaximized
    // 右栏外层宽度占比
    const rightFraction = secondaryMaximized ? 1 : 1 - splitRatio
    // 左栏内层自然宽度：展开（含最大化）时按 splitRatio，收起时占满
    const leftInnerPx = expanded ? Math.max(0, splitRatio * containerWidth) : containerWidth
    // 右栏内层自然宽度：最大化时占满，否则按 1-splitRatio（收起时也保持此宽度以被裁剪）
    const rightInnerPx = secondaryMaximized
        ? containerWidth
        : Math.max(0, (1 - splitRatio) * containerWidth)
    const showDivider = expanded && !secondaryMaximized

    return (
        <div ref={containerRef} style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
            <LeftFlex>
                <LeftClipInner $width={leftInnerPx}>{left}</LeftClipInner>
            </LeftFlex>
            {showDivider && (
                <Divider
                    onPointerDown={handleDividerPointerDown}
                    role="separator"
                    aria-orientation="vertical"
                />
            )}
            <RightClipOuter
                $width={rightVisible ? `${rightFraction * 100}%` : '0'}
                $dragging={dragging}
            >
                <RightClipInner $width={rightInnerPx} $visible={rightVisible}>
                    {right}
                </RightClipInner>
            </RightClipOuter>
        </div>
    )
}
