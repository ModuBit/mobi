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
 * 可用视口的契约：可视底边取视觉视口与 overlay 键盘的较小者；overlay 模式下
 * geometrychange 上报前按上次高度预测；place() 的分支（方向 / 收窄 / 定位）可穷举。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { place, readUsableViewport, subscribeViewportChange } from '@/ui/base/layout/usableViewport'
import type { PlaceInput } from '@/ui/base/layout/usableViewport'

type ViewportModule = typeof import('@/ui/base/layout/usableViewport')

interface FakeKeyboard {
    overlaysContent: boolean
    boundingRect: { top: number; height: number }
    addEventListener: ReturnType<typeof vi.fn>
    removeEventListener: ReturnType<typeof vi.fn>
}

interface FakeVisualViewport {
    offsetTop: number
    height: number
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

function installVisualViewport(offsetTop: number, height: number): FakeVisualViewport {
    const fake: FakeVisualViewport = {
        offsetTop,
        height,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }
    Object.defineProperty(window, 'visualViewport', { value: fake, configurable: true })
    return fake
}

/** 模块内部有「上次键盘高度」记忆，每个用例重新导入拿到干净状态 */
async function freshModule(): Promise<ViewportModule> {
    vi.resetModules()
    return import('@/ui/base/layout/usableViewport')
}

afterEach(() => {
    Reflect.deleteProperty(navigator, 'virtualKeyboard')
    Reflect.deleteProperty(window, 'visualViewport')
    document.body.innerHTML = ''
})

describe('键盘顶边（overlay 模型）', () => {
    it('overlay 模式键盘弹出 → 顶边取 boundingRect.top', async () => {
        installKeyboard(true, { top: 500, height: 268 })
        const { getKeyboardTop, isKeyboardOverlayMode } = await freshModule()
        expect(isKeyboardOverlayMode()).toBe(true)
        expect(getKeyboardTop()).toBe(500)
    })

    it('非 overlay 模式 / 无 API → Infinity（可视底边由视觉视口决定）', async () => {
        installKeyboard(false, { top: 500, height: 268 })
        const { getKeyboardTop, isKeyboardOverlayMode } = await freshModule()
        expect(isKeyboardOverlayMode()).toBe(false)
        expect(getKeyboardTop()).toBe(Infinity)

        Reflect.deleteProperty(navigator, 'virtualKeyboard')
        expect((await freshModule()).getKeyboardTop()).toBe(Infinity)
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

        // 终值到位：以真实顶边为准
        keyboard.boundingRect = { top: 500, height: 268 }
        expect(getKeyboardTop()).toBe(500)
    })
})

describe('readUsableViewport（可用视口读取）', () => {
    it('无视觉视口/键盘 → 底边就是布局视口底部', async () => {
        const { readUsableViewport } = await freshModule()
        expect(readUsableViewport()).toEqual({ top: 0, bottom: window.innerHeight })
    })

    it('视觉视口偏移与高度 → top/bottom 跟随', async () => {
        installVisualViewport(40, 600)
        const { readUsableViewport } = await freshModule()
        expect(readUsableViewport()).toEqual({ top: 40, bottom: 640 })
    })

    it('overlay 键盘顶边比视觉视口底更靠上 → 取较小者', async () => {
        installVisualViewport(0, 800)
        installKeyboard(true, { top: 500, height: 268 })
        const { readUsableViewport } = await freshModule()
        expect(readUsableViewport()).toEqual({ top: 0, bottom: 500 })
    })
})

describe('subscribeViewportChange（统一订阅）', () => {
    it('三源接线：window resize + 视觉视口 resize/scroll + 键盘 geometrychange', async () => {
        const keyboard = installKeyboard(true, { top: 500, height: 268 })
        const vv = installVisualViewport(0, 800)
        const { subscribeViewportChange } = await freshModule()
        const listener = vi.fn()

        const unsubscribe = subscribeViewportChange(listener)
        expect(vv.addEventListener).toHaveBeenCalledWith('resize', listener)
        expect(vv.addEventListener).toHaveBeenCalledWith('scroll', listener)
        expect(keyboard.addEventListener).toHaveBeenCalledWith('geometrychange', listener)

        unsubscribe()
        expect(vv.removeEventListener).toHaveBeenCalledWith('resize', listener)
        expect(vv.removeEventListener).toHaveBeenCalledWith('scroll', listener)
        expect(keyboard.removeEventListener).toHaveBeenCalledWith('geometrychange', listener)
    })

    it('非 overlay 模式不挂 keyboard 源（视觉视口监听照常）', async () => {
        const keyboard = installKeyboard(false, { top: 0, height: 0 })
        installVisualViewport(0, 800)
        const { subscribeViewportChange } = await freshModule()
        const unsubscribe = subscribeViewportChange(vi.fn())
        expect(keyboard.addEventListener).not.toHaveBeenCalled()
        expect(() => unsubscribe()).not.toThrow()
    })
})

describe('place（浮层放置纯函数）', () => {
    const base: PlaceInput = {
        anchor: { left: 100, top: 300, bottom: 340, width: 240 },
        contentHeight: 280,
        viewport: { top: 0, bottom: 800 },
        layoutHeight: 800,
        gap: 8,
        chrome: 12,
        minListHeight: 48,
    }

    it('下方放得下 → 向下、不设高度上限、top 定位', () => {
        const result = place(base)
        // below = 800-340-8 = 452 ≥ 280+8
        expect(result.direction).toBe('down')
        expect(result.maxHeight).toBeNull()
        expect(result.style).toEqual({ left: 100, width: 240, top: 348 })
    })

    it('下方放不下且上方更宽敞 → 向上、bottom 锚定', () => {
        const result = place({ ...base, anchor: { left: 100, top: 600, bottom: 640, width: 240 } })
        // below = 800-640-8 = 152 < 288；above = 600-8 = 592 > 152
        expect(result.direction).toBe('up')
        expect(result.maxHeight).toBeNull()
        // bottom = layoutHeight - anchor.top + gap
        expect(result.style).toEqual({ left: 100, width: 240, bottom: 208 })
    })

    it('翻转后仍放不下 → 按可用空间收窄（扣除弹层自身内衬）', () => {
        const result = place({
            ...base,
            anchor: { left: 100, top: 200, bottom: 240, width: 240 },
            contentHeight: 700,
            viewport: { top: 0, bottom: 500 },
        })
        // below = 500-240-8 = 252 < 708；above = 200-8 = 192；above < below → 不翻
        expect(result.direction).toBe('down')
        expect(result.maxHeight).toBe(252 - 12)
    })

    it('键盘压矮视口 → 下方空间按可用视口判定', () => {
        const result = place({ ...base, viewport: { top: 0, bottom: 420 } })
        // below = 420-340-8 = 72 < 288；above = 300-8 = 292 > 72 → 翻上
        expect(result.direction).toBe('up')
        expect(result.maxHeight).toBeNull()
    })

    it('可用空间极小时保底一行高度', () => {
        const result = place({
            ...base,
            anchor: { left: 10, top: 60, bottom: 100, width: 200 },
            contentHeight: 400,
            viewport: { top: 0, bottom: 160 },
        })
        // below = 160-100-8 = 52 < 408；above = 60-8 = 52；above > below 为假 → 向下
        expect(result.direction).toBe('down')
        // 52-12=40 < 48 → 抬高到 48
        expect(result.maxHeight).toBe(48)
    })
})
