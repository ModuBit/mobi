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
 * useSmoothStickBottom 规格：小容器（如 thinking 内容盒）的缓动贴底。
 * ResizeObserver 观测内容盒高度 → 增高即启动缓动追赶（同 useStickToBottom 的
 * CHASE 参数）；外部程序改 scrollTop → 中止让位；enabled=false 不动作。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { cleanup, render } from '@testing-library/react'
import { useRef, type ReactElement } from 'react'
import { useSmoothStickBottom } from '@/components/chat/useSmoothStickBottom'

let rafMap: Map<number, FrameRequestCallback>
let rafSeq: number

// jsdom 无 ResizeObserver：可手动泵回调的桩（记录 observe 的目标）
type ROCallback = (entries: unknown[]) => void
let roCallback: ROCallback | null = null
let roObservedTargets: Element[] = []
class FakeResizeObserver {
    constructor(cb: ROCallback) {
        roCallback = cb
    }
    observe(target: Element): void { roObservedTargets.push(target) }
    unobserve(): void {}
    disconnect(): void {}
}

beforeEach(() => {
    rafMap = new Map()
    rafSeq = 1
    roCallback = null
    roObservedTargets = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
        const id = rafSeq++
        rafMap.set(id, cb)
        return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
        rafMap.delete(id)
    })
    vi.stubGlobal('ResizeObserver', FakeResizeObserver as unknown as typeof ResizeObserver)
})

afterEach(() => {
    cleanup()
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
})

function stepFrames(n = 1) {
    for (let i = 0; i < n; i++) {
        const pending = [...rafMap.values()]
        rafMap.clear()
        act(() => {
            for (const cb of pending) cb(performance.now())
        })
    }
}

/** 模拟内容增高：改 scrollHeight 后触发 RO 回调 */
function growContent(el: HTMLElement & { _setScrollHeight?: (v: number) => void }, to: number) {
    el._setScrollHeight?.(to)
    act(() => { roCallback?.([]) })
}

/** jsdom 几何恒 0，伪造滚动容器 */
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
            },
        },
    }) as PropertyDescriptorMap
    // 挂到元素上供 growContent 使用（defineProperties 后附加普通属性不受影响）
    ;(el as HTMLElement & { _setScrollHeight?: (v: number) => void })._setScrollHeight =
        (v: number) => { scrollHeight = v }
    document.body.appendChild(el)
    return el
}

function renderProbe(el: HTMLElement, enabled: boolean) {
    function Probe() {
        const ref = useRef<HTMLDivElement>(null)
        // 首帧把 el 交给 hook
        ;(ref as { current: HTMLDivElement | null }).current = el
        useSmoothStickBottom(ref, enabled)
        return null
    }
    return render(<Probe />)
}

describe('useSmoothStickBottom — 小容器缓动贴底', () => {
    it('RO 观测到增高 → 缓动追赶到底（首帧部分推进，非瞬跳），多帧精确贴底', () => {
        const el = makeScroller({ scrollHeight: 1000, clientHeight: 200, scrollTop: 0 })
        renderProbe(el, true)

        stepFrames(1) // 排掉 mount 时可能的首帧
        growContent(el, 1000)
        stepFrames(1)
        expect(el.scrollTop).toBeGreaterThan(0)
        expect(el.scrollTop).toBeLessThan(800)
        stepFrames(40)
        expect(el.scrollTop).toBe(800)
    })

    it('揭示期持续增高（追赶收敛后 RO 再触发）→ 续追新高度（回归：trigger=快照粒度时快照间隔内的增长无人跟随）', () => {
        const el = makeScroller({ scrollHeight: 1000, clientHeight: 200, scrollTop: 0 })
        renderProbe(el, true)

        growContent(el, 1000)
        stepFrames(40)
        expect(el.scrollTop).toBe(800) // 第一轮收敛精确贴底

        // 模拟逐字揭示的后续增高：不经过任何 props 变化，纯 DOM + RO
        growContent(el, 1100)
        stepFrames(1)
        expect(el.scrollTop).toBeGreaterThan(800)
        stepFrames(40)
        expect(el.scrollTop).toBe(900)
    })

    it('追赶进行中 RO 再触发 → 不重复启动循环（单循环独占滚动写入）', () => {
        const el = makeScroller({ scrollHeight: 1000, clientHeight: 200, scrollTop: 0 })
        renderProbe(el, true)

        growContent(el, 1000)
        stepFrames(1)
        const inFlight = rafMap.size
        expect(inFlight).toBeGreaterThan(0)
        growContent(el, 1200) // 循环在飞时的 RO 触发
        expect(rafMap.size).toBe(inFlight) // 未新增排队的帧
        stepFrames(40)
        expect(el.scrollTop).toBe(1000) // 收敛后由在飞循环覆盖到最新几何
    })

    it('外部程序改 scrollTop → 中止让位（不被拉回）', () => {
        const el = makeScroller({ scrollHeight: 1000, clientHeight: 200, scrollTop: 0 })
        renderProbe(el, true)
        growContent(el, 1000)
        stepFrames(2)
        expect(el.scrollTop).toBeGreaterThan(0)

        act(() => { el.scrollTop = 100 }) // 外部干预
        stepFrames(10)
        expect(el.scrollTop).toBe(100)
    })

    it('enabled=false → 不启动', () => {
        const el = makeScroller({ scrollHeight: 1000, clientHeight: 200, scrollTop: 0 })
        renderProbe(el, false)
        growContent(el, 1000)
        stepFrames(10)
        expect(el.scrollTop).toBe(0)
        expect(rafMap.size).toBe(0)
    })

    it('追赶进行中 enabled 翻 false → 下一帧停追（契约：禁用即不动作，不含在飞的 rAF）', () => {
        const el = makeScroller({ scrollHeight: 1000, clientHeight: 200, scrollTop: 0 })
        const { rerender } = renderProbe(el, true)
        growContent(el, 1000)
        stepFrames(2)
        const mid = el.scrollTop
        expect(mid).toBeGreaterThan(0)

        rerender(<ProbeEnabled el={el} enabled={false} />)
        stepFrames(20)
        // 已排队的帧循环须被禁用守卫拦下，不得继续把容器拉到底
        expect(el.scrollTop).toBe(mid)
    })
})

function ProbeEnabled({ el, enabled }: { el: HTMLDivElement; enabled: boolean }) {
    const ref = useRef<HTMLDivElement>(null)
    ;(ref as { current: HTMLDivElement | null }).current = el
    useSmoothStickBottom(ref, enabled)
    return null
}

describe('useSmoothStickBottom — 观测目标（maxHeight 固定容器场景）', () => {
    it('提供 observeRef 时观测内层内容元素而非滚动容器——容器被 maxHeight 固定后 border-box 恒定、RO 静默，只有内容元素的高度信号能驱动续追（回归：思考内容超 200px 后不再贴底）', () => {
        const scroller = makeScroller({ scrollHeight: 1000, clientHeight: 200, scrollTop: 0 })
        const inner = document.createElement('div')
        scroller.appendChild(inner)

        function Probe() {
            const scrollerRef = useRef<HTMLDivElement>(null)
            const innerRef = useRef<HTMLDivElement>(null)
            ;(scrollerRef as { current: null }).current = scroller
            ;(innerRef as { current: null }).current = inner
            useSmoothStickBottom(scrollerRef, true, { observeRef: innerRef })
            return null
        }
        render(<Probe />)

        expect(roObservedTargets.length).toBeGreaterThan(0)
        expect(roObservedTargets).toContain(inner)
        expect(roObservedTargets).not.toContain(scroller)
    })
})
