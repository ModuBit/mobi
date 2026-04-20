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
 * 通用溢出检测容器
 * 固定 maxHeight，内容超出时显示渐变遮罩 + 可选"查看更多"按钮
 */

import { useEffect, useRef, useState, memo, type CSSProperties, type ReactNode } from 'react'
import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'

interface OverflowContainerProps {
    /** 容器最大高度（px） */
    maxHeight: number
    /** 子内容 */
    children: ReactNode
    /** 渐变遮罩高度，默认 48 */
    gradientHeight?: number
    /** 点击"查看更多"回调，不传则不显示按钮 */
    onClickExpand?: () => void
    /** 溢出状态变更回调 */
    onOverflowChange?: (overflowing: boolean) => void
    /** 额外样式 */
    style?: CSSProperties
    /** 额外 class */
    className?: string
}

function OverflowContainerInner({
    maxHeight,
    children,
    gradientHeight = 48,
    onClickExpand,
    onOverflowChange,
    style,
    className,
}: OverflowContainerProps) {
    const { t } = useTranslation()
    const { token } = antTheme.useToken()
    const contentRef = useRef<HTMLDivElement>(null)
    const [isOverflowing, setIsOverflowing] = useState(false)

    // 缓存回调引用，避免 useEffect 频繁重建
    const onOverflowChangeRef = useRef(onOverflowChange)
    onOverflowChangeRef.current = onOverflowChange

    // ResizeObserver 只需挂载一次，由浏览器自动监听尺寸变化
    useEffect(() => {
        const el = contentRef.current
        if (!el) return

        const update = () => {
            const overflowing = el.scrollHeight > el.clientHeight
            setIsOverflowing(prev => {
                if (prev !== overflowing) {
                    onOverflowChangeRef.current?.(overflowing)
                }
                return overflowing
            })
        }

        const observer = new ResizeObserver(update)
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    return (
        <div className={className} style={{ position: 'relative', maxHeight, overflow: 'hidden', ...style }} ref={contentRef}>
            {children}
            {isOverflowing && (
                <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: gradientHeight,
                    background: `linear-gradient(transparent, ${token.colorBgContainer})`,
                    pointerEvents: 'none',
                }} />
            )}
            {isOverflowing && onClickExpand && (
                <div
                    onClick={(e) => { e.stopPropagation(); onClickExpand() }}
                    style={{
                        position: 'absolute',
                        bottom: -1,
                        left: 0,
                        right: 0,
                        textAlign: 'center',
                        padding: '8px 12px 4px',
                        color: token.colorPrimary,
                        fontSize: 12,
                        cursor: 'pointer',
                        background: `linear-gradient(transparent, ${token.colorBgContainer} 40%)`,
                    }}
                >
                    {t('chat.tool.viewDetail')} →
                </div>
            )}
        </div>
    )
}

export const OverflowContainer = memo(OverflowContainerInner)
