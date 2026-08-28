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

import { Tooltip } from 'antd'
import type { TooltipProps } from 'antd'
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent, PointerEvent } from 'react'

/** 触屏长按阈值（ms）—— pointerdown 持续超过此时长判定为 long-press，显示 tooltip */
const LONG_PRESS_MS = 500

/**
 * 移动端友好的 Tooltip：按 PointerEvent.pointerType 实时分流触发方式。
 *
 * 背景：antd Tooltip 默认 hover 触发，触屏 tap 会被浏览器模拟成 mouseenter，
 * 导致 tooltip 弹出且没有 mouseleave 可关闭，卡住并遮挡界面。
 *
 * 解法：antd Tooltip 用 open 受控（禁默认 trigger），外层 span 挂 pointer 事件，
 * 按 pointerType 分流：
 * - mouse / pen → hover：pointerenter 显示（保留 mouseEnterDelay 延迟），pointerleave 消失
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
 * 零矩形，而 antd Tooltip（rc-align）正是以 wrapper span 的该矩形为定位目标——零矩形
 * 使对齐失效：悬停期间 tooltip 停在屏外测量位（不可见），关闭动画阶段 overflow 钳制
 * 把它推到视口左下角播放，形成「光标移开瞬间左下角闪一下」。补偿见 installRectBridge：
 * 零矩形时委托给 Range 的内容联合矩形（Range 跨 display:contents 子树生效），
 * 布局仍零影响，定位恢复以真实悬停内容为锚。
 *
 * 受控用法：传 open 则透传给 antd Tooltip，hover/long-press 自动禁用
 * （如 InstallButton 的 iosTipOpen 由按钮 click 控制，无需 pointer 分流）。
 */
export function AppTooltip({ children, mouseEnterDelay, open: controlledOpen, ...rest }: TooltipProps) {
    const [internalOpen, setInternalOpen] = useState(false)
    const isControlled = controlledOpen !== undefined
    const open = isControlled ? controlledOpen : internalOpen

    // wrapper span 的 ref：rc-trigger（@rc-component/trigger）克隆 child 时用
    // useComposeRef 合并已有 ref，这里与它共存不冲突；rect 补丁挂载期安装
    const wrapperRef = useRef<HTMLSpanElement>(null)

    // display:contents 无盒 → Chrome 恒返回零矩形 → rc-align 以零矩形对齐失效
    // （详见组件头注释）。零矩形时把 rect 委托给内容联合矩形（Range 跨 contents 子树），
    // rc-align 拿到真实悬停内容矩形，定位与关闭动画都回到正确位置。
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

    return (
        <Tooltip {...rest} mouseEnterDelay={mouseEnterDelay} open={open}>
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
