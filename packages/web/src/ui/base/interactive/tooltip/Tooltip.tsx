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
 * ① 打开态完全受控（`open` 必填）：Radix Trigger 只负责锚定、aria 与定位，
 *    hover / 焦点发起的打开请求一律忽略，关闭请求（Escape / 点外）转交消费方。
 *    触发策略统一由 AppTooltip 承担（mouse hover + touch long-press 分流），
 *    上游的 hover 延迟与跨实例「暖窗口」因此随之上移/删除。
 * ② z-index 由上游写死的 90 改为 --mobi-z-overlay（与 shadcn 浮层同基线 1080）
 * ③ 阴影 / 底色 / 字号 / 间距 / 圆角全部走 UIARC_ALIAS_VARS 或既有 CSS 变量，
 *    明暗双档自动跟随（上游变量名与本项目同源，无需本地映射块）
 * ④ 补 `align` 与 `sideOffset/collisionPadding`，AppTooltip 的 placement 映射需要
 *
 * 与 Popover 的分工：Tooltip 只承载「纯文字提示」，无焦点、无交互内容；需要点击 / 悬停
 * 内容交互的浮层仍用 popover/Popover。
 */

import { useLayoutEffect, useRef, useState } from 'react'
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
    /** 打开态（必填受控）：只有 AppTooltip 的分流逻辑能决定何时打开 */
    open: boolean
    /** 关闭请求（Escape / 点外 / trigger 自身关闭手势）回调 */
    onOpenChange?: (open: boolean) => void
    /** 浮层方位，默认 top（Radix 碰撞翻转兜底） */
    side?: 'top' | 'bottom' | 'left' | 'right'
    /** 沿方位轴的对齐，默认 center */
    align?: 'start' | 'center' | 'end'
    sideOffset?: number
    /** 碰撞内边距（px），默认 12 */
    collisionPadding?: number
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

export function Tooltip({
    content,
    children,
    open,
    onOpenChange,
    side = 'top',
    align = 'center',
    sideOffset = 8,
    collisionPadding = 12,
}: TooltipProps) {
    // Radix Trigger 在自身 pointerdown / click 时会发 onClose（用于它的原生 hover 语义）。
    // 本组件打开态完全受控，这类「点自身」的关闭必须忽略——旧 AppTooltip 的契约是
    // 桌面端点 trigger 不关 hover tooltip；Escape / 点外仍要转发。
    const triggerPressRef = useRef(false)
    const markTriggerPress = () => {
        triggerPressRef.current = true
        // 同一次事件派发结束后复位；否则未触发关闭时会残留，吞掉后续 Escape
        window.setTimeout(() => { triggerPressRef.current = false }, 0)
    }

    return (
        <TooltipPrimitive.Provider>
            <TooltipPrimitive.Root
                open={open}
                onOpenChange={(next) => {
                    if (next) return
                    if (triggerPressRef.current) {
                        triggerPressRef.current = false
                        return
                    }
                    onOpenChange?.(false)
                }}
                // 纯文字提示不可交互：指针离开 trigger 立即关闭（上游默认可悬停内容，
                // 依赖 grace-area 判定，对文字气泡没有收益且会延迟关闭）
                disableHoverableContent
            >
                <TooltipPrimitive.Trigger asChild onPointerDownCapture={markTriggerPress} onClickCapture={markTriggerPress}>{children}</TooltipPrimitive.Trigger>
                <TooltipPrimitive.Portal>
                    <TooltipPrimitive.Content
                        className={styles.tooltip}
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
