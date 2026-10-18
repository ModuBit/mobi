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

import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent, PointerEvent, ReactElement, ReactNode } from 'react'
import { Tooltip } from '@/ui/base/interactive/tooltip/Tooltip'

/** 触屏长按阈值（ms）—— pointerdown 持续超过此时长判定为 long-press，显示 tooltip */
const LONG_PRESS_MS = 500

/** antd placement → 自管 Tooltip 的 side/align（与 popover 迁移同一套映射） */
type Placement =
    | 'top' | 'bottom' | 'left' | 'right'
    | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
    | 'leftTop' | 'leftBottom' | 'rightTop' | 'rightBottom'

const PLACEMENTS: Record<Placement, { side: 'top' | 'bottom' | 'left' | 'right'; align: 'start' | 'center' | 'end' }> = {
    top: { side: 'top', align: 'center' },
    bottom: { side: 'bottom', align: 'center' },
    left: { side: 'left', align: 'center' },
    right: { side: 'right', align: 'center' },
    topLeft: { side: 'top', align: 'start' },
    topRight: { side: 'top', align: 'end' },
    bottomLeft: { side: 'bottom', align: 'start' },
    bottomRight: { side: 'bottom', align: 'end' },
    leftTop: { side: 'left', align: 'start' },
    leftBottom: { side: 'left', align: 'end' },
    rightTop: { side: 'right', align: 'start' },
    rightBottom: { side: 'right', align: 'end' },
}

export interface AppTooltipProps {
    /** 提示内容；null / undefined / '' 表示不展示（ContextRing 用它抑制重弹） */
    title?: ReactNode
    children: ReactElement
    /** 方位，默认 top */
    placement?: Placement
    /** 首次悬停延迟（秒，沿用 antd 语义），默认 0 */
    mouseEnterDelay?: number
    /** 受控打开态；传了则不接管 hover / long-press 分流 */
    open?: boolean
    onOpenChange?: (open: boolean) => void
    className?: string
}

/**
 * 移动端友好的 Tooltip：按 PointerEvent.pointerType 实时分流触发方式。
 *
 * 背景：浏览器 hover 触发在触屏上会被 tap 模拟成 mouseenter，tooltip 弹出且没有
 * mouseleave 可关闭，卡住并遮挡界面。
 *
 * 底座是自管 uiarc Tooltip（src/ui/base/interactive/tooltip/，`trigger="manual"`：
 * Radix Anchor 只锚定、不绑 hover/focus），所有打开态由本组件驱动：
 * - mouse / pen → hover：pointerenter 延迟打开（mouseEnterDelay），pointerleave 关闭
 * - touch → long-press：pointerdown 启动 LONG_PRESS_MS 定时器，到期才显示
 *   · 短按（未到期 pointerup）→ 不显示，click 正常触发元素 action
 *   · long-press 命中 → 显示 tooltip，并在捕获阶段吞掉紧随的 click（阻止 action 被误触发）
 *   · tooltip 显示时挂 document 一次性 pointerdown listener → 点任意外部位置关闭
 *     （仅 touch 模式；hover 模式由 pointerleave 关闭，不挂此监听，避免桌面端点击 trigger 误关）
 *
 * 不依赖 matchMedia / 屏幕宽度：pointerType 是每一下输入的真实来源，
 * iPad 接鼠标时鼠标走 hover、手指走 long-press，两者并存不互斥。
 *
 * 外层 span 用 display:contents 不生成 box，不影响 flex/grid 布局；
 * pointer 事件由 React 合成（基于 DOM 层级，contents 元素照常接收）。
 *
 * display:contents 的代价与补偿：无盒元素在 Chrome 下 getBoundingClientRect() 恒返回
 * 零矩形，而 Radix Popper 以 wrapper span 的该矩形为定位目标——零矩形使对齐失效：
 * 悬停期间 tooltip 停在屏外测量位（不可见），关闭动画阶段 overflow 钳制
 * 把它推到视口左下角播放，形成「光标移开瞬间左下角闪一下」。补偿见 installRectBridge：
 * 零矩形时委托给 Range 的内容联合矩形（Range 跨 display:contents 子树生效），
 * 布局仍零影响，定位恢复以真实悬停内容为锚。
 *
 * 受控用法：传 open 则透传，hover/long-press 自动禁用
 * （如 InstallButton 的 iosTipOpen 由按钮 click 控制，无需 pointer 分流）。
 */
export function AppTooltip(props: AppTooltipProps) {
    const {
        children,
        title,
        placement = 'top',
        mouseEnterDelay,
        open: controlledOpen,
        onOpenChange,
        className,
    } = props

    const [internalOpen, setInternalOpen] = useState(false)
    const isControlled = controlledOpen !== undefined
    const hasContent = title !== undefined && title !== null && title !== ''
    const open = (isControlled ? controlledOpen : internalOpen) && hasContent

    // title 被清空（如 ContextRing 打开 Popover 时）→ 同步清内部打开态，
    // 否则 title 恢复后会出现「没重新悬停也立刻重弹」
    useEffect(() => {
        if (!hasContent && !isControlled) setInternalOpen(false)
    }, [hasContent, isControlled])

    // wrapper span 的 ref：Radix asChild 会 compose 已有 ref，这里与它共存不冲突；
    // rect 补丁挂载期安装
    const wrapperRef = useRef<HTMLSpanElement>(null)

    // display:contents 无盒 → Chrome 恒返回零矩形 → Popper 以零矩形对齐失效
    // （详见组件头注释）。零矩形时把 rect 委托给内容联合矩形（Range 跨 contents 子树）。
    useEffect(() => {
        const el = wrapperRef.current
        if (!el) return
        const original = el.getBoundingClientRect
        el.getBoundingClientRect = function (this: HTMLSpanElement) {
            const rect = original.call(this)
            if (rect.width === 0 && rect.height === 0) {
                const range = document.createRange()
                range.selectNodeContents(this)
                // jsdom / 旧浏览器 Range 可能没有 getBoundingClientRect，跳过委托走原值
                const contentRect = typeof range.getBoundingClientRect === 'function'
                    ? range.getBoundingClientRect()
                    : rect
                if (contentRect.width > 0 || contentRect.height > 0) return contentRect
            }
            return rect
        }
        // 卸载恢复原函数：StrictMode 双挂载下先恢复再重装，不会捕获到已补丁版本
        return () => { el.getBoundingClientRect = original }
    }, [])

    const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const longPressedRef = useRef(false)
    // 记录当前打开 tooltip 的输入类型：决定是否挂「外部 pointerdown 关闭」监听。
    // 仅 touch（long-press）打开时需要 —— hover 打开的 tooltip 由 pointerleave 关闭，
    // 若也挂该监听，桌面端鼠标用户点击 trigger 自身会被误关（与桌面 Tooltip 常规行为不符）。
    const openInputType = useRef<'mouse' | 'touch' | undefined>(undefined)

    // 卸载时清理定时器，避免泄漏
    useEffect(() => () => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current)
        if (holdTimer.current) clearTimeout(holdTimer.current)
    }, [])

    // tooltip 显示时，下一次外部 pointerdown 关闭（仅 touch 模式 + 非受控）
    useEffect(() => {
        if (!open || isControlled) return
        if (openInputType.current !== 'touch') return
        const handler = () => setInternalOpen(false)
        document.addEventListener('pointerdown', handler, { capture: true, once: true })
        return () => document.removeEventListener('pointerdown', handler, { capture: true })
    }, [open, isControlled])

    const isHoverInput = (e: PointerEvent) => e.pointerType === 'mouse' || e.pointerType === 'pen'

    // mouse / pen → hover（保留 mouseEnterDelay 延迟，防误触）
    const handlePointerEnter = (e: PointerEvent) => {
        if (isControlled || !isHoverInput(e)) return
        if (hoverTimer.current) clearTimeout(hoverTimer.current)
        hoverTimer.current = setTimeout(() => {
            openInputType.current = 'mouse'
            setInternalOpen(true)
        }, (mouseEnterDelay ?? 0) * 1000)
    }

    const handlePointerLeave = (e: PointerEvent) => {
        if (isHoverInput(e)) {
            if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = undefined }
            if (!isControlled) setInternalOpen(false)
        }
        // 触屏手指滑出 trigger 也中止 long-press
        if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = undefined }
    }

    // touch → long-press（mouse/pen 走 hover，这里 return）
    const handlePointerDown = (e: PointerEvent) => {
        if (isControlled || e.pointerType !== 'touch') return
        longPressedRef.current = false
        if (holdTimer.current) clearTimeout(holdTimer.current)
        holdTimer.current = setTimeout(() => {
            longPressedRef.current = true
            openInputType.current = 'touch'
            setInternalOpen(true)
        }, LONG_PRESS_MS)
    }

    const handlePointerUp = (e: PointerEvent) => {
        if (e.pointerType !== 'touch') return
        if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = undefined }
    }

    // long-press 命中 → 在捕获阶段吞掉这次 click，阻止元素 onClick（action）
    const handleClickCapture = (e: MouseEvent) => {
        if (longPressedRef.current) {
            e.preventDefault()
            e.stopPropagation()
            longPressedRef.current = false
        }
    }

    const { side, align } = PLACEMENTS[placement]

    return (
        <Tooltip
            content={title}
            trigger="manual"
            open={open}
            onOpenChange={(next) => {
                if (isControlled) onOpenChange?.(next)
                else setInternalOpen(next)
            }}
            side={side}
            align={align}
            className={className}
        >
            <span
                ref={wrapperRef}
                onPointerEnter={handlePointerEnter}
                onPointerLeave={handlePointerLeave}
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                onClickCapture={handleClickCapture}
                style={{
                    display: 'contents',
                    // 抑制触屏 long-press 期间系统的选区/长按菜单
                    WebkitTouchCallout: 'none',
                    userSelect: 'none',
                } as CSSProperties}
            >
                {children}
            </span>
        </Tooltip>
    )
}
