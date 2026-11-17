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
import { useChatViewport, type ChatViewport } from '@/features/chat/useChatViewport'

/** rAF 手动桩：平滑追赶逐帧驱动（jsdom rAF 时序不可控） */
let rafMap: Map<number, FrameRequestCallback>
let rafSeq: number

/** ResizeObserver 替身：模块的单一 RO，暴露 trigger() 手动触发内容增高信号 */
class FakeResizeObserver {
    static instances: FakeResizeObserver[] = []
    constructor(private cb: ResizeObserverCallback) {
        FakeResizeObserver.instances.push(this)
    }
    observe() { /* 不依赖真实布局 */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
    trigger() { this.cb([], this as unknown as ResizeObserver) }
}

/**
 * 伪造滚动容器：可写 scrollHeight/scrollTop、scrollTop 赋值同步派发 scroll（对齐浏览器），
 * 内含内容层 `.ant-bubble-list-scroll-content`（模块 RO 观测目标）。
 */
function makeScroller(opts: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
    const el = document.createElement('div')
    let scrollTop = opts.scrollTop
    let scrollHeight = opts.scrollHeight
    Object.defineProperties(el, {
        clientHeight: { get: () => opts.clientHeight },
        scrollHeight: { get: () => scrollHeight, set: (v: number) => { scrollHeight = v } },
        scrollTop: {
            get: () => scrollTop,
            set: (v: number) => {
                if (v === scrollTop) return
                scrollTop = v
                el.dispatchEvent(new Event('scroll'))
            },
        },
    })
    el.scrollTo = ((arg: ScrollToOptions) => { el.scrollTop = arg.top ?? 0 }) as typeof el.scrollTo
    const content = document.createElement('div')
    content.className = 'ant-bubble-list-scroll-content'
    el.appendChild(content)
    document.body.appendChild(el)
    return { el, content, setScrollHeight: (v: number) => { scrollHeight = v } }
}

/** 在内容层挂真实可查找的 bubble 节点（锚点采集用 data-bubble-key 定位） */
function addBubbles(content: HTMLElement, keys: string[]): HTMLElement[] {
    return keys.map((key) => {
        const b = document.createElement('div')
        b.dataset.bubbleKey = key
        content.appendChild(b)
        return b
    })
}

/** 挂载 hook 并把 controller 暴露出来；attach 在渲染期调用（对齐组件的 layout effect 时机） */
function renderViewport(scroller: HTMLElement, enabled = true) {
    const ref: { current: ChatViewport | null } = { current: null }
    const onSettled = vi.fn()
    function Probe({ on }: { on: boolean }) {
        const vp = useChatViewport(on, { onSettled })
        ref.current = vp
        vp.attach(scroller)
        return null
    }
    const utils = render(<Probe on={enabled} />)
    return { ref, onSettled, ...utils, Probe }
}

/** 推进 n 个 rAF 帧（触发当前 pending 的回调，不含其内新调度的） */
function stepFrames(n = 1) {
    for (let i = 0; i < n; i++) {
        const pending = [...rafMap.values()]
        rafMap.clear()
        act(() => {
            for (const cb of pending) cb(performance.now())
        })
    }
}

const origRO = globalThis.ResizeObserver
const origRect = Element.prototype.getBoundingClientRect
const origSupports = CSS.supports

beforeEach(() => {
    FakeResizeObserver.instances = []
    globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
    // jsdom 无原生 anchoring 语义时模块会走末尾项兜底；固定为「有 anchoring」（Chrome）以测主路径
    CSS.supports = () => true
    rafMap = new Map()
    rafSeq = 1
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        const id = rafSeq++
        rafMap.set(id, cb)
        return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        rafMap.delete(id)
    })
})

afterEach(() => {
    cleanup()
    globalThis.ResizeObserver = origRO
    Element.prototype.getBoundingClientRect = origRect
    CSS.supports = origSupports
    document.body.innerHTML = ''
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

/**
 * 伪造元素几何：bubble 按 key 查表（tops），其余元素恒 0（容器顶 = 0）。
 * 锚点补偿读 rect.top/bottom，必须让「前插后锚点整体下移」可观测。
 */
function mockTops(tops: Map<string, number>, height = 100) {
    Element.prototype.getBoundingClientRect = function (this: HTMLElement) {
        const key = this.dataset?.bubbleKey
        const top = key ? (tops.get(key) ?? 0) : 0
        return { top, bottom: top + height, left: 0, right: 600, width: 600, height, x: 0, y: top, toJSON: () => ({}) } as DOMRect
    }
}

describe('useChatViewport — 内容增高的互斥分派', () => {
    it('跟随中：内容增高走平滑追赶，多帧逼近精确底部（不瞬跳）', () => {
        const { el, setScrollHeight } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        const { ref } = renderViewport(el)
        expect(ref.current?.reading).toBe(false)

        setScrollHeight(3000)
        act(() => { FakeResizeObserver.instances[0].trigger() })
        // 帧 1 = RO rAF（分派 + 调度追赶），帧 2 起追赶推进
        stepFrames(2)
        expect(el.scrollTop).toBeGreaterThan(500)
        expect(el.scrollTop).toBeLessThan(2500)

        stepFrames(60)
        expect(el.scrollTop).toBe(2500)
    })

    it('阅读中：内容增高走锚点补偿，锚点视口位置保持不动（不追赶）', () => {
        const { el, content, setScrollHeight } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
        addBubbles(content, ['k0', 'k1', 'k2'])
        const tops = new Map([['k0', 0], ['k1', 100], ['k2', 200]])
        mockTops(tops)
        const { ref } = renderViewport(el)

        // 建立基线快照（组件的 items 变化 layout effect 等价调用）
        act(() => { ref.current?.notifyLayoutChanged() })
        // 用户上滚阅读历史
        act(() => { el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })) })
        expect(ref.current?.reading).toBe(true)

        // 前插更旧内容：原 k0/k1/k2 整体下移 300，内容层变高
        tops.set('k0', 300); tops.set('k1', 400); tops.set('k2', 500)
        setScrollHeight(1300)
        act(() => { FakeResizeObserver.instances[0].trigger() })
        stepFrames(1)
        // 残差 +300 → scrollTop 补 300，用户看到的 k0 留在原位置
        expect(el.scrollTop).toBe(300)
    })

    it('阅读中：内容变化与用户滚动同帧时，用户滚动量不被当成插入量补偿（不推回用户）', () => {
        const { el, content, setScrollHeight } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        addBubbles(content, ['k0', 'k1'])
        const tops = new Map([['k0', 400], ['k1', 500]])
        mockTops(tops)
        const { ref } = renderViewport(el)
        ref.current?.captureViewportNow()

        // 用户上滚阅读历史
        act(() => { el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true })) })
        expect(ref.current?.reading).toBe(true)

        // 同一帧：上方前插 300（原生 anchoring 把 scrollTop 补 +300）+ 用户又上滚 50
        // → 净 scrollTop +250、锚点只随用户滚动下移 50
        tops.set('k0', 450); tops.set('k1', 550)
        setScrollHeight(1300)
        act(() => { el.scrollTop = 750 })

        // 内容变化的 RO 信号随后到达：残差必须为 0（用户滚动的 50 不是插入量）
        act(() => { FakeResizeObserver.instances[0].trigger() })
        stepFrames(1)
        expect(el.scrollTop).toBe(750)
    })

    it('跟随中即使锚点位移也不补偿（钉底由追赶独占，两路互斥）', () => {
        const { el, content, setScrollHeight } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        addBubbles(content, ['k0', 'k1'])
        const tops = new Map([['k0', 0], ['k1', 100]])
        mockTops(tops)
        renderViewport(el)

        // 内容增高 + 上方内容位移（模拟工具卡展开等）
        tops.set('k0', 300); tops.set('k1', 400)
        setScrollHeight(3000)
        act(() => { FakeResizeObserver.instances[0].trigger() })
        stepFrames(60)
        // 结束状态 = 精确底部（补偿未参与）
        expect(el.scrollTop).toBe(2500)
    })
})

describe('useChatViewport — 结算窗口', () => {
    it('notifyLayoutChanged 进入结算窗口，窗口结束回调 onSettled 交还判定权', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 0 })
        const { ref, onSettled } = renderViewport(el)

        expect(ref.current?.isSettling()).toBe(false)
        act(() => { ref.current?.notifyLayoutChanged() })
        expect(ref.current?.isSettling()).toBe(true)
        expect(onSettled).not.toHaveBeenCalled()

        act(() => { vi.advanceTimersByTime(150) })
        expect(ref.current?.isSettling()).toBe(false)
        expect(onSettled).toHaveBeenCalledTimes(1)
    })

    it('enabled=false 时内容增高信号不动作', () => {
        const { el, setScrollHeight } = makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 })
        renderViewport(el, false)
        setScrollHeight(3000)
        act(() => { FakeResizeObserver.instances[0]?.trigger() })
        stepFrames(5)
        expect(el.scrollTop).toBe(500)
    })
})
