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

// useKeyboardViewport 行为锁定：
// - 基线棘轮修复（/code-review finding）——基线跟随环境变化必须可逆，否则桌面缩放/URL 栏
//   回落会永久假「键盘弹出」
// - 外部 store + selector（code-review 2026-10-31）——页级组件订布尔切片不跟逐帧动画
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useKeyboardViewportSelector, resetKeyboardViewportForTests } from '@/features/chat/useKeyboardViewport'

/** jsdom 无 visualViewport：可变几何 + EventTarget 的假体，按需改属性后手动派发事件 */
function stubVisualViewport() {
    const target = new EventTarget()
    const vv = Object.assign(target, { offsetTop: 0, height: 800, width: 390 })
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv })
    return vv
}

function fire(vv: EventTarget, type: 'resize' | 'scroll') {
    act(() => { vv.dispatchEvent(new Event(type)) })
}

/** overlay 模式假体：VirtualKeyboard API 开 overlay 时几何改源 geometrychange（vv 数学恒 0 不可用） */
function stubVirtualKeyboard() {
    const target = new EventTarget()
    const vk = Object.assign(target, {
        overlaysContent: true,
        boundingRect: { height: 0, width: 390, x: 0, y: 400 },
    })
    Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, value: vk })
    return vk
}

function fireGeometry(vk: EventTarget & { boundingRect: { height: number } }, height: number) {
    vk.boundingRect.height = height
    act(() => { vk.dispatchEvent(new Event('geometrychange')) })
}

/** 环境几何整体切换（innerHeight 与 vv.height 同源变化——真实浏览器中 layout viewport 缩放两者同步） */
function setViewport(vv: EventTarget & { height: number }, innerHeight: number, vvHeight = innerHeight) {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight })
    vv.height = vvHeight
    fire(vv, 'resize')
}

function focusInput() {
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    return input
}

beforeEach(() => {
    // store 是模块级单源、跨测试存活，用例间归零
    resetKeyboardViewportForTests()
})

afterEach(() => {
    cleanup()
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
    Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, value: undefined })
    ;(document.activeElement as HTMLElement | null)?.blur?.()
})

describe('useKeyboardViewportSelector（vv 模式：无 VirtualKeyboard API）', () => {
    it('无输入焦点时 innerHeight 回落（桌面缩放恢复）→ 基线跟随回落，不残留假键盘 inset', () => {
        const vv = stubVisualViewport()
        setViewport(vv, 800)
        const { result } = renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))

        // 环境变大（Ctrl+- 放大视口）再恢复（Ctrl+0）：回落幅度 ≥ 阈值也不得判为键盘
        setViewport(vv, 1000)
        expect(result.current).toBe(0)
        setViewport(vv, 800)
        expect(result.current).toBe(0)
    })

    it('焦点在输入框且 innerHeight 缩水（Android resize 模式键盘弹出）→ 正确检出 inset', () => {
        const vv = stubVisualViewport()
        setViewport(vv, 800)
        const kb = renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))
        const layout = renderHook(() => useKeyboardViewportSelector(s => s.layoutInset))

        focusInput()
        // Android resize 模式：键盘弹出 layout viewport 缩到键盘上方，innerHeight ≈ vv.height
        setViewport(vv, 400)
        expect(kb.result.current).toBe(400)
        expect(layout.result.current).toBe(0)
    })

    it('键盘收起（焦点仍在但可视高度恢复）→ inset 归零', () => {
        const vv = stubVisualViewport()
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
        const kb = renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))

        focusInput()
        setViewport(vv, 400)
        expect(kb.result.current).toBe(400)

        // 键盘收起：layout viewport 回到全高（焦点尚未 blur 的真实时序）
        setViewport(vv, 800)
        expect(kb.result.current).toBe(0)

        // iOS 模型：innerHeight 恒定，键盘弹出/收起只裁 vv.height
        setViewport(vv, 800, 400)
        expect(kb.result.current).toBe(400)
        setViewport(vv, 800, 800)
        expect(kb.result.current).toBe(0)
    })
})

describe('useKeyboardViewportSelector（overlay 模式：VirtualKeyboard API 开 overlaysContent）', () => {
    it('inset 改源 geometrychange.boundingRect，keyboardInset 与 layoutInset 同值', () => {
        const vk = stubVirtualKeyboard()
        const kb = renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))
        const layout = renderHook(() => useKeyboardViewportSelector(s => s.layoutInset))

        expect(kb.result.current).toBe(0)

        // 键盘弹出：boundingRect.height 即权威 inset，layoutInset 同值（fixed 元素全额补偿）
        fireGeometry(vk, 300)
        expect(kb.result.current).toBe(300)
        expect(layout.result.current).toBe(300)

        // 逐帧中间值必须透传（不走 vv 路径的 80px 阈值）——阈值会把腾出空间的动画掐死
        fireGeometry(vk, 120)
        expect(kb.result.current).toBe(120)

        // 键盘收起
        fireGeometry(vk, 0)
        expect(kb.result.current).toBe(0)
        expect(layout.result.current).toBe(0)
    })

    it('overlay 模式下 vv 事件不再驱动 inset（防双源互相踩）', () => {
        const vk = stubVirtualKeyboard()
        const vv = stubVisualViewport()
        setViewport(vv, 800)
        const kb = renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))

        focusInput()
        // resize 语义的 vv 收缩在 overlay 模式不会发生；即便发生也不得误报键盘
        setViewport(vv, 400)
        expect(kb.result.current).toBe(0)
        // 键盘几何只认 geometrychange
        fireGeometry(vk, 260)
        expect(kb.result.current).toBe(260)
    })

    it('带 API 但 overlaysContent 未开 → 仍走 vv 路径（与浏览器/CSS 消费同一 flag 权威）', () => {
        const vk = stubVirtualKeyboard()
        vk.overlaysContent = false
        const vv = stubVisualViewport()
        setViewport(vv, 800)
        const kb = renderHook(() => useKeyboardViewportSelector(s => s.keyboardInset))

        focusInput()
        // 浏览器在收缩视口（resize 模式）→ vv 数学是正确源；geometrychange 不驱动
        setViewport(vv, 400)
        expect(kb.result.current).toBe(400)
        fireGeometry(vk, 260)
        expect(kb.result.current).toBe(400)
    })
})

describe('selector 切片订阅的渲染纪律（code-review 2026-10-31 修复的行为锚）', () => {
    it('布尔切片只在翻转时重渲染：inset 逐帧变化不掀页级组件', () => {
        const vv = stubVisualViewport()
        setViewport(vv, 800)
        let renders = 0
        const { result } = renderHook(() => {
            renders += 1
            return useKeyboardViewportSelector(s => s.keyboardInset > 0)
        })
        expect(result.current).toBe(false)
        const initialRenders = renders

        focusInput()
        // 第一帧 300（翻转 false→true）
        setViewport(vv, 500)
        expect(result.current).toBe(true)
        const afterFlip = renders
        // 后续逐帧 320/340…（动画中间值）布尔不变 → 不得重渲染
        setViewport(vv, 480)
        setViewport(vv, 460)
        expect(result.current).toBe(true)
        expect(renders).toBe(afterFlip)
        // 翻转本身恰好引发一次重渲染（StrictMode 双渲染下用相对断言）
        expect(afterFlip).toBeGreaterThan(initialRenders)
    })
})
