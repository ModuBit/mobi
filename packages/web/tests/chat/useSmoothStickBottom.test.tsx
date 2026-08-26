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
 * trigger 变化（流式内容增长）→ 启动缓动追赶（同 useStickToBottom 的 CHASE 参数）；
 * 外部程序改 scrollTop → 中止让位；enabled=false 不动作。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { cleanup, render } from '@testing-library/react'
import { useRef, type ReactElement } from 'react'
import { useSmoothStickBottom } from '@/components/chat/useSmoothStickBottom'

let rafMap: Map<number, FrameRequestCallback>
let rafSeq: number

beforeEach(() => {
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
    })
    document.body.appendChild(el)
    return { el, setScrollHeight: (v: number) => { scrollHeight = v } }
}

function renderProbe(el: HTMLElement, trigger: string, enabled: boolean) {
    function Probe() {
        const ref = useRef<HTMLDivElement>(null)
        // 首帧把 el 交给 hook
        ;(ref as { current: HTMLDivElement | null }).current = el
        useSmoothStickBottom(ref, trigger, enabled)
        return null
    }
    return render(<Probe />)
}

describe('useSmoothStickBottom — 小容器缓动贴底', () => {
    it('trigger 变化 → 缓动追赶到底（首帧部分推进，非瞬跳），多帧精确贴底', () => {
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 200, scrollTop: 0 })
        const { rerender } = renderProbe(el, 'a', true)

        // 内容增长（trigger 变化）
        el.scrollHeight = 1000
        rerenderProbe(rerender, el, 'b', true)
        stepFrames(1)
        expect(el.scrollTop).toBeGreaterThan(0)
        expect(el.scrollTop).toBeLessThan(800)
        stepFrames(40)
        expect(el.scrollTop).toBe(800)
    })

    it('外部程序改 scrollTop → 中止让位（不被拉回）', () => {
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 200, scrollTop: 0 })
        const { rerender } = renderProbe(el, 'a', true)
        rerenderProbe(rerender, el, 'b', true)
        stepFrames(2)
        expect(el.scrollTop).toBeGreaterThan(0)

        act(() => { el.scrollTop = 100 }) // 外部干预
        stepFrames(10)
        expect(el.scrollTop).toBe(100)
    })

    it('enabled=false → 不启动', () => {
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 200, scrollTop: 0 })
        const { rerender } = renderProbe(el, 'a', false)
        rerenderProbe(rerender, el, 'b', false)
        stepFrames(10)
        expect(el.scrollTop).toBe(0)
        expect(rafMap.size).toBe(0)
    })

    it('追赶进行中 enabled 翻 false → 下一帧停追（契约：禁用即不动作，不含在飞的 rAF）', () => {
        const { el } = makeScroller({ scrollHeight: 1000, clientHeight: 200, scrollTop: 0 })
        const { rerender } = renderProbe(el, 'a', true)
        rerenderProbe(rerender, el, 'b', true)
        stepFrames(2)
        const mid = el.scrollTop
        expect(mid).toBeGreaterThan(0)

        rerenderProbe(rerender, el, 'c', false)
        stepFrames(20)
        // 已排队的帧循环须被禁用守卫拦下，不得继续把容器拉到底
        expect(el.scrollTop).toBe(mid)
    })
})

// rerender 辅助：重新渲染 Probe（保持组件实例）
function rerenderProbe(
    rerender: (ui: ReactElement) => void,
    el: HTMLElement,
    trigger: string,
    enabled: boolean,
) {
    function Probe() {
        const ref = useRef<HTMLDivElement>(null)
        ;(ref as { current: HTMLDivElement | null }).current = el
        useSmoothStickBottom(ref, trigger, enabled)
        return null
    }
    rerender(<Probe />)
}
