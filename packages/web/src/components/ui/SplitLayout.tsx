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

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import styled from '@emotion/styled'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { computeSplitRatio, shouldCollapseOnDrag, DEFAULT_LEFT_MIN_RATIO } from './splitLayoutUtils'
import { CLIP_DURATION, CLIP_EASING } from './clipConstants'
import { pushHistoryGuard } from '@/core/lib/drawerHistoryGuard'

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

/** 桌面左栏内层：宽度随展开/折叠过渡（与右栏外层 width 动画同步），内容平滑重排而非瞬跳；拖动时禁过渡跟手。 */
const LeftClipInner = styled.div<{ $width: number; $dragging: boolean }>`
    width: ${p => p.$width}px;
    height: 100%;
    transition: ${p => (p.$dragging ? 'none' : `width ${CLIP_DURATION} ${CLIP_EASING}`)};
`

// 桌面右栏外层：width 动画 + 裁剪（与 AppSidebar 同款）。拖动时禁用过渡以跟手。
const RightClipOuter = styled.div<{ $width: string; $dragging: boolean }>`
    height: 100%;
    width: ${p => p.$width};
    flex-shrink: 0;
    overflow: hidden;
    transition: ${p => (p.$dragging ? 'none' : `width ${CLIP_DURATION} ${CLIP_EASING}`)};
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
    transition: transform ${CLIP_DURATION} ${CLIP_EASING};
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
    /** 进行中拖拽的清理句柄；卸载兜底用，避免 window 监听泄漏 */
    const dragRef = useRef<{ teardown: () => void } | null>(null)

    // 测量容器宽度（内层固定宽度需要）。用 useLayoutEffect 在首绘前同步测量，
    // 避免 containerWidth 初值 0 导致首帧内层 0 宽闪现 / xterm 以 0 列初始化。
    useLayoutEffect(() => {
        if (isMobile) return
        const el = containerRef.current
        if (!el) return
        const update = () => setContainerWidth(el.clientWidth)
        update()
        const ro = new ResizeObserver(update)
        ro.observe(el)
        return () => ro.disconnect()
    }, [isMobile])

    // 拖拽分隔条：pointer 事件统一处理鼠标/触摸/触控笔。
    // rAF 节流：一帧最多落一次 store，避免逐像素 setState 造成 sessions Map 反复拷贝 + 整工作区重渲染。
    const handleDividerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault()
        const el = containerRef.current
        if (!el) return
        const target = e.currentTarget
        try {
            target.setPointerCapture(e.pointerId)
        } catch {
            // 某些环境不支持 pointer capture，忽略
        }
        // 若上一次拖拽未正常结束（如中途卸载），先清理避免监听叠加
        dragRef.current?.teardown()
        setDragging(true)

        let pendingX: number | null = null
        let raf: number | null = null
        const flush = () => {
            raf = null
            if (pendingX == null) return
            const x = pendingX
            pendingX = null
            const rect = el.getBoundingClientRect()
            const ratio = computeSplitRatio(x, rect.left, rect.width, leftMinRatio)
            if (shouldCollapseOnDrag(ratio)) {
                // 拖到收起：重置占比为默认值，避免再次展开时右侧过窄
                onExpandedChange(false)
                onSplitRatioChange(defaultSplitRatio)
            } else {
                onExpandedChange(true)
                onSplitRatioChange(ratio)
            }
        }
        const handleMove = (ev: PointerEvent) => {
            pendingX = ev.clientX
            if (raf == null) raf = requestAnimationFrame(flush)
        }
        const teardown = () => {
            if (raf != null) cancelAnimationFrame(raf)
            raf = null
            window.removeEventListener('pointermove', handleMove)
            window.removeEventListener('pointerup', handleUp)
        }
        const handleUp = (ev: PointerEvent) => {
            try {
                target.releasePointerCapture(ev.pointerId)
            } catch {
                // 拖到收起会卸载 Divider（showDivider 变 false），capture 目标已脱离 DOM，释放可忽略
            }
            teardown()
            dragRef.current = null
            setDragging(false)
        }
        window.addEventListener('pointermove', handleMove)
        window.addEventListener('pointerup', handleUp)
        dragRef.current = { teardown }
    }, [leftMinRatio, defaultSplitRatio, onExpandedChange, onSplitRatioChange])

    // 卸载兜底：拖拽进行中组件被卸载（路由切走/会话删除）时清理 window 监听与未完成 rAF
    useEffect(() => {
        return () => {
            dragRef.current?.teardown()
            dragRef.current = null
        }
    }, [])

    // onExpandedChange 用 ref 持有，避免父组件内联箭头每次渲染产生新引用导致 effect 重跑
    const onExpandedChangeRef = useRef(onExpandedChange)
    onExpandedChangeRef.current = onExpandedChange

    // 移动端：右侧面板（InspectorPane）展开时占满全屏，此时全屏手势返回应「收起面板」
    // 而非穿透退路由退出 session detail。expanded 时推 history 哨兵，手势返回消费哨兵 → 收起。
    useEffect(() => {
        if (!isMobile || !expanded) return
        const dispose = pushHistoryGuard(() => onExpandedChangeRef.current?.(false))
        return dispose
    }, [isMobile, expanded])

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
                <LeftClipInner $width={leftInnerPx} $dragging={dragging}>{left}</LeftClipInner>
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
