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
            // 赋值后同步派发 scroll 事件（仅当值真正变化时），对齐浏览器行为：
            // 本 hook 依赖 scroll 双向同步，且跟随时 onScroll 会再 pin——若每次赋值都派发
            //（哪怕值不变）会与 pin 形成同步无限递归；浏览器对相同 scrollTop 不派发 scroll。
            set: (v: number) => {
                if (v === scrollTop) return
                scrollTop = v
                el.dispatchEvent(new Event('scroll'))
            },
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

/** 派发用户手势事件（wheel / touch / keydown）—— 这些是「停止跟随」的唯一触发源 */
function wheel(el: HTMLElement, deltaY: number) {
    el.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true }))
}
function touchStart(el: HTMLElement, clientY: number) {
    // jsdom 无可靠 TouchEvent 构造器，用裸 Event + touches 属性
    const ev = new Event('touchstart', { bubbles: true })
    Object.defineProperty(ev, 'touches', { value: [{ clientY }] })
    el.dispatchEvent(ev)
}
function touchMove(el: HTMLElement, clientY: number) {
    const ev = new Event('touchmove', { bubbles: true })
    Object.defineProperty(ev, 'touches', { value: [{ clientY }] })
    el.dispatchEvent(ev)
}
function keydown(el: HTMLElement, key: string) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}
/** 指针按下（模拟滚动条拖拽 / 鼠标按住拖动的起始）。jsdom 无 PointerEvent，用裸 Event。 */
function pointerDown(el: HTMLElement) {
    el.dispatchEvent(new Event('pointerdown', { bubbles: true }))
}
/** 指针抬起（window 级，模拟用户松开鼠标/触摸）。 */
function pointerUp() {
    window.dispatchEvent(new Event('pointerup'))
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

    it('仅程序改 scrollTop（无用户手势）不停止跟随（回归：高度变化 reflow 误判掉队）', () => {
        const { el, setScrollHeight } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)

        // 模拟 Virtuoso reflow / 浏览器 clamp：程序把 scrollTop 设到非底部并派发 scroll。
        // 旧实现会据此误判「用户上滚」→ following=false；新实现只认手势，应保持跟随。
        act(() => { el.scrollTop = 0 })
        expect(ref.current?.following).toBe(true)

        // 跟随仍在 → 后续增高仍钉底
        setScrollHeight(3000)
        act(() => { FakeResizeObserver.instances[0].trigger() })
        expect(el.scrollTop).toBe(3000)
    })

    it('onContentHeightChange（Virtuoso totalListHeightChanged）把跟随中的漂移钉回（修 turn 结束差几十像素）', () => {
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)
        expect(ref.current?.following).toBe(true)

        // 模拟 RO 时序差 / Virtuoso 视觉稳定调整留下的漂移：scrollTop 偏离底部
        act(() => { el.scrollTop = 400 })
        expect(ref.current?.following).toBe(true) // 无手势，仍跟随
        // onScroll 不负责钉底（避免与 Virtuoso 初始定位打架）；漂移由 totalListHeightChanged 信号钉回
        expect(el.scrollTop).toBe(400)

        // Virtuoso 测量 settle 后触发 totalListHeightChanged → onContentHeightChange 钉回精确底部
        act(() => { ref.current?.onContentHeightChange() })
        expect(el.scrollTop).toBe(1000)
    })

    it('wheel 向上 → 停止跟随，且后续增高不钉底（不被强行拉回）', () => {
        const { el, setScrollHeight } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)

        act(() => { wheel(el, -100) })
        expect(ref.current?.following).toBe(false)

        setScrollHeight(3000)
        act(() => { FakeResizeObserver.instances[0].trigger() })
        // 已停止跟随，observer 不钉底
        expect(el.scrollTop).not.toBe(3000)
    })

    it('用户手动滚回底部附近 → 自动恢复跟随（回归：轻扫一下永久掉队）', () => {
        const { el, setScrollHeight } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)

        act(() => { wheel(el, -100) })
        expect(ref.current?.following).toBe(false)

        // 滚回距底 < 阈值处（scroll 几何判定恢复）
        act(() => { el.scrollTop = 1000 - 500 - (AT_BOTTOM_THRESHOLD - 1) })
        expect(ref.current?.following).toBe(true)

        setScrollHeight(3000)
        act(() => { FakeResizeObserver.instances[0].trigger() })
        expect(el.scrollTop).toBe(3000)
    })

    it('恢复阈值边界：< 阈值恢复，> 阈值保持掉队', () => {
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)

        act(() => { wheel(el, -100) })
        expect(ref.current?.following).toBe(false)

        // 距底 = 阈值 + 1 → 不恢复
        act(() => { el.scrollTop = 1000 - 500 - (AT_BOTTOM_THRESHOLD + 1) })
        expect(ref.current?.following).toBe(false)

        // 距底 = 阈值 - 1 → 恢复
        act(() => { el.scrollTop = 1000 - 500 - (AT_BOTTOM_THRESHOLD - 1) })
        expect(ref.current?.following).toBe(true)
    })
})

describe('useStickToBottom — 手势停止跟随', () => {
    it('touch 向上拖动 → 停止跟随', () => {
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)

        act(() => { touchStart(el, 200) })
        act(() => { touchMove(el, 300) }) // 手指下移 = 内容向上滚 = 看历史
        expect(ref.current?.following).toBe(false)
    })

    it('touch 向下拖动不停止跟随（用户在往底部方向滚）', () => {
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)

        act(() => { touchStart(el, 300) })
        act(() => { touchMove(el, 200) }) // 手指上移 = 内容向下滚
        expect(ref.current?.following).toBe(true)
    })

    it.each(['PageUp', 'ArrowUp', 'Home'] as const)('键盘 %s → 停止跟随', (key) => {
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)

        act(() => { keydown(el, key) })
        expect(ref.current?.following).toBe(false)
    })

    it('wheel 向下不停止跟随（交给几何恢复）', () => {
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)

        act(() => { wheel(el, 100) })
        expect(ref.current?.following).toBe(true)
    })
})

describe('useStickToBottom — 滚动条拖拽 / 指针按住拖动', () => {
    // 回归：滚动条拖拽只产生 scroll，不产生 wheel/touch/keydown，旧实现不会停止跟随 →
    // 流式增长时被 ResizeObserver 强行钉回底部，与用户拖拽冲突。
    it('指针按下期间上滚 → 停止跟随（覆盖滚动条拖拽）', () => {
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)

        act(() => { pointerDown(el) })
        // 滚动条拖到上方（scroll 派发，但无 wheel/touch/keydown）
        act(() => { el.scrollTop = 0 })
        expect(ref.current?.following).toBe(false)
        pointerUp()
    })

    it('指针按下停止跟随后，流式增高不再被强行钉回底部', () => {
        const { el, setScrollHeight } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)

        act(() => { pointerDown(el) })
        act(() => { el.scrollTop = 0 })
        expect(ref.current?.following).toBe(false)

        // 流式追加：observer 因 following=false 不钉底，用户拖到的位置不被覆盖
        setScrollHeight(3000)
        act(() => { FakeResizeObserver.instances[0].trigger() })
        expect(el.scrollTop).toBe(0)
        pointerUp()
    })

    it('无指针按下的程序 scroll 不停止跟随（安全约束：Virtuoso reflow 不掉队）', () => {
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)

        // 不按指针，直接程序改 scrollTop（模拟 Virtuoso reflow / 浏览器 clamp）
        act(() => { el.scrollTop = 0 })
        expect(ref.current?.following).toBe(true)
    })

    it('指针抬起后的程序 scroll 不再触发停止跟随', () => {
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)

        act(() => { pointerDown(el) })
        act(() => { el.scrollTop = 0 })
        expect(ref.current?.following).toBe(false)

        // 滚回底部恢复跟随
        act(() => { el.scrollTop = 1000 - 500 })
        expect(ref.current?.following).toBe(true)

        // 抬起指针后，程序改 scrollTop 离开底部不再翻 false
        pointerUp()
        act(() => { el.scrollTop = 0 })
        expect(ref.current?.following).toBe(true)
    })
})

describe('useStickToBottom — 键盘停止跟随绑 window', () => {
    it('在 scroller 外派发 PageUp（冒泡到 window）→ 停止跟随', () => {
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)

        // 焦点常态在 composer（scroller 外），用 document.body 模拟非 scroller、非可编辑目标。
        // 监听在 window，body 派发的事件冒泡到 window 才被捕获。
        act(() => { document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true })) })
        expect(ref.current?.following).toBe(false)
    })

    it('PageUp 命中可编辑元素（textarea）→ 不劫持，保持跟随', () => {
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderHook(true, el)

        const textarea = document.createElement('textarea')
        document.body.appendChild(textarea)
        act(() => {
            textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageUp', bubbles: true }))
        })
        expect(ref.current?.following).toBe(true)
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

        // 先用手势停止跟随，再触发 smooth 回到底部
        act(() => { wheel(el, -100) })
        expect(ref.current?.following).toBe(false)

        act(() => { ref.current?.stickToBottom('smooth') })
        expect(ref.current?.following).toBe(true)
        // 模拟动画中途的一次 scroll（位置远离底部）——门闩期间 onScroll 跳过，不掉队
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
