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

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import styled from '@emotion/styled'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { computeSplitRatio, shouldCollapseOnDrag } from './workspaceSplitterUtils'

export interface WorkspaceSplitterProps {
    sessionId: string
    left: ReactNode
    right: ReactNode
}

// 与 AppSidebar 一致的动画时长/缓动
const DURATION = '0.3s'
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'

/**
 * 桌面左栏：flex 自适应。
 * 聊天内容随宽度变化重排（文字重排可接受）；收起检视面板时左栏只是变宽，无挤压感。
 */
const LeftFlex = styled.div`
    height: 100%;
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
`

/**
 * 桌面右栏外层：负责 width 动画 + 裁剪（与 AppSidebar 同款）。
 * 收起时 width 过渡到 0，内层内容不被挤压只被裁剪。
 */
const RightClipOuter = styled.div<{ $width: string }>`
    height: 100%;
    width: ${p => p.$width};
    flex-shrink: 0;
    overflow: hidden;
    transition: width ${DURATION} ${EASING};
`

/**
 * 桌面右栏内层：固定宽度（展开时的真实宽度），不随外层动画重排。
 * 内容按真实宽度布局，外层收起时仅裁剪；opacity 过渡增强丝滑感。
 */
const RightClipInner = styled.div<{ $width: number; $visible: boolean }>`
    width: ${p => p.$width}px;
    height: 100%;
    opacity: ${p => (p.$visible ? 1 : 0)};
    pointer-events: ${p => (p.$visible ? 'auto' : 'none')};
    transition: opacity 0.2s ease;
`

/**
 * 可拖拽分隔条（仅桌面 + 展开时显示）。
 */
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

/**
 * 移动端容器：两栏绝对定位全尺寸，靠 transform 平移切换。
 * 全尺寸 → 零宽度变化 → 零重排零挤压；GPU 加速滑动。
 */
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

/**
 * 工作区分栏布局。
 *
 * 桌面：左栏 flex 自适应 + 可拖拽分隔条 + 右栏"外层 width 动画 / 内层固定裁剪"
 *      （复刻 AppSidebar 的丝滑感，避免内容被挤压）。
 * 移动：两栏全尺寸 transform 平移滑动，非左即右，无挤压。
 *
 * 状态（expanded / splitRatio / activeTab）按 session 键控存于 workspaceStore。
 */
export function WorkspaceSplitter({ sessionId, left, right }: WorkspaceSplitterProps) {
    const isMobile = useIsMobile()
    const expanded = useWorkspaceStore((s) => s.getSession(sessionId).expanded)
    const splitRatio = useWorkspaceStore((s) => s.getSession(sessionId).splitRatio)
    const setExpanded = useWorkspaceStore((s) => s.setExpanded)
    const setSplitRatio = useWorkspaceStore((s) => s.setSplitRatio)

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
            const ratio = computeSplitRatio(ev.clientX, rect.left, rect.width)
            if (shouldCollapseOnDrag(ratio)) {
                setExpanded(sessionId, false)
            } else {
                setExpanded(sessionId, true)
                setSplitRatio(sessionId, ratio)
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
    }, [sessionId, setExpanded, setSplitRatio])

    if (isMobile) {
        return (
            <MobileContainer ref={containerRef}>
                {/* 收起：聊天全屏；展开：聊天向左滑出 */}
                <MobilePane $tx={expanded ? '-100%' : '0'}>{left}</MobilePane>
                {/* 收起：检视面板在屏外右侧；展开：滑入全屏 */}
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
