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

// uiarc popover（registry 快照，自管件：深度本地化后脱离 registry，不登记 registry.json）。
// 上游：https://uiarc.dev/r/popover.json（Popover / PopoverTrigger / PopoverContent + module.css）。
// 本地化点：
// ① 上游只支持 click 触发；本站需要 hover / hover+click / manual（antd Popover 16 处消费的
//    三种触发语义），因此把 Root/Trigger/Content 收成一个组件，hover intent 与 manual 锚定自管。
// ② hover 打开时指针可以移入面板继续保持（滑杆 / effort 菜单等交互内容依赖），离开面板后
//    再按 closeDelay 关闭；触屏 pointerType 不作为 hover 源（与 antd 现状一致）。
// ③ 焦点策略对齐 antd：只有键盘打开才自动聚焦面板，鼠标 / 触屏打开不抢焦点；关闭时只在
//    键盘打开的情况下把焦点还给 trigger。
// ④ arc token 消费 cssVars.ts 的 UIARC_ALIAS_VARS（无本地映射块）；z-index 改吃
//    --mobi-z-overlay（与 shadcn 弹层同基线，高于 antd 的 1000 起）。
// ⑤ 面板几何（min/max 宽、内衬）改为 CSS 变量，消费方按场景覆盖；上游的 22rem / 视口
//    上限保留为默认值，替代 antd.css 里按 antd DOM 写死的窄屏锁几何。
// ⑥ 面板根元素带 data-mobi-popover，作为测试锚点（替代 .ant-popover）。
// 其余（进出场 transition、reduced-motion、碰撞翻转、portal 仅打开时挂载）与上游一致。

import * as PopoverPrimitive from '@radix-ui/react-popover'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, HTMLAttributes, ReactElement, ReactNode } from 'react'
import styles from './popover.module.css'

export type PopoverTriggerMode = 'click' | 'hover' | 'manual'

/** 触发语义：数组 = hover 打开 + click 钉住（antd `trigger={['hover','click']}` 等价） */
export type PopoverTrigger = PopoverTriggerMode | Array<'click' | 'hover'>

export interface PopoverProps {
    /** 触发方式，默认 click */
    trigger?: PopoverTrigger
    open?: boolean
    onOpenChange?: (open: boolean) => void
    /** 关闭后保留面板内容（antd 默认行为）；需要保留内部滚动/展开/过滤等状态时开启 */
    keepMounted?: boolean
    /** 浮层方位，默认 top（与 antd 默认 placement 一致） */
    side?: 'top' | 'bottom' | 'left' | 'right'
    /** 沿方位轴的对齐，默认 center（与 antd 默认居中语义一致） */
    align?: 'start' | 'center' | 'end'
    sideOffset?: number
    /** hover 意图：进入 trigger 后延迟打开（毫秒），默认 100 */
    openDelay?: number
    /** hover 意图：离开 trigger / 面板后延迟关闭（毫秒），默认 160 */
    closeDelay?: number
    /** 面板箭头（Radix Arrow），默认不渲染 */
    arrow?: boolean
    panelClassName?: string
    panelStyle?: CSSProperties
    /** 面板内衬，默认 12px（antd overlayInnerStyle 的替身） */
    panelPadding?: number | string
    /** 面板最大宽度，默认 min(22rem, 100vw - 20px) */
    maxWidth?: number | string
    children: ReactElement
    content: ReactNode
}

const DEFAULT_OPEN_DELAY = 100
const DEFAULT_CLOSE_DELAY = 160
const COLLISION_PADDING = 10

/** 数值 → px，字符串原样（面板 CSS 变量入参） */
function cssLen(value: number | string): string {
    return typeof value === 'number' ? `${value}px` : value
}

function triggerModes(trigger: PopoverTrigger): Set<'click' | 'hover' | 'manual'> {
    return new Set(Array.isArray(trigger) ? trigger : [trigger])
}

export function Popover({
    trigger = 'click',
    open: controlledOpen,
    onOpenChange,
    keepMounted = false,
    side = 'top',
    align = 'center',
    sideOffset = 6,
    openDelay = DEFAULT_OPEN_DELAY,
    closeDelay = DEFAULT_CLOSE_DELAY,
    arrow = false,
    panelClassName,
    panelStyle,
    panelPadding,
    maxWidth,
    children,
    content,
}: PopoverProps) {
    const modes = triggerModes(trigger)
    const hoverable = modes.has('hover')
    const clickable = modes.has('click')

    const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
    // keepMounted：首次打开后内容常驻（Radix forceMount），关闭期间用 inert 挡住焦点/交互
    const [everOpened, setEverOpened] = useState(false)
    const isControlled = controlledOpen !== undefined
    const isOpen = isControlled ? controlledOpen : uncontrolledOpen

    useEffect(() => {
        if (isOpen) setEverOpened(true)
    }, [isOpen])

    const contentId = `mobi-popover-${useId()}`

    // 关闭只由「当前这一次打开」的意图决定：hover 关闭不能冲掉 click 钉住
    const pinnedRef = useRef(false)
    const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // 键盘打开才移动焦点；鼠标 / 触屏打开保持 antd 的「不抢焦点」现状
    const openViaKeyboardRef = useRef(false)
    const restoreFocusOnCloseRef = useRef(false)
    // Anchor 模式没有 Radix 的 triggerRef，键盘打开时记下锚点元素，关闭时手动归还焦点
    const anchorElRef = useRef<HTMLElement | null>(null)

    const clearTimer = (ref: typeof openTimerRef) => {
        if (ref.current !== null) {
            clearTimeout(ref.current)
            ref.current = null
        }
    }
    const clearAllTimers = useCallback(() => {
        clearTimer(openTimerRef)
        clearTimer(closeTimerRef)
    }, [])

    useEffect(() => clearAllTimers, [clearAllTimers])

    const setOpen = useCallback((next: boolean) => {
        // 任何一次开合都作废在途的 hover 定时器；否则「悬停未到阈值就点击打开」后，
        // 旧 openTimer 仍会再发一次 onOpenChange(true)
        clearAllTimers()
        if (!next) pinnedRef.current = false
        if (!isControlled) setUncontrolledOpen(next)
        onOpenChange?.(next)
    }, [clearAllTimers, isControlled, onOpenChange])

    const scheduleOpen = () => {
        clearTimer(closeTimerRef)
        clearTimer(openTimerRef)
        if (!isOpen) openTimerRef.current = setTimeout(() => setOpen(true), openDelay)
    }
    const scheduleClose = () => {
        clearTimer(openTimerRef)
        clearTimer(closeTimerRef)
        if (isOpen) closeTimerRef.current = setTimeout(() => setOpen(false), closeDelay)
    }

    const anchorPointerHandlers: Pick<HTMLAttributes<HTMLElement>, 'onPointerEnter' | 'onPointerLeave'> = hoverable
        ? {
            onPointerEnter: (event) => {
                // 触屏没有 hover 语义；hover+click 场景由 click 分支负责
                if (event.pointerType === 'touch') return
                if (pinnedRef.current) return
                scheduleOpen()
            },
            onPointerLeave: (event) => {
                if (event.pointerType === 'touch') return
                if (pinnedRef.current) return
                scheduleClose()
            },
        }
        : {}

    // hover+click 的 click 语义是「钉住」而不是「切换」：hover 已打开后再点一下不能关掉——
    // Radix Trigger 固定 toggle，无法表达，所以这两种形态走 Anchor + 自管 click
    const anchorClickHandlers: Pick<HTMLAttributes<HTMLElement>, 'onClick'> = clickable && hoverable
        ? {
            onClick: () => {
                if (!isOpen) {
                    pinnedRef.current = true
                    openViaKeyboardRef.current = false
                    setOpen(true)
                } else if (pinnedRef.current) {
                    setOpen(false)
                } else {
                    pinnedRef.current = true
                }
            },
        }
        : {}

    // 键盘打开：hover 自己开；manual 交给消费方（如 SubmitButton 的 Enter=中止），
    // click 由 Radix Trigger 的原生按钮激活打开。这里只记下「本次是键盘意图」，让焦点策略放行
    const anchorKeyboardHandlers: Pick<HTMLAttributes<HTMLElement>, 'onKeyDown'> = {
        onKeyDown: (event) => {
            if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'ArrowDown') return
            openViaKeyboardRef.current = true
            restoreFocusOnCloseRef.current = true
            anchorElRef.current = event.currentTarget as HTMLElement
            if (hoverable) {
                event.preventDefault()
                if (clickable) pinnedRef.current = true
                setOpen(true)
            }
        },
    }

    // 面板自身也是 hover 目标：指针从 trigger 移入面板时取消关闭
    const contentPointerHandlers: Pick<HTMLAttributes<HTMLElement>, 'onPointerEnter' | 'onPointerLeave'> = hoverable
        ? {
            onPointerEnter: () => clearTimer(closeTimerRef),
            onPointerLeave: () => {
                if (pinnedRef.current) return
                scheduleClose()
            },
        }
        : {}

    const handleOpenChange = (next: boolean) => {
        // 焦点归还由 onCloseAutoFocus 消费 restoreFocusOnCloseRef 决定，这里不能提前清零
        setOpen(next)
    }

    const panelStyleVars: CSSProperties = {
        ...(panelPadding !== undefined ? { '--popover-padding': cssLen(panelPadding) } : {}),
        ...(maxWidth !== undefined ? { '--popover-max-width': cssLen(maxWidth) } : {}),
        ...panelStyle,
    } as CSSProperties

    const panel = (
        <PopoverPrimitive.Portal forceMount={keepMounted && everOpened ? true : undefined}>
            <PopoverPrimitive.Content
                id={contentId}
                data-mobi-popover=""
                forceMount={keepMounted && everOpened ? true : undefined}
                inert={keepMounted && !isOpen ? true : undefined}
                side={side}
                align={align}
                sideOffset={sideOffset}
                collisionPadding={COLLISION_PADDING}
                className={[styles.content, panelClassName].filter(Boolean).join(' ')}
                style={panelStyleVars}
                onPointerEnter={contentPointerHandlers.onPointerEnter}
                onPointerLeave={contentPointerHandlers.onPointerLeave}
                onOpenAutoFocus={(event) => {
                    // 鼠标 / 触屏打开不抢焦点（antd 现状）；键盘打开保留焦点进面板
                    if (!openViaKeyboardRef.current) event.preventDefault()
                    openViaKeyboardRef.current = false
                }}
                onCloseAutoFocus={(event) => {
                    // 焦点从未进入面板时不要把它拉回 trigger（hover 场景会打断用户当前焦点）；
                    // 键盘打开时手动归还（Anchor 模式没有 Radix 的 triggerRef）
                    event.preventDefault()
                    if (restoreFocusOnCloseRef.current) anchorElRef.current?.focus()
                    restoreFocusOnCloseRef.current = false
                }}
            >
                {content}
                {arrow && <PopoverPrimitive.Arrow className={styles.arrow} width={12} height={6} />}
            </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
    )

    // 纯 click：Radix Trigger 负责点击切换与键盘语义
    if (clickable && !hoverable) {
        return (
            <PopoverPrimitive.Root open={isOpen} onOpenChange={handleOpenChange}>
                <PopoverPrimitive.Trigger asChild {...anchorPointerHandlers} {...anchorKeyboardHandlers}>
                    {children}
                </PopoverPrimitive.Trigger>
                {panel}
            </PopoverPrimitive.Root>
        )
    }

    // hover-only / hover+click / manual：Anchor 只锚定，触发语义自管
    // （manual 由长按等外部逻辑受控；hover+click 的 click = 钉住）
    return (
        <PopoverPrimitive.Root open={isOpen} onOpenChange={handleOpenChange}>
            <PopoverPrimitive.Anchor
                asChild
                {...anchorPointerHandlers}
                {...anchorClickHandlers}
                {...anchorKeyboardHandlers}
                aria-haspopup="dialog"
                aria-expanded={isOpen}
                aria-controls={isOpen ? contentId : undefined}
            >
                {children}
            </PopoverPrimitive.Anchor>
            {panel}
        </PopoverPrimitive.Root>
    )
}
