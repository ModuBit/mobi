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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { pushHistoryGuard, __resetHistoryGuardForTest } from '@/core/lib/drawerHistoryGuard'

/** 同步派发一次 popstate（模拟用户手势返回） */
const firePopstate = (): void => window.dispatchEvent(new PopStateEvent('popstate'))

describe('drawerHistoryGuard', () => {
    beforeEach(() => {
        __resetHistoryGuardForTest()
        // jsdom 的 history.back() 不稳定触发 popstate，而真实浏览器会触发。
        // 同步模拟浏览器语义：back() 立即派发一次 popstate（由 guard 的 suppressCount 抑制）
        vi.spyOn(window.history, 'back').mockImplementation(() => {
            window.dispatchEvent(new PopStateEvent('popstate'))
        })
    })
    afterEach(() => vi.restoreAllMocks())

    it('手势返回（popstate）触发 onBackPressed 收起覆盖物', () => {
        const back = vi.fn()
        pushHistoryGuard(back)
        expect(back).not.toHaveBeenCalled()
        firePopstate()
        expect(back).toHaveBeenCalledTimes(1)
    })

    it('正常关闭（dispose）不触发 onBackPressed', () => {
        const back = vi.fn()
        const dispose = pushHistoryGuard(back)
        dispose()
        // dispose 内部 history.back()（已 mock 同步）触发 popstate，由 suppressCount 抑制
        expect(back).not.toHaveBeenCalled()
    })

    it('嵌套场景后入先出：手势返回只收起栈顶覆盖物', () => {
        const inner = vi.fn() // 先 push：底层（如 InspectorPane）
        const outer = vi.fn() // 后 push：顶层（如 drawer）
        pushHistoryGuard(inner)
        pushHistoryGuard(outer)

        firePopstate()
        expect(outer).toHaveBeenCalledTimes(1)
        expect(inner).not.toHaveBeenCalled()

        firePopstate()
        expect(inner).toHaveBeenCalledTimes(1)
    })

    it('dispose 已被 popstate 消费的哨兵为空操作，不重复触发回调', () => {
        const back = vi.fn()
        const dispose = pushHistoryGuard(back)
        firePopstate() // 消费哨兵
        expect(back).toHaveBeenCalledTimes(1)
        expect(() => dispose()).not.toThrow()
        expect(back).toHaveBeenCalledTimes(1) // 不再触发
    })

    it('dispose 后再 push 新哨兵仍正常工作', () => {
        const a = vi.fn()
        const disposeA = pushHistoryGuard(a)
        disposeA()

        const b = vi.fn()
        pushHistoryGuard(b)
        firePopstate()
        expect(b).toHaveBeenCalledTimes(1)
        expect(a).not.toHaveBeenCalled()
    })

    it('嵌套时主动关闭顶层不影响底层（栈序正确）', () => {
        const inner = vi.fn()
        const outer = vi.fn()
        pushHistoryGuard(inner)
        const disposeOuter = pushHistoryGuard(outer)

        disposeOuter() // 用户主动关顶层 drawer
        expect(outer).not.toHaveBeenCalled() // 主动关闭 ≠ 手势返回回调

        // 底层仍在，手势返回应收起它
        firePopstate()
        expect(inner).toHaveBeenCalledTimes(1)
    })

    it('嵌套时主动关闭底层（非栈顶）不误弹栈顶哨兵', () => {
        const inner = vi.fn()
        const outer = vi.fn()
        const disposeInner = pushHistoryGuard(inner)
        pushHistoryGuard(outer)
        // closeStack=[inner, outer]，history 栈顶是 outer 的哨兵
        // 程序化先关底层 inner（如父组件重置 expanded）：不应 back（否则误弹 outer 哨兵）
        disposeInner()
        expect(inner).not.toHaveBeenCalled()
        expect(outer).not.toHaveBeenCalled()
        // 栈顶 outer 仍在，手势返回应正常关它（未被误弹）
        firePopstate()
        expect(outer).toHaveBeenCalledTimes(1)
        expect(inner).not.toHaveBeenCalled()
    })
})
