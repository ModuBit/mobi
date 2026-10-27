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
 * morph-surface —— 触发器 pill 原地长成面板的形变容器。
 *
 * 与 morph-select 同源几何配方（同一套 spring 调速与水平钳制）：收起态是 pill 的大小，
 * 展开态是面板的实测宽高，两端之间只做一份表面的宽/高/圆角形变，内容在末尾淡入。
 * 刻意不复用 MorphSelect —— 那件的列表语义（listbox 键盘模型、选项滚动、激活高亮）
 * 对面板全是噪音，而面板也不该假装自己是一个 combobox。
 *
 * 两条必须守住的约束：
 * - **展开面走 portal**：pill 在 composer 工具条里，而工具条挂在 `ant-sender`（z-index 1）
 *   下面，内联表面会被 composer 上方的行（工作区选择器 z-index 2）压住穿模。portal 到 body、
 *   fixed 锚在 pill 的实测矩形上，跨层叠上下文才是稳的；pill 本体留在原地不动。
 * - 根节点带 `data-open`：composer 工具条靠这个属性撤掉横向裁切（与 morph-select 同一约定）。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { CLOSE_SETTLE_MS, GROW, NARROW, SHRINK } from '@/ui/base/interactive/morph-select/morphTiming'
import styles from './morph-surface.module.css'

/** 面板与视窗边缘的最小留白（水平钳制边界），与 morph-select 一致 */
const EDGE_MARGIN = 12
/** 展开态圆角（面板语言；与 morph-select 的 OPEN_RADIUS 同值） */
const OPEN_RADIUS = 22

export interface MorphSurfaceProps {
    /** 展开面的可访问名（role="dialog"） */
    label: string
    /** 展开宽（px）：实际宽取 min(该值, 视口 - 2×边距) */
    width: number
    /** 窄屏满宽：忽略 width，展开宽直接顶到视口上限（移动端面板形态） */
    fullWidth?: boolean
    open: boolean
    onOpenChange: (open: boolean) => void
    /** 收起态渲染：调用方自管 pill 的样式与 a11y，开合状态由组件回传 */
    trigger: (state: { open: boolean; toggle: () => void }) => ReactNode
    /** 展开态面板内容（只在展开期间挂载，收起后卸载） */
    content: ReactNode
    disabled?: boolean
}

/** 读宽：getBoundingClientRect 带亚像素，offsetWidth 取整；差半像素内向上取整，避免标签被压出省略号 */
function readWidth(el: HTMLElement): number {
    const rect = el.getBoundingClientRect().width
    const offset = el.offsetWidth
    return Math.abs(rect - offset) <= 0.5 ? Math.ceil(rect - 0.01) : offset + 1
}

export function MorphSurface({ label, width, fullWidth = false, open, onOpenChange, trigger, content, disabled = false }: MorphSurfaceProps) {
    const reduced = useReducedMotion() ?? false
    const rootRef = useRef<HTMLDivElement>(null)
    const pillRef = useRef<HTMLDivElement>(null)
    const faceRef = useRef<HTMLDivElement>(null)

    /** 展开面是否挂载（收起动画播完才卸载，否则 pill 会先"跳"回去） */
    const [mounted, setMounted] = useState(false)
    /** 内容层是否已展开（控制表面材质与内容淡入） */
    const [expanded, setExpanded] = useState(false)
    /** portal 表面的定位（fixed 锚在 pill 实测矩形上，底部对齐） */
    const [anchor, setAnchor] = useState({ left: 0, bottom: 0 })

    const shapeW = useMotionValue<number | string>('100%')
    const shapeH = useMotionValue<number | string>('100%')
    const radius = useMotionValue(OPEN_RADIUS)
    const reducedRef = useRef(reduced)
    useLayoutEffect(() => { reducedRef.current = reduced }, [reduced])

    /** 展开宽：调用方给的基准宽（满宽档直接顶到视口），超出视口时收窄 */
    const panelWidth = useCallback(() => {
        if (typeof window === 'undefined') return width
        const available = window.innerWidth - EDGE_MARGIN * 2
        return Math.max(0, fullWidth ? available : Math.min(width, available))
    }, [fullWidth, width])

    /** pill 的实测几何 + 钳制后的展开左缘；返回 null 表示尚未挂载 */
    const measurePill = useCallback(() => {
        const pill = pillRef.current
        if (!pill || typeof window === 'undefined') return null
        const rect = pill.getBoundingClientRect()
        const panelW = panelWidth()
        const left = Math.max(EDGE_MARGIN, Math.min(rect.left, window.innerWidth - EDGE_MARGIN - panelW))
        return {
            left,
            bottom: window.innerHeight - rect.bottom,
            triggerW: readWidth(pill),
            triggerH: rect.height || pill.offsetHeight,
            panelW,
        }
    }, [panelWidth])

    useEffect(() => {
        if (open) setMounted(true)
    }, [open])

    // 展开：先把表面压到 pill 尺寸，下一帧再量面板并长过去（面板只在展开期挂载，量在前一帧会量不到）
    useLayoutEffect(() => {
        if (!mounted || !open) return
        const geo = measurePill()
        if (!geo) return
        setAnchor({ left: geo.left, bottom: geo.bottom })
        shapeW.jump(geo.triggerW)
        shapeH.jump(geo.triggerH)
        radius.jump(geo.triggerH / 2)
        // 内容层与表面同时展开（首帧仍是 pill 尺寸，但内容淡入有延迟，长起来才看得见）；
        // 几何的测量与弹簧放到下一帧——面板刚挂载，这一帧量不到真尺寸
        setExpanded(true)
        const frame = requestAnimationFrame(() => {
            const face = faceRef.current
            if (!face) return
            // 宽以面板为准，不以 pill 为准：pill 比面板宽时（长模型名）取两者的 max 会让
            // 表面长出内容之外，右侧空出一条背景（2026-10-27 真机）。面板宽是调用方给的定值，
            // face 的实测只作兜底（首帧未量到时退回 panelW）。
            const target = { w: face.offsetWidth || geo.panelW, h: face.offsetHeight }
            if (reducedRef.current) {
                shapeW.jump(target.w)
                shapeH.jump(target.h)
                radius.jump(OPEN_RADIUS)
                return
            }
            animate(shapeW, target.w, GROW)
            animate(shapeH, target.h, GROW)
            animate(radius, OPEN_RADIUS, GROW)
        })
        return () => cancelAnimationFrame(frame)
    }, [mounted, open, measurePill, radius, shapeH, shapeW])

    // 收起：表面缩回 pill，动画播完再卸载
    useEffect(() => {
        if (open || !mounted) return
        const geo = measurePill()
        setExpanded(false)
        if (geo) {
            const settle = reducedRef.current ? { duration: 0 } : undefined
            animate(shapeW, geo.triggerW, settle ?? NARROW)
            animate(shapeH, geo.triggerH, settle ?? SHRINK)
            animate(radius, geo.triggerH / 2, settle ?? SHRINK)
        }
        const timer = window.setTimeout(() => setMounted(false), reducedRef.current ? 0 : CLOSE_SETTLE_MS)
        return () => window.clearTimeout(timer)
    }, [mounted, open, measurePill, radius, shapeH, shapeW])

    // 打开期间跟随 pill 的真位置（composer 换行、软键盘、窗口缩放都会挪它）
    useEffect(() => {
        if (!open) return
        const sync = () => {
            const geo = measurePill()
            if (geo) setAnchor({ left: geo.left, bottom: geo.bottom })
        }
        window.addEventListener('resize', sync)
        window.addEventListener('scroll', sync, true)
        return () => {
            window.removeEventListener('resize', sync)
            window.removeEventListener('scroll', sync, true)
        }
    }, [open, measurePill])

    const close = useCallback(() => {
        if (!disabled) onOpenChange(false)
    }, [disabled, onOpenChange])

    // 点外面 / Esc 收起（不是模态：不锁页面，只收起自己）
    useEffect(() => {
        if (!open) return
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Node
            if (rootRef.current?.contains(target)) return
            if (faceRef.current?.parentElement?.contains(target)) return
            close()
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            close()
            pillRef.current?.querySelector('button')?.focus({ preventScroll: true })
        }
        document.addEventListener('pointerdown', onPointerDown)
        document.addEventListener('keydown', onKeyDown)
        return () => {
            document.removeEventListener('pointerdown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown)
        }
    }, [close, open])

    const toggle = useCallback(() => {
        if (!disabled) onOpenChange(!open)
    }, [disabled, onOpenChange, open])

    return (
        <>
            <div ref={rootRef} className={styles.root} data-open={open || undefined} data-disabled={disabled || undefined}>
                <div ref={pillRef} className={styles.pill}>
                    {trigger({ open, toggle })}
                </div>
            </div>
            {mounted && typeof document !== 'undefined' && createPortal(
                <motion.div
                    className={styles.surface}
                    data-expanded={expanded || undefined}
                    style={{ width: shapeW, height: shapeH, borderRadius: radius, left: anchor.left, bottom: anchor.bottom }}
                >
                    <div
                        ref={faceRef}
                        className={styles.face}
                        style={{ width: panelWidth() }}
                        role="dialog"
                        aria-label={label}
                        aria-hidden={!expanded || undefined}
                        inert={!expanded || undefined}
                    >
                        {content}
                    </div>
                </motion.div>,
                document.body,
            )}
        </>
    )
}

export default MorphSurface
