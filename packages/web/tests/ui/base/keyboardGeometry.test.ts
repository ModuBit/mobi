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
 * 键盘几何读取的契约：overlay 模式下只认 VirtualKeyboard API（视口不缩）；
 * geometrychange 上报前按上次高度预测；关闭后回到 Infinity。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

type KeyboardModule = typeof import('@/ui/base/layout/keyboardGeometry')

interface FakeKeyboard {
    overlaysContent: boolean
    boundingRect: { top: number; height: number }
    addEventListener: ReturnType<typeof vi.fn>
    removeEventListener: ReturnType<typeof vi.fn>
}

function installKeyboard(overlaysContent: boolean, rect: { top: number; height: number }): FakeKeyboard {
    const fake: FakeKeyboard = {
        overlaysContent,
        boundingRect: rect,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }
    Object.defineProperty(navigator, 'virtualKeyboard', { value: fake, configurable: true })
    return fake
}

/** 模块内部有「上次键盘高度」记忆，每个用例重新导入拿到干净状态 */
async function freshModule(): Promise<KeyboardModule> {
    vi.resetModules()
    return import('@/ui/base/layout/keyboardGeometry')
}

afterEach(() => {
    Reflect.deleteProperty(navigator, 'virtualKeyboard')
    document.body.innerHTML = ''
})

describe('keyboardGeometry', () => {
    it('overlay 模式键盘弹出 → 顶边取 boundingRect.top', async () => {
        installKeyboard(true, { top: 500, height: 268 })
        const { getKeyboardTop, isKeyboardOverlayMode } = await freshModule()
        expect(isKeyboardOverlayMode()).toBe(true)
        expect(getKeyboardTop()).toBe(500)
    })

    it('非 overlay 模式 / 无 API → Infinity（消费端继续用 visualViewport）', async () => {
        installKeyboard(false, { top: 500, height: 268 })
        const { getKeyboardTop, isKeyboardOverlayMode } = await freshModule()
        expect(isKeyboardOverlayMode()).toBe(false)
        expect(getKeyboardTop()).toBe(Infinity)

        Reflect.deleteProperty(navigator, 'virtualKeyboard')
        expect((await freshModule()).getKeyboardTop()).toBe(Infinity)
    })

    it('键盘收起且无可编辑焦点 → Infinity', async () => {
        installKeyboard(true, { top: 0, height: 0 })
        const { getKeyboardTop } = await freshModule()
        expect(getKeyboardTop()).toBe(Infinity)
    })

    it('抽出动画中（height=0）按上次高度预测，键盘落定后以终值为准', async () => {
        const keyboard = installKeyboard(true, { top: 500, height: 268 })
        const { getKeyboardTop } = await freshModule()
        expect(getKeyboardTop()).toBe(500)

        const input = document.createElement('input')
        document.body.appendChild(input)
        input.focus()

        // 动画窗口：几何尚未上报，焦点在输入框 → innerHeight - 记住的高度
        keyboard.boundingRect = { top: 0, height: 0 }
        expect(getKeyboardTop()).toBe(window.innerHeight - 268)

        // 终值到位：以真实顶边为准，测量值与预测一致
        keyboard.boundingRect = { top: 500, height: 268 }
        expect(getKeyboardTop()).toBe(500)
    })

    it('订阅只转发给 VirtualKeyboard 的 geometrychange；返回拆除器', async () => {
        const keyboard = installKeyboard(true, { top: 500, height: 268 })
        const { subscribeKeyboardGeometry } = await freshModule()
        const listener = vi.fn()

        const unsubscribe = subscribeKeyboardGeometry(listener)
        expect(keyboard.addEventListener).toHaveBeenCalledWith('geometrychange', listener)
        unsubscribe()
        expect(keyboard.removeEventListener).toHaveBeenCalledWith('geometrychange', listener)
    })

    it('非 overlay 模式订阅为空操作（不挂事件）', async () => {
        const keyboard = installKeyboard(false, { top: 0, height: 0 })
        const { subscribeKeyboardGeometry } = await freshModule()
        const unsubscribe = subscribeKeyboardGeometry(vi.fn())
        expect(keyboard.addEventListener).not.toHaveBeenCalled()
        expect(() => unsubscribe()).not.toThrow()
    })
})
