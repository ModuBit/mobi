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

/*
 * 快照自管件：uiarc `registry/components/tooltip` 的深度本地化版本
 * （button / popover 先例：进项目即归我们维护，不登记 registry.json）。
 *
 * 本地化点：
 * ① z-index 由上游写死的 90 改为 --mobi-z-overlay（与 shadcn 浮层同基线 1080）
 * ② 阴影 / 底色 / 字号 / 间距 / 圆角全部走 UIARC_ALIAS_VARS 或既有 CSS 变量，
 *    明暗双档自动跟随（上游变量名与本项目同源，无需本地映射块）
 * ③ 增加受控 `open/onOpenChange`、`trigger="manual"`（Radix Anchor，不绑 hover/focus）
 *    与 `sideOffset/collisionPadding/align`——AppTooltip 的触屏长按分流需要完全受控的锚定浮层
 * ④ 上游的「暖窗口」逻辑保留：任一 tooltip 打开期间及关闭后 300ms 内，下一个免延迟、
 *    只做淡入（不位移），鼠标在相邻图标间快速划过时不会反复等 250ms
 *
 * 与 Popover 的分工：Tooltip 只承载「纯文字提示」，无焦点、无交互内容；需要点击 / 悬停
 * 内容交互的浮层仍用 popover/Popover。
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement, ReactNode } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { motionTokens } from '@/ui/base/motion/motionTokens'
import styles from './tooltip.module.css'

export interface TooltipProps {
    /** 提示内容；字符串/数字带内容切换的交叉淡入与尺寸弹簧，其余节点原样渲染 */
    content: ReactNode
    /** 触发元素；ref 直通到 child（不包中间层） */
    children: ReactElement
    /** 浮层方位，默认 top（Radix 碰撞翻转兜底） */
    side?: 'top' | 'bottom' | 'left' | 'right'
    /** 沿方位轴的对齐，默认 center */
    align?: 'start' | 'center' | 'end'
    /** 受控打开态；不传走内部状态 */
    open?: boolean
    onOpenChange?: (open: boolean) => void
    /**
     * 触发方式：
     * - hover（默认）：Radix Trigger 接管鼠标悬停 / 键盘聚焦
     * - manual：Radix Anchor 只锚定不绑事件，打开态完全由 `open` 驱动
     *   （AppTooltip 用它实现 mouse hover + touch long-press 分流）
     */
    trigger?: 'hover' | 'manual'
    /** hover 模式首次打开的延迟（ms），默认 250；暖窗口内自动归零 */
    delayDuration?: number
    sideOffset?: number
    /** 碰撞内边距（px），默认 12 */
    collisionPadding?: number
    className?: string
}

const DELAY = 250
const SKIP_WINDOW = 300

/**
 * 暖窗口是模块级共享状态：每个 Tooltip 自带 Provider，但「刚刚看过提示」的体验要跨实例。
 * 任一打开即变暖；最后一个关闭后 300ms 转冷。
 */
let warm = false
let openCount = 0
let coolTimer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()
const warmth = {
    subscribe(listener: () => void) {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
    },
    get: () => warm,
    set(next: boolean) {
        if (warm === next) return
        warm = next
        listeners.forEach(listener => listener())
    },
    opened() {
        openCount += 1
        if (coolTimer) clearTimeout(coolTimer)
        warmth.set(true)
    },
    closed() {
        openCount = Math.max(0, openCount - 1)
        if (openCount) return
        if (coolTimer) clearTimeout(coolTimer)
        coolTimer = setTimeout(() => warmth.set(false), SKIP_WINDOW)
    },
}

/** 字符串内容在打开期间变化时交叉淡入，气泡以弹簧过渡到新文本尺寸 */
function TooltipText({ text }: { text: string }) {
    const reduced = useReducedMotion()
    const measure = useRef<HTMLSpanElement>(null)
    const measured = useRef<string | null>(null)
    const [size, setSize] = useState<{ width: number; height: number; animate: boolean } | null>(null)

    useLayoutEffect(() => {
        const node = measure.current
        if (!node) return
        const observer = new ResizeObserver(([entry]) => {
            if (!entry) return
            const box = entry.borderBoxSize?.[0]
            const current = node.textContent
            const animate = measured.current !== null && measured.current !== current
            measured.current = current
            setSize({
                width: Math.ceil(box?.inlineSize ?? node.offsetWidth),
                height: Math.ceil(box?.blockSize ?? node.offsetHeight),
                animate,
            })
        })
        observer.observe(node)
        return () => observer.disconnect()
    }, [])

    return (
        <motion.span
            className={styles.text}
            initial={false}
            animate={size ? { width: size.width, height: size.height } : undefined}
            transition={size?.animate && !reduced ? motionTokens.spring.morph : { duration: 0 }}
        >
            <span ref={measure} className={styles.measure} aria-hidden="true">{text}</span>
            <AnimatePresence mode="popLayout" initial={false}>
                <motion.span
                    key={text}
                    className={styles.line}
                    initial={reduced ? false : { opacity: 0, y: '0.3em', filter: `blur(${motionTokens.blur.soft}px)` }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    exit={reduced
                        ? { opacity: 0, transition: { duration: 0 } }
                        : {
                            opacity: 0,
                            y: '-0.3em',
                            filter: `blur(${motionTokens.blur.subtle}px)`,
                            transition: { duration: motionTokens.duration.instant, ease: [...motionTokens.ease.standard] },
                        }}
                    transition={{ duration: motionTokens.duration.standard, ease: [...motionTokens.ease.enter] }}
                >
                    {text}
                </motion.span>
            </AnimatePresence>
        </motion.span>
    )
}

export function Tooltip(props: TooltipProps) {
    const {
        content,
        children,
        side = 'top',
        align = 'center',
        open: controlledOpen,
        onOpenChange,
        trigger = 'hover',
        delayDuration,
        sideOffset = 8,
        collisionPadding = 12,
        className,
    } = props

    const isWarm = useSyncExternalStore(warmth.subscribe, warmth.get, () => false)
    // 受控打开态由外部决定；非受控时内部状态与 Radix 的 onOpenChange 同步
    const [internalOpen, setInternalOpen] = useState(false)
    const [instant, setInstant] = useState(false)
    const open = controlledOpen ?? internalOpen

    useEffect(() => {
        if (!open) return
        warmth.opened()
        return warmth.closed
    }, [open])

    const handleOpenChange = (next: boolean) => {
        // manual 模式：打开只由外部 open 驱动，忽略 Trigger 的 hover/focus 请求；
        // 关闭请求（Escape / 点外 / Radix dismiss）仍要转发给消费方
        if (trigger === 'manual' && next) return
        if (next) setInstant(warmth.get())
        if (controlledOpen === undefined) setInternalOpen(next)
        onOpenChange?.(next)
    }

    // Radix Tooltip 没有 Anchor：manual 模式仍用 Trigger（提供定位与 aria），
    // 但上面的 handleOpenChange 过滤掉它发起的打开请求
    return (
        <TooltipPrimitive.Provider delayDuration={delayDuration ?? DELAY} skipDelayDuration={0}>
            <TooltipPrimitive.Root
                open={open}
                delayDuration={isWarm ? 0 : (delayDuration ?? DELAY)}
                onOpenChange={handleOpenChange}
                // 纯文字提示不可交互：指针离开 trigger 立即关闭（上游默认可悬停内容，
                // 依赖 grace-area 判定，对文字气泡没有收益且会延迟关闭）
                disableHoverableContent
            >
                <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
                <TooltipPrimitive.Portal>
                    <TooltipPrimitive.Content
                        className={className ? `${styles.tooltip} ${className}` : styles.tooltip}
                        data-instant={instant || undefined}
                        side={side}
                        align={align}
                        sideOffset={sideOffset}
                        collisionPadding={collisionPadding}
                    >
                        {typeof content === 'string' || typeof content === 'number'
                            ? <TooltipText text={String(content)} />
                            : content}
                    </TooltipPrimitive.Content>
                </TooltipPrimitive.Portal>
            </TooltipPrimitive.Root>
        </TooltipPrimitive.Provider>
    )
}
