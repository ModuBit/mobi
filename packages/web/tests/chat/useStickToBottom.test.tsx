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

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { cleanup, render } from '@testing-library/react'
import {
    useStickToBottom,
    AT_BOTTOM_THRESHOLD,
    SMOOTH_SCROLL_FALLBACK_MS,
    type StickToBottomController,
} from '@/components/chat/useStickToBottom'

/**
 * ResizeObserver 替身：记录被观测元素，暴露 trigger() 手动触发回调。
 * jsdom 无内置实现，且真实 observer 依赖布局（jsdom 恒 0 高度）。
 */
class FakeResizeObserver {
    static instances: FakeResizeObserver[] = []
    observed: Element[] = []
    disconnected = false
    constructor(private cb: ResizeObserverCallback) {
        FakeResizeObserver.instances.push(this)
    }
    observe(el: Element) { this.observed.push(el) }
    unobserve() { /* 本用例不涉及 */ }
    disconnect() { this.disconnected = true }
    /** 模拟内容高度变化 */
    trigger() { this.cb([], this as unknown as ResizeObserver) }
}

/** jsdom 的元素几何恒为 0，用可写属性伪造滚动容器尺寸 */
function makeScroller(opts: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
    const el = document.createElement('div')
    let scrollTop = opts.scrollTop
    let scrollHeight = opts.scrollHeight
    Object.defineProperties(el, {
        clientHeight: { get: () => opts.clientHeight },
        scrollHeight: { get: () => scrollHeight, set: (v: number) => { scrollHeight = v } },
        scrollTop: {
            get: () => scrollTop,
            // 赋值后同步派发 scroll 事件，对齐浏览器行为（本 hook 依赖 scroll 双向同步跟随意图）
            set: (v: number) => { scrollTop = v; el.dispatchEvent(new Event('scroll')) },
        },
    })
    // jsdom 未实现 scrollTo
    el.scrollTo = ((arg: ScrollToOptions) => { el.scrollTop = arg.top ?? 0 }) as typeof el.scrollTo
    const itemList = document.createElement('div')
    itemList.setAttribute('data-testid', 'virtuoso-item-list')
    el.appendChild(itemList)
    document.body.appendChild(el)
    return { el, itemList, setScrollHeight: (v: number) => { scrollHeight = v } }
}

/** 挂载 hook 并把 controller 暴露出来 */
function renderHook(enabled: boolean, scroller: HTMLElement) {
    const ref: { current: StickToBottomController | null } = { current: null }
    function Probe({ on }: { on: boolean }) {
        const ctrl = useStickToBottom(on)
        ref.current = ctrl
        // 首帧就把 scroller 交给 hook，模拟 Virtuoso 的 scrollerRef 回调时机
        ctrl.handleScrollerRef(scroller)
        return null
    }
    const utils = render(<Probe on={enabled} />)
    return { ref, ...utils, Probe }
}

const origRO = globalThis.ResizeObserver

beforeEach(() => {
    FakeResizeObserver.instances = []
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
})

afterEach(() => {
    cleanup()
    globalThis.ResizeObserver = origRO
    document.body.innerHTML = ''
    vi.useRealTimers()
})

describe('useStickToBottom — 流式贴底跟随', () => {
    it('内容增高时钉到底部（followOutput 不触发的场景）', () => {
        const { el, setScrollHeight } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        renderHook(true, el)

        // 流式追加：item 数不变，只是内容变高
        setScrollHeight(3000)
        act(() => { FakeResizeObserver.instances[0].trigger() })

        expect(el.scrollTop).toBe(3000)
    })

    it('用户上滚离开底部后停止钉底（不被强行拉回）', () => {
        const { el, setScrollHeight } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)

        // 用户上滚 800px：赋值 scrollTop 会派发 scroll，hook 据几何位置判定掉队
        act(() => { el.scrollTop = 0 })
        expect(ref.current?.following).toBe(false)

        setScrollHeight(3000)
        act(() => { FakeResizeObserver.instances[0].trigger() })
        expect(el.scrollTop).toBe(0)
    })

    it('用户手动滚回底部附近 → 自动恢复跟随（回归：轻扫一下永久掉队）', () => {
        const { el, setScrollHeight } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)

        act(() => { el.scrollTop = 0 })
        expect(ref.current?.following).toBe(false)

        // 滚回距底 < 阈值处
        act(() => { el.scrollTop = 1000 - 500 - (AT_BOTTOM_THRESHOLD - 1) })
        expect(ref.current?.following).toBe(true)

        setScrollHeight(3000)
        act(() => { FakeResizeObserver.instances[0].trigger() })
        expect(el.scrollTop).toBe(3000)
    })

    it('距底刚超阈值即判定掉队', () => {
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)

        act(() => { el.scrollTop = 500 - (AT_BOTTOM_THRESHOLD + 1) })
        expect(ref.current?.following).toBe(false)
    })
})

describe('useStickToBottom — smooth 门闩', () => {
    it('smooth 滚动期间不被 ResizeObserver 抢断（回归：最后突然跳一下）', () => {
        const { el, setScrollHeight } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
        const { ref } = renderHook(true, el)

        act(() => { ref.current?.stickToBottom('smooth') })
        // 动画途中内容被逐个测量致总高增长
        setScrollHeight(3000)
        act(() => { FakeResizeObserver.instances[0].trigger() })
        // 门闩生效：observer 不应把 scrollTop 改成新的 3000
        expect(el.scrollTop).not.toBe(3000)

        // scrollend 解除门闩后恢复钉底
        act(() => { el.dispatchEvent(new Event('scrollend')) })
        act(() => { FakeResizeObserver.instances[0].trigger() })
        expect(el.scrollTop).toBe(3000)
    })

    it('smooth 途中的中间位置不把 following 置 false（回归：按钮闪回）', () => {
        const { el } = makeScroller({ scrollHeight: 3000, clientHeight: 500, scrollTop: 0 })
        const { ref } = renderHook(true, el)

        act(() => { el.scrollTop = 0 })
        expect(ref.current?.following).toBe(false)

        act(() => { ref.current?.stickToBottom('smooth') })
        expect(ref.current?.following).toBe(true)
        // 模拟动画中途的一次 scroll（位置远离底部）
        act(() => { el.dispatchEvent(new Event('scroll')) })
        expect(ref.current?.following).toBe(true)
    })

    it('scrollend 缺失时定时器兜底解除门闩（旧浏览器）', () => {
        vi.useFakeTimers()
        const { el, setScrollHeight } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
        const { ref } = renderHook(true, el)

        act(() => { ref.current?.stickToBottom('smooth') })
        act(() => { vi.advanceTimersByTime(SMOOTH_SCROLL_FALLBACK_MS + 1) })

        setScrollHeight(3000)
        act(() => { FakeResizeObserver.instances[0].trigger() })
        expect(el.scrollTop).toBe(3000)
    })

    it("behavior='auto' 立即钉底且不置门闩", () => {
        const { el, setScrollHeight } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
        const { ref } = renderHook(true, el)

        act(() => { ref.current?.stickToBottom('auto') })
        expect(el.scrollTop).toBe(1000)

        setScrollHeight(2000)
        act(() => { FakeResizeObserver.instances[0].trigger() })
        expect(el.scrollTop).toBe(2000)
    })
})

describe('useStickToBottom — 生命周期', () => {
    it('enabled=false 时不建立观测（item-list 尚未挂载）', () => {
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        renderHook(false, el)
        expect(FakeResizeObserver.instances).toHaveLength(0)
    })

    it('卸载时断开观测并移除监听', () => {
        const { el, setScrollHeight } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { unmount } = renderHook(true, el)
        const observer = FakeResizeObserver.instances[0]

        unmount()
        expect(observer.disconnected).toBe(true)

        // 卸载后 scroll 事件不应再触发 setState（React 会警告；此处断言不抛）
        setScrollHeight(3000)
        expect(() => { el.scrollTop = 0 }).not.toThrow()
    })
})
