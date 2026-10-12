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
 * distributed under the License is distributed on an "AS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { memo, useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'

export interface ShinyTextProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
    /** 扫光内容（纯展示，对读屏应视需求另行处理——本组件不代管 aria） */
    children: ReactNode
    /** 扫光激活；false 渲染普通 span（不挂动画类、不做可见性观测，零开销） */
    active?: boolean
    /** 亮面变体（.shimmer-text-solid）：文字本色为基线、白色 glint 掠过——小字号/低对比语境用 */
    solid?: boolean
    /** 追加到扫光层的类（如 CrossfadeText 复用同一元素承载 crossfade-in） */
    className?: string
    style?: CSSProperties
}

/* ===== 视口外暂停（移动端扫光卡顿的第一杠杆） =====
 * sweep 是 background-position 动画 + background-clip:text——逐帧主线程重绘，
 * 长会话里滚出屏幕的运行态行照样在烧绘制预算。ShinyText 用单例
 * IntersectionObserver 标记屏外实例，CSS 侧 [data-shimmer-off] 暂停动画（base.css）。
 * jsdom 无 IntersectionObserver：观测整体跳过，恒可见（测试无感）。 */
const visibilityCallbacks = new WeakMap<Element, (visible: boolean) => void>()
let sharedObserver: IntersectionObserver | null = null

function getSharedObserver(): IntersectionObserver | null {
    if (typeof IntersectionObserver === 'undefined') return null
    if (!sharedObserver) {
        sharedObserver = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                // 回调入参是「是否可见」，取反才是 offscreen——直传会把视口内元素
                // 标记成屏外暂停、动画冻在首帧（crossfade-in opacity:0）致文字隐形
                visibilityCallbacks.get(entry.target)?.(!entry.isIntersecting)
            }
        })
    }
    return sharedObserver
}

/**
 * 扫光（shimmer）的唯一组件入口：所有需要「一道高光周期扫过文字」的地方都用它，
 * 禁止直接挂 .shimmer-text / .shimmer-text-solid 类（动画实现单点仍在 base.css，
 * 本组件收口的是语义与性能闸——视口外自动暂停，见上方说明）。
 *
 * active=false 时渲染普通 span：调用方按运行态切换 active，动画类的挂摘即随其收口。
 */
export const ShinyText = memo(function ShinyText({
    children,
    active = true,
    solid = false,
    className,
    style,
    ...rest
}: ShinyTextProps) {
    const ref = useRef<HTMLSpanElement>(null)
    // 初始假定可见（IO 首次回调即纠正）；屏外时不渲染 data 属性，动画恢复走 CSS 默认
    const [offscreen, setOffscreen] = useState(false)

    useEffect(() => {
        if (!active) return
        const el = ref.current
        const observer = getSharedObserver()
        if (!el || !observer) return
        visibilityCallbacks.set(el, setOffscreen)
        observer.observe(el)
        return () => {
            observer.unobserve(el)
            visibilityCallbacks.delete(el)
        }
    }, [active])

    if (!active) {
        return (
            <span className={className} style={style} {...rest}>
                {children}
            </span>
        )
    }

    return (
        <span
            ref={ref}
            className={solid ? `shimmer-text shimmer-text-solid${className ? ` ${className}` : ''}` : `shimmer-text${className ? ` ${className}` : ''}`}
            data-shimmer-off={offscreen || undefined}
            style={style}
            {...rest}
        >
            {children}
        </span>
    )
})
