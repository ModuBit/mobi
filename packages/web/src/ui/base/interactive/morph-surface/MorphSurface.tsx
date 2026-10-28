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
 * 与 morph-select 同源几何配方（同一套 spring 调速与水平钳制），但**表面归属不同**：
 * morph-select 的 pill 是展开面的 lid（下沿那一条），morph-surface 的面板同样把 pill
 * 当作自己的 lid——展开面 = 底部 pill 行 + 上方面板，一份表面、一条轮廓。早先的版本把
 * pill 留在工具条、面板另外浮一张卡，收起时两张面各走各的，真机读起来就是「弹的和
 * 底部是两件事」（2026-10-28 用户反馈）。现在 pill 在展开期间隐藏，表面里的 lid 承接
 * 它的外观与点击，收起缩回 pill 尺寸后才交还给文档流里的 pill。
 *
 * 两条必须守住的约束：
 * - **展开面走 portal**：pill 在 composer 工具条里，内联表面会被工具条的 clip-path 与
 *   上方行的层叠压住；portal 到 body、fixed 锚在 pill 的实测矩形上，跨层叠上下文才是稳的。
 *   锚点跟随 pill 的真位置（换行 / 软键盘 / 滚动）。
 * - **内容在长完之后才淡入**：面板内容挂在 lid 之上，形变途中它与表面不同高，提前显形
 *   会浮在表面外面。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { animate, motion, useMotionValue } from 'motion/react'
import { CLOSE_SETTLE_MS, GROW, NARROW, SHRINK, WIDTH } from '@/ui/base/interactive/morph-select/morphTiming'
import { EDGE_MARGIN, OPEN_RADIUS, measureTriggerWidth, useReducedFlag } from '@/ui/base/interactive/morph-select/morphGeometry'
import styles from './morph-surface.module.css'

export interface MorphSurfaceProps {
    /** 展开面的可访问名（role="dialog"） */
    label: string
    /** 展开宽（px）：实际宽取 min(该值, 视口 - 2×边距) */
    width: number
    /** 窄屏满宽：忽略 width，展开宽直接顶到视口上限（移动端面板形态） */
    fullWidth?: boolean
    open: boolean
    onOpenChange: (open: boolean) => void
    /**
     * 收起态 pill 的内容（**不是** button）：按钮壳与 pill 外观由本组件持有，
     * 展开后面板底部那一条 lid 渲染同一份内容，所以两处恒等。
     */
    trigger: (state: { open: boolean; toggle: () => void }) => ReactNode
    /** 展开态面板内容（只在展开期间挂载，收起后卸载） */
    content: ReactNode
    disabled?: boolean
    /** 收起态 pill 宽带上限（px）：长文本由调用方内容自行截断，不撑开工具条 */
    maxPillWidth?: number
}

export function MorphSurface({ label, width, fullWidth = false, open, onOpenChange, trigger, content, disabled = false, maxPillWidth }: MorphSurfaceProps) {
    const reduced = useReducedFlag()
    const rootRef = useRef<HTMLDivElement>(null)
    const pillRef = useRef<HTMLButtonElement>(null)
    const faceRef = useRef<HTMLDivElement>(null)

    /** 展开面是否挂载（收起动画播完才卸载，否则 pill 会先"跳"回去） */
    const [mounted, setMounted] = useState(false)
    /** 面板内容是否已显形（表面长到全尺寸后才淡入） */
    const [expanded, setExpanded] = useState(false)
    /** portal 表面的定位与 lid 高（fixed 锚在 pill 实测矩形上，底部对齐） */
    const [anchor, setAnchor] = useState({ bottom: 0, lidH: 36 })

    const shapeW = useMotionValue<number | string>('100%')
    const shapeH = useMotionValue<number | string>('100%')
    /** 左缘独立走 motion value：展开时锚钳制位（面板不回出视窗），收起时回到 pill 的真左缘 */
    const shapeLeft = useMotionValue(0)
    const radius = useMotionValue(OPEN_RADIUS)
    const reducedRef = useRef(reduced)
    useLayoutEffect(() => { reducedRef.current = reduced }, [reduced])
    /** 下一次收起是否直接卸载（外部点击：不播动画，见收起 effect 的注释） */
    const instantClose = useRef(false)

    /** 展开宽：调用方给的基准宽（满宽档直接顶到视口），超出视口时收窄 */
    const panelWidth = useCallback(() => {
        if (typeof window === 'undefined') return width
        const available = window.innerWidth - EDGE_MARGIN * 2
        return Math.max(0, fullWidth ? available : Math.min(width, available))
    }, [fullWidth, width])

    /** pill 的实测几何；`left` 是钳制后的展开左缘，`rawLeft` 是 pill 自己的左缘（收起终点） */
    const measurePill = useCallback(() => {
        const pill = pillRef.current
        if (!pill || typeof window === 'undefined') return null
        const rect = pill.getBoundingClientRect()
        const panelW = panelWidth()
        const left = Math.max(EDGE_MARGIN, Math.min(rect.left, window.innerWidth - EDGE_MARGIN - panelW))
        return {
            left,
            rawLeft: rect.left,
            bottom: window.innerHeight - rect.bottom,
            triggerW: measureTriggerWidth(pill),
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
        setAnchor({ bottom: geo.bottom, lidH: geo.triggerH })
        // 内容与表面同时展开（首帧仍是 pill 尺寸，内容淡入有 60ms 延迟，长起来才看得见）。
        // 不等长完再显形：面板是可交互的（滑杆 / 下拉），内容晚到等于面板晚到
        setExpanded(true)
        // 起点是 pill 的真左缘：展开面首帧必须**正好压在 pill 上**（宽度也是 pill 宽），
        // 否则会出现「pill 消失、左留白处凭空冒出一小块」的观感
        shapeLeft.jump(geo.rawLeft)
        shapeW.jump(geo.triggerW)
        shapeH.jump(geo.triggerH)
        radius.jump(geo.triggerH / 2)
        let controls: { stop: () => void }[] = []
        // 几何的测量与弹簧放到下一帧——面板刚挂载，这一帧量不到真尺寸
        const frame = requestAnimationFrame(() => {
            const face = faceRef.current
            if (!face) return
            // 宽以面板为准，不以 pill 为准：pill 比面板宽时（长模型名）取两者的 max 会让
            // 表面长出内容之外，右侧空出一条背景（2026-10-27 真机）。面板宽是调用方给的定值，
            // face 的实测只作兜底（首帧未量到时退回 panelW）。
            // 高 = lid（pill 那一条）+ 面板，收起缩回 lid 高——两端的 lid 始终在表面里。
            const target = {
                w: Math.max(face.offsetWidth || geo.panelW, geo.triggerW),
                h: geo.triggerH + face.offsetHeight,
            }
            if (reducedRef.current) {
                shapeW.jump(target.w)
                shapeH.jump(target.h)
                shapeLeft.jump(geo.left)
                radius.jump(OPEN_RADIUS)
                return
            }
            const grown = [
                animate(shapeW, target.w, GROW),
                animate(shapeH, target.h, GROW),
                // 左缘跟宽度同步滑到钳制位（面板不能出视窗），与 MorphSelect 的 shapeX 同一配方
                animate(shapeLeft, geo.left, WIDTH),
                animate(radius, OPEN_RADIUS, GROW),
            ]
            controls = grown
        })
        return () => {
            cancelAnimationFrame(frame)
            for (const control of controls) control.stop()
        }
    }, [mounted, open, measurePill, radius, shapeH, shapeLeft, shapeW])

    // 收起：表面缩回 pill（表面里仍显示 pill），动画播完再卸载、交还文档流里的 pill
    useEffect(() => {
        if (open || !mounted) return
        const geo = measurePill()
        setExpanded(false)
        // 外部点击关闭：不播收起动画，直接卸载。表面是 portal 到 body 的浮层（z = overlay 基线），
        // 而「点外面」最常见的下一拍是打开**另一个**浮层（权限 / output style 的 morph-select 在
        // composer 内的 z-index 只有 30）——缩回去的那 ~500ms 里，逐帧缩小的面板会盖在新开的
        // 列表上面，看起来像「模型的 lid 还压在最上面」（2026-10-28 真机）。收起动画只在点 lid /
        // Esc 这类「留在原地」的关闭里播放
        if (instantClose.current) {
            instantClose.current = false
            if (geo) {
                shapeW.jump(geo.triggerW)
                shapeH.jump(geo.triggerH)
                shapeLeft.jump(geo.rawLeft)
                radius.jump(geo.triggerH / 2)
            }
            setMounted(false)
            return
        }
        if (reducedRef.current || !geo) {
            setMounted(false)
            return
        }
        const shrunk = [
            animate(shapeW, geo.triggerW, NARROW),
            animate(shapeH, geo.triggerH, SHRINK),
            // 左缘同步回到 pill 的真左缘：展开时锚在钳制位（视窗左留白），不跟回来的话
            // 表面会缩在视窗左侧、最后一步再横跳到 pill 上
            animate(shapeLeft, geo.rawLeft, NARROW),
            animate(radius, geo.triggerH / 2, SHRINK),
        ]
        // 卸载时机：弹簧尾巴收敛得比视觉完成晚 ~200ms，等它收敛会让「已经收好了」的面板
        // 继续挂在屏幕上；按预算定时又会在最后几像素横跳一下。取两者之间——到点把几何
        // 对齐到终点再卸载，那一帧不会绘制，交接给文档流里的 pill 时逐像素吻合。
        let cancelled = false
        const timer = window.setTimeout(() => {
            if (cancelled) return
            shapeW.jump(geo.triggerW)
            shapeH.jump(geo.triggerH)
            shapeLeft.jump(geo.rawLeft)
            radius.jump(geo.triggerH / 2)
            setMounted(false)
        }, CLOSE_SETTLE_MS + 80)
        return () => {
            cancelled = true
            window.clearTimeout(timer)
            for (const control of shrunk) control.stop()
        }
    }, [mounted, open, measurePill, radius, shapeH, shapeLeft, shapeW])

    // 打开期间跟随 pill 的真位置（composer 换行、软键盘、窗口缩放、页面滚动都会挪它）。
    // capture 阶段会收到**任何**滚动容器的 scroll——消息列表流式粘底时最频繁，而 pill 大多
    // 根本没动。故同帧合并，且位置没变就返回原 state 让 React 跳过重渲染（否则每次 scroll
    // 都要强制一次布局并重渲染整个面板子树）。
    useEffect(() => {
        if (!open) return
        let frame = 0
        const sync = () => {
            if (frame) return
            frame = requestAnimationFrame(() => {
                frame = 0
                const geo = measurePill()
                if (!geo) return
                shapeLeft.jump(geo.left)
                setAnchor(prev => (prev.bottom === geo.bottom && prev.lidH === geo.triggerH
                    ? prev
                    : { bottom: geo.bottom, lidH: geo.triggerH }))
            })
        }
        window.addEventListener('resize', sync)
        window.addEventListener('scroll', sync, true)
        return () => {
            if (frame) cancelAnimationFrame(frame)
            window.removeEventListener('resize', sync)
            window.removeEventListener('scroll', sync, true)
        }
    }, [open, measurePill, shapeLeft])

    const close = useCallback((instant = false) => {
        if (disabled) return
        if (instant) instantClose.current = true
        onOpenChange(false)
    }, [disabled, onOpenChange])

    // 点外面 / Esc 收起（不是模态：不锁页面，只收起自己）
    useEffect(() => {
        if (!open) return
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Node
            if (rootRef.current?.contains(target)) return
            if (faceRef.current?.parentElement?.contains(target)) return
            // 外部点击的另一头往往是要打开的另一个浮层：不播收起动画，直接让位
            close(true)
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            event.stopPropagation()
            close()
            pillRef.current?.focus({ preventScroll: true })
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

    // 展开期间 pill 从文档流里隐去（占位仍在），焦点落在表面里的 lid 上——否则焦点停在
    // 一个 visibility:hidden 的按钮上，键盘用户直接失去落点。指针打开时不抢焦点：
    // 程序化 focus 会画出焦点环，点在 pill 上却冒出一个框，纯属噪音
    const lidRef = useRef<HTMLButtonElement>(null)
    const pointerOpened = useRef(false)
    useLayoutEffect(() => {
        if (mounted && open && !pointerOpened.current) lidRef.current?.focus({ preventScroll: true })
    }, [mounted, open])

    return (
        <>
            <div ref={rootRef} className={styles.root} data-open={open || undefined} data-mounted={mounted || undefined} data-disabled={disabled || undefined}>
                <button
                    ref={pillRef}
                    type="button"
                    className={styles.pill}
                    aria-label={label}
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    // 展开期间 pill 隐去（占位仍在），交互与可访问性归表面里的 lid：
                    // 两份同名按钮同时暴露会让读屏与测试都拿到两个「模型」
                    aria-hidden={mounted || undefined}
                    tabIndex={mounted ? -1 : undefined}
                    disabled={disabled}
                    onClick={(event) => {
                        // detail > 0 = 指针（含触摸）触发；键盘 Enter/Space 合成的 click 恒为 0
                        pointerOpened.current = event.detail > 0
                        toggle()
                    }}
                    style={maxPillWidth ? { maxWidth: maxPillWidth } : undefined}
                >
                    {trigger({ open, toggle })}
                </button>
            </div>
            {mounted && typeof document !== 'undefined' && createPortal(
                <motion.div
                    className={styles.surface}
                    data-expanded={expanded || undefined}
                    style={{ width: shapeW, height: shapeH, borderRadius: radius, left: shapeLeft, bottom: anchor.bottom }}
                >
                    <div
                        ref={faceRef}
                        className={styles.face}
                        style={{ width: panelWidth(), bottom: anchor.lidH }}
                        role="dialog"
                        aria-label={label}
                        aria-hidden={!expanded || undefined}
                        inert={!expanded || undefined}
                    >
                        {content}
                    </div>
                    <div className={styles.lid} style={{ height: anchor.lidH }}>
                        <button
                            ref={lidRef}
                            type="button"
                            className={styles.lidButton}
                            aria-label={label}
                            aria-haspopup="dialog"
                            aria-expanded={open}
                            onClick={() => close()}
                        >
                            {trigger({ open, toggle })}
                        </button>
                    </div>
                </motion.div>,
                document.body,
            )}
        </>
    )
}

export default MorphSurface
