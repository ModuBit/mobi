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

// useKeyboardViewport 行为锁定：基线棘轮修复（/code-review finding）——
// 基线跟随环境变化必须可逆，否则桌面缩放/URL 栏回落会永久假「键盘弹出」
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useKeyboardViewport } from '@/components/chat/useKeyboardViewport'

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

/** 环境几何整体切换（innerHeight 与 vv.height 同源变化——真实浏览器中 layout viewport 缩放两者同步） */
function setViewport(vv: EventTarget & { height: number }, innerHeight: number, vvHeight = innerHeight) {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: innerHeight })
    vv.height = vvHeight
    fire(vv, 'resize')
}

afterEach(() => {
    cleanup()
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined })
    ;(document.activeElement as HTMLElement | null)?.blur?.()
})

describe('useKeyboardViewport', () => {
    it('无输入焦点时 innerHeight 回落（桌面缩放恢复）→ 基线跟随回落，不残留假键盘 inset', () => {
        const vv = stubVisualViewport()
        setViewport(vv, 800)
        const { result } = renderHook(() => useKeyboardViewport())

        // 环境变大（Ctrl+- 放大视口）再恢复（Ctrl+0）：回落幅度 ≥ 阈值也不得判为键盘
        setViewport(vv, 1000)
        expect(result.current.keyboardInset).toBe(0)
        setViewport(vv, 800)
        expect(result.current.keyboardInset).toBe(0)
    })

    it('焦点在输入框且 innerHeight 缩水（Android resize 模式键盘弹出）→ 正确检出 inset', () => {
        const vv = stubVisualViewport()
        setViewport(vv, 800)
        const { result } = renderHook(() => useKeyboardViewport())

        const input = document.createElement('input')
        document.body.appendChild(input)
        input.focus()
        // Android resize 模式：键盘弹出 layout viewport 缩到键盘上方，innerHeight ≈ vv.height
        setViewport(vv, 400)
        expect(result.current.keyboardInset).toBe(400)
        expect(result.current.layoutInset).toBe(0)
    })

    it('键盘收起（焦点仍在但可视高度恢复）→ inset 归零', () => {
        const vv = stubVisualViewport()
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
        const { result } = renderHook(() => useKeyboardViewport())

        const input = document.createElement('input')
        document.body.appendChild(input)
        input.focus()
        setViewport(vv, 400)
        expect(result.current.keyboardInset).toBe(400)

        // 键盘收起：layout viewport 回到全高（焦点尚未 blur 的真实时序）
        setViewport(vv, 800)
        expect(result.current.keyboardInset).toBe(0)

        // iOS 模型：innerHeight 恒定，键盘弹出/收起只裁 vv.height
        setViewport(vv, 800, 400)
        expect(result.current.keyboardInset).toBe(400)
        setViewport(vv, 800, 800)
        expect(result.current.keyboardInset).toBe(0)
    })
})
