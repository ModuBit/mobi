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
 * 移动端底部抽屉组件
 * 统一行为：最大高度 85dvh、header 下拉手势关闭
 */

import { useRef, useCallback, useState, useLayoutEffect, useEffect } from 'react'
import { Drawer, type DrawerProps } from 'antd'
import { Global, css } from '@emotion/react'
import styled from '@emotion/styled'

/** 下拉关闭阈值（px） */
const SWIPE_THRESHOLD = 60

/** 手势关闭时禁用 antd 动画的 class */
const SWIPE_CLOSING_CLASS = 'mobile-drawer-swipe-closing'

/** 禁用 antd Drawer 关闭动画，并锁定滑出位 */
const swipeClosingStyles = css`
    /* 精确匹配当前 drawer 自身的 content-wrapper（antd DOM: root > drawer > wrapper），
       避免嵌套 drawer 时外层 swipeClosing 连带锁住内层 wrapper（#11） */
    .${SWIPE_CLOSING_CLASS} > .ant-drawer > .ant-drawer-content-wrapper {
        transition: none !important;
        /* 关键：onClose 后 antd motion-leave 会清除 inline transform、把 content-wrapper
           重置回原位（translateY(0)），导致拖拽关闭时 drawer 从滑出位闪回原位再消失。
           用 !important 锁定 translateY(100%)，覆盖 antd 的 inline transform，保持滑出位 */
        transform: translateY(100%) !important;
    }
`

/** 拖拽指示条 */
const DragHandle = styled.div`
    width: 36px;
    height: 4px;
    border-radius: 2px;
    background: var(--ant-color-text-quaternary);
    margin: 0 auto;
`

/**
 * 可拖拽的 header 区域
 * 占满整个 header 宽度，touch-action: none 阻止浏览器默认滚动
 */
const DraggableArea = styled.div`
    touch-action: none;
    user-select: none;
    cursor: grab;
    padding: 12px 16px 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-bottom: 1px solid var(--ant-color-border-secondary);

    &:active {
        cursor: grabbing;
    }
`

const TitleRow = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 22px;
    font-weight: 500;
    font-size: 16px;
`

export interface MobileDrawerProps extends Omit<DrawerProps, 'placement' | 'width' | 'height'> {
    /** 最大高度，默认 85dvh */
    maxHeight?: string
    /** 是否展示拖拽指示条，默认 true */
    showDragHandle?: boolean
}

/**
 * 移动端底部 Drawer
 * - 从底部弹出，最大高度 85dvh
 * - header 区域支持下拉手势关闭（跟手 + 阈值判定）
 * - 顶部拖拽指示条提示可拖拽
 */
export function MobileDrawer({
    open,
    onClose,
    title,
    extra,
    maxHeight = '85dvh',
    showDragHandle = true,
    styles: propStyles,
    rootClassName,
    children,
    closable: _closable,
    ...rest
}: MobileDrawerProps) {
    const startYRef = useRef<number | null>(null)
    const deltaYRef = useRef(0)
    const draggableRef = useRef<HTMLDivElement>(null)
    // 手势关闭中：禁用 antd 动画，自行控制 translateY 滑出
    const [swipeClosing, setSwipeClosing] = useState(false)

    const getContentWrapper = useCallback((): HTMLElement | null => {
        return draggableRef.current?.closest('.ant-drawer-content-wrapper') as HTMLElement | null
    }, [])

    // 滑出动画进行中标记。配合下方 useLayoutEffect，每次渲染重新应用 translateY(100%)，
    // 防止父组件 re-render（如 session 详情页 SSE 消息流）触发 antd Drawer 重置
    // content-wrapper 的 transform，导致 drawer 弹回原位再消失的闪动
    const [isClosing, setIsClosing] = useState(false)

    // 收集手势关闭过程中的所有定时器/rAF，卸载或重开时统一清理（#9）
    const timersRef = useRef<{ timeouts: number[]; raf: number | null }>({ timeouts: [], raf: null })
    const clearTimers = useCallback(() => {
        timersRef.current.timeouts.forEach(id => clearTimeout(id))
        if (timersRef.current.raf != null) cancelAnimationFrame(timersRef.current.raf)
        timersRef.current = { timeouts: [], raf: null }
    }, [])

    // 卸载时清理残留定时器，避免在已卸载组件上 setState（#9）
    useEffect(() => {
        return () => clearTimers()
    }, [clearTimers])

    // 重新打开时复位关闭态，防止快速 close→reopen 期间 isClosing 残留导致 drawer 卡在滑出位（#4）
    useEffect(() => {
        if (open) {
            clearTimers()
            setIsClosing(false)
            setSwipeClosing(false)
        }
    }, [open, clearTimers])

    useLayoutEffect(() => {
        if (!isClosing) return
        const wrapper = getContentWrapper()
        if (!wrapper) return
        wrapper.style.transition = 'transform 0.2s ease'
        wrapper.style.transform = 'translateY(100%)'
    })

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        startYRef.current = e.touches[0].clientY
        deltaYRef.current = 0
    }, [])

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (startYRef.current === null) return
        const currentY = e.touches[0].clientY
        deltaYRef.current = currentY - startYRef.current

        // 只响应向下拖动
        if (deltaYRef.current > 0) {
            const wrapper = getContentWrapper()
            if (wrapper) {
                wrapper.style.transition = 'none'
                wrapper.style.transform = `translateY(${deltaYRef.current}px)`
            }
        }
    }, [getContentWrapper])

    const handleTouchEnd = useCallback(() => {
        // 新手势开始，取消前一次未完成的动画定时器，防止回弹与滑出竞态（#10）
        clearTimers()
        const wrapper = getContentWrapper()
        if (wrapper) {
            if (deltaYRef.current > SWIPE_THRESHOLD) {
                // 超过阈值：触发滑出动画（isClosing + useLayoutEffect 控制 transform）
                setIsClosing(true)
                // 动画完成后：禁用 antd 关闭动画 + 触发关闭
                const t1 = window.setTimeout(() => {
                    setSwipeClosing(true)
                    // 等 class 生效后再调 onClose
                    const raf = requestAnimationFrame(() => {
                        // 手势关闭无真实事件，antd onClose 回调不读 e 字段，传空 MouseEvent 触发关闭
                        onClose?.({} as React.MouseEvent)
                        // 等 antd motion-leave 完成（~300ms）再清理状态。期间 swipeClosing CSS
                        // 用 !important 锁定 transform translateY(100%)，防止 motion-leave 重置回原位闪动
                        const t2 = window.setTimeout(() => {
                            setSwipeClosing(false)
                            setIsClosing(false)
                            // 清除 inline transform/transition（此时 content 已 hidden，清除不影响视觉），
                            // 避免残留 translateY(100%) 导致下次打开 drawer 时内容仍在滑出位（只见 mask 不见 drawer）
                            const w = getContentWrapper()
                            if (w) {
                                w.style.transform = ''
                                w.style.transition = ''
                            }
                        }, 350)
                        timersRef.current.timeouts.push(t2)
                    })
                    timersRef.current.raf = raf
                }, 200)
                timersRef.current.timeouts.push(t1)
            } else {
                // 未超过阈值，弹回原位
                wrapper.style.transition = 'transform 0.2s ease'
                wrapper.style.transform = ''
                const t = window.setTimeout(() => {
                    wrapper.style.transition = ''
                }, 200)
                timersRef.current.timeouts.push(t)
            }
        }
        startYRef.current = null
        deltaYRef.current = 0
    }, [onClose, getContentWrapper, clearTimers])

    // 合并 wrapper styles（antd 5.x 运行时支持 styles.wrapper，类型为 stylesAndFn 联合，
    // 这里仅处理对象式配置，函数式由 antd 内部消费）
    const userStyles = typeof propStyles === 'object' ? propStyles : undefined
    const mergedStyles = {
        ...propStyles,
        wrapper: {
            height: 'auto',
            maxHeight,
            ...userStyles?.wrapper,
        },
        body: {
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            ...userStyles?.body,
        },
    } as DrawerProps['styles']

    // 手势关闭时追加特殊 class 禁用 antd 动画
    const finalRootClassName = [rootClassName, swipeClosing ? SWIPE_CLOSING_CLASS : '']
        .filter(Boolean).join(' ') || undefined

    return (
        <>
            <Global styles={swipeClosingStyles} />
            <Drawer
                open={open}
                onClose={onClose}
                placement="bottom"
                title={null}
                closable={false}
                styles={mergedStyles}
                rootClassName={finalRootClassName}
                {...rest}
            >
                {/* 自定义 header：拖拽区域 */}
                <DraggableArea
                    ref={draggableRef}
                    onTouchStart={handleTouchStart}
                    onTouchMove={handleTouchMove}
                    onTouchEnd={handleTouchEnd}
                >
                    {showDragHandle && <DragHandle />}
                    {(title || extra) && (
                        <TitleRow>
                            <span>{title}</span>
                            {extra && <span>{extra}</span>}
                        </TitleRow>
                    )}
                </DraggableArea>

                {/* 内容区域 */}
                <div style={{ flex: 1, overflow: 'auto' }}>
                    {children}
                </div>
            </Drawer>
        </>
    )
}
