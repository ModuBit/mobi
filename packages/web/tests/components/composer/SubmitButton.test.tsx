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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { SubmitButtonState } from '@/components/composer/submitButtonState'
import { LONG_PRESS_MS } from '@/components/composer/submitButtonState'
import { SubmitButton } from '@/components/composer/SubmitButton'

const stopState: SubmitButtonState = { kind: 'stop', disabled: false, loading: false }

/** 模拟一次完整 pointer press（可选在长按阈值后释放） */
function press(button: HTMLElement, holdMs: number) {
    fireEvent.pointerDown(button, { button: 0 })
    if (holdMs > 0) fireEvent.pointerMove(button)
    fireEvent.pointerUp(button)
    // 释放后浏览器合成的 click（点按路径必有）
    fireEvent.click(button)
}

describe('SubmitButton 长按抑制 vs 键盘激活', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => {
        vi.useRealTimers()
        cleanup()
    })

    it('点按触发 onAbort("turn")，释放合成的 click 被吞不双触发', () => {
        const onAbort = vi.fn()
        render(<SubmitButton state={stopState} onSubmit={vi.fn()} onAbort={onAbort} />)
        press(screen.getByRole('button'), 0)
        expect(onAbort).toHaveBeenCalledTimes(1)
        expect(onAbort).toHaveBeenCalledWith('turn')
    })

    it('长按释放后紧随的合成 click 被吞（不误发 turn 中止）', () => {
        const onAbort = vi.fn()
        render(<SubmitButton state={stopState} onSubmit={vi.fn()} onAbort={onAbort} />)
        const button = screen.getByRole('button')
        fireEvent.pointerDown(button, { button: 0 })
        // 越过长按阈值 → 菜单弹出；期间无 abort
        vi.advanceTimersByTime(LONG_PRESS_MS + 1)
        expect(onAbort).not.toHaveBeenCalled()
        fireEvent.pointerUp(button)
        // 长按路径：释放合成的 click 须被吞
        fireEvent.click(button)
        expect(onAbort).not.toHaveBeenCalled()
    })

    it('长按释放后的键盘激活（时间窗外到达的 click）照常触发 onAbort("turn")', () => {
        const onAbort = vi.fn()
        render(<SubmitButton state={stopState} onSubmit={vi.fn()} onAbort={onAbort} />)
        const button = screen.getByRole('button')
        fireEvent.pointerDown(button, { button: 0 })
        vi.advanceTimersByTime(LONG_PRESS_MS + 1)
        fireEvent.pointerUp(button)
        // 触屏长按场景：浏览器不派发合成 click；时间窗外再来的 click（handleClick 直调）= 键盘激活
        vi.advanceTimersByTime(1_000)
        fireEvent.click(button)
        expect(onAbort).toHaveBeenCalledTimes(1)
        expect(onAbort).toHaveBeenCalledWith('turn')
    })
})
