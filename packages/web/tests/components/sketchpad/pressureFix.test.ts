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
 * 压感修正测试：事件改写（rewritePointerPressure）与防抖兜底（createPressureFixer）
 * 均通过窄接口/合成事件驱动，不挂载 excalidraw。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import {
    PRESSURE_FIX_DEBOUNCE_MS,
    attachPressureRewrite,
    createPressureFixer,
    rewritePointerPressure,
    type PressureFixEditor,
} from '@/components/sketchpad/pressureFix'

/** jsdom 无 PointerEvent 构造器时以 MouseEvent 兜底（改写路径只需其存在，不读专有字段） */
beforeEach(() => {
    if (typeof window.PointerEvent === 'undefined') {
        ;(window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent
    }
})

/** 构造伪 trusted 指针事件（jsdom 的 isTrusted 只读不可伪造，用普通对象中转） */
function fakePointerEvent(props: Partial<PointerEvent> & { target: EventTarget }): PointerEvent {
    return {
        isTrusted: true,
        pressure: 0.5,
        type: 'pointermove',
        stopPropagation: vi.fn(),
        ...props,
    } as unknown as PointerEvent
}

describe('rewritePointerPressure 事件改写', () => {
    it('合成事件（isTrusted=false）直接放行，避免重派发自拦截死循环', () => {
        const target = { dispatchEvent: vi.fn() }
        const e = { ...fakePointerEvent({ target, pressure: 0.7 }), isTrusted: false }
        rewritePointerPressure(e)
        expect(e.stopPropagation).not.toHaveBeenCalled()
        expect(target.dispatchEvent).not.toHaveBeenCalled()
    })

    it('pressure 已是 0.5 的真实事件放行', () => {
        const target = { dispatchEvent: vi.fn() }
        const e = fakePointerEvent({ target, pressure: 0.5 })
        rewritePointerPressure(e)
        expect(e.stopPropagation).not.toHaveBeenCalled()
        expect(target.dispatchEvent).not.toHaveBeenCalled()
    })

    it('非 0.5 pressure 的真实事件：阻断原传播并按 0.5 重派发到原目标', () => {
        const target = { dispatchEvent: vi.fn() }
        const e = fakePointerEvent({ target, pressure: 0.7, type: 'pointerdown' })
        rewritePointerPressure(e)
        expect(e.stopPropagation).toHaveBeenCalledTimes(1)
        expect(target.dispatchEvent).toHaveBeenCalledTimes(1)
        const redispatched = target.dispatchEvent.mock.calls[0][0] as PointerEvent
        expect(redispatched.type).toBe('pointerdown')
        expect(redispatched.pressure).toBe(0.5)
    })
})

describe('attachPressureRewrite 挂载/卸载', () => {
    it('在 window 捕获层注册 4 种指针事件监听，卸载函数对称移除', () => {
        // 真实派发的事件 isTrusted=false 会被放行（防自拦截），无法走改写路径——
        // 改写逻辑已由 rewritePointerPressure 用例覆盖，这里只锁挂载/卸载的对称性
        const addSpy = vi.spyOn(window, 'addEventListener')
        const removeSpy = vi.spyOn(window, 'removeEventListener')
        const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']

        const detach = attachPressureRewrite()
        expect(addSpy).toHaveBeenCalledTimes(4)
        for (const type of types) {
            expect(addSpy).toHaveBeenCalledWith(type, rewritePointerPressure, true)
        }

        detach()
        expect(removeSpy).toHaveBeenCalledTimes(4)
        for (const type of types) {
            expect(removeSpy).toHaveBeenCalledWith(type, rewritePointerPressure, true)
        }
        addSpy.mockRestore()
        removeSpy.mockRestore()
    })
})

/** 假 editor：窄接口最简实现 */
function fakeEditor(elements: ExcalidrawElement[]): PressureFixEditor {
    return {
        getSceneElements: vi.fn(() => elements),
        updateScene: vi.fn(),
    }
}

const freedrawWithRealPressure = { type: 'freedraw', simulatePressure: false } as ExcalidrawElement
const freedrawSimulated = { type: 'freedraw', simulatePressure: true } as ExcalidrawElement
const rectangle = { type: 'rectangle' } as ExcalidrawElement

describe('createPressureFixer 防抖兜底', () => {
    beforeEach(() => {
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('落笔停顿超过防抖间隔后，把真实压力笔画翻回速度模拟（pressures 清空）', () => {
        const editor = fakeEditor([freedrawWithRealPressure])
        const fixer = createPressureFixer(editor)
        fixer.onChange()

        expect(editor.updateScene).not.toHaveBeenCalled()
        vi.advanceTimersByTime(PRESSURE_FIX_DEBOUNCE_MS)

        expect(editor.updateScene).toHaveBeenCalledTimes(1)
        const opts = (editor.updateScene as ReturnType<typeof vi.fn>).mock.calls[0][0]
        expect(opts.captureUpdate).toBe('NEVER')
        const [fixed] = opts.elements
        expect(fixed.simulatePressure).toBe(true)
        expect(fixed.pressures).toEqual([])
    })

    it('无候选笔画（已模拟/非 freedraw）时不触发任何改写', () => {
        const editor = fakeEditor([freedrawSimulated, rectangle])
        const fixer = createPressureFixer(editor)
        fixer.onChange()
        vi.advanceTimersByTime(PRESSURE_FIX_DEBOUNCE_MS * 2)
        expect(editor.updateScene).not.toHaveBeenCalled()
    })

    it('笔画进行中 onChange 连发只保留最后一次防抖', () => {
        const editor = fakeEditor([freedrawWithRealPressure])
        const fixer = createPressureFixer(editor)
        fixer.onChange()
        vi.advanceTimersByTime(PRESSURE_FIX_DEBOUNCE_MS - 10)
        fixer.onChange()
        vi.advanceTimersByTime(PRESSURE_FIX_DEBOUNCE_MS - 10)
        expect(editor.updateScene).not.toHaveBeenCalled()
        vi.advanceTimersByTime(10)
        expect(editor.updateScene).toHaveBeenCalledTimes(1)
    })

    it('dispose 丢弃未触发的兜底', () => {
        const editor = fakeEditor([freedrawWithRealPressure])
        const fixer = createPressureFixer(editor)
        fixer.onChange()
        fixer.dispose()
        vi.advanceTimersByTime(PRESSURE_FIX_DEBOUNCE_MS * 2)
        expect(editor.updateScene).not.toHaveBeenCalled()
    })
})
