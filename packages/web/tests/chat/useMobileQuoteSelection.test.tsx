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
 * useMobileQuoteSelection（移动端 selectionchange → 防抖 → 选区提案）hook 行为测试：
 * jsdom 无真实选择手势，document 级 selectionchange 事件 + stub 的 window.getSelection
 * 驱动；判定逻辑（resolveQuoteSelection）不在此重复——这里只验证监听/防抖/空选区过滤。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useMobileQuoteSelection } from '@/components/chat/useMobileQuoteSelection'

/** 非 collapsed 的假 Range（hook 不消费 Range 内容，只透传给回调） */
const fakeRange = { collapsed: false } as Range

/** stub window.getSelection 的返回形态（rangeCount / isCollapsed / getRangeAt） */
function stubSelection(range: Range | null, collapsed = false) {
    vi.spyOn(window, 'getSelection').mockReturnValue({
        rangeCount: range ? 1 : 0,
        isCollapsed: collapsed,
        getRangeAt: () => range!,
    } as unknown as Selection)
}

/** 触发一次 document 级 selectionchange（长按起选后浏览器派发的同一事件） */
function fireSelectionChange() {
    document.dispatchEvent(new Event('selectionchange'))
}

beforeEach(() => {
    vi.useFakeTimers()
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    cleanup()
})

describe('useMobileQuoteSelection（移动端 selectionchange 入口）', () => {
    it('选区变化后等默认防抖（300ms）落定才回调非空选区 range（等系统选择手柄稳定）', () => {
        const onSelectionSettled = vi.fn()
        stubSelection(fakeRange)
        renderHook(() => useMobileQuoteSelection({ enabled: true, onSelectionSettled }))

        fireSelectionChange()
        expect(onSelectionSettled).not.toHaveBeenCalled()
        vi.advanceTimersByTime(299)
        expect(onSelectionSettled).not.toHaveBeenCalled()
        vi.advanceTimersByTime(1)
        expect(onSelectionSettled).toHaveBeenCalledTimes(1)
        expect(onSelectionSettled).toHaveBeenCalledWith(fakeRange)
    })

    it('debounce 窗口内连续变化只按最后一次落定回调一次（防「先清后选」抖动）', () => {
        const onSelectionSettled = vi.fn()
        stubSelection(fakeRange)
        renderHook(() => useMobileQuoteSelection({ enabled: true, onSelectionSettled }))

        fireSelectionChange()
        vi.advanceTimersByTime(200)
        fireSelectionChange()
        vi.advanceTimersByTime(200)
        fireSelectionChange()
        vi.advanceTimersByTime(300)
        expect(onSelectionSettled).toHaveBeenCalledTimes(1)
    })

    it('落定时选区已清空或 collapsed → 不回调（关闭语义归容器既有「选区清空即关浮层」effect）', () => {
        const onSelectionSettled = vi.fn()
        stubSelection(null)
        renderHook(() => useMobileQuoteSelection({ enabled: true, onSelectionSettled }))

        fireSelectionChange()
        vi.advanceTimersByTime(300)
        expect(onSelectionSettled).not.toHaveBeenCalled()

        stubSelection({ collapsed: true } as Range)
        fireSelectionChange()
        vi.advanceTimersByTime(300)
        expect(onSelectionSettled).not.toHaveBeenCalled()
    })

    it('enabled=false（PC 走 mouseup 路径）不监听 selectionchange', () => {
        const onSelectionSettled = vi.fn()
        stubSelection(fakeRange)
        renderHook(() => useMobileQuoteSelection({ enabled: false, onSelectionSettled }))

        fireSelectionChange()
        vi.advanceTimersByTime(1000)
        expect(onSelectionSettled).not.toHaveBeenCalled()
    })

    it('卸载后残留的 debounce 定时器不再回调', () => {
        const onSelectionSettled = vi.fn()
        stubSelection(fakeRange)
        const { unmount } = renderHook(() =>
            useMobileQuoteSelection({ enabled: true, onSelectionSettled }),
        )

        fireSelectionChange()
        unmount()
        vi.advanceTimersByTime(300)
        expect(onSelectionSettled).not.toHaveBeenCalled()
    })
})
