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
 * 手势归属判据：必须穿透 shadow DOM（事件路径给的就是完整路径），且要看方向余量。
 * 这两条正是「diff 能不能滚」反复出 bug 的两个点，逐条锁住。
 */

import { describe, it, expect } from 'vitest'
import { findScrollableInPath, type GestureAxis } from '@/ui/base/interactive/scrollableInPath'

function makeScroller(el: HTMLElement, axis: GestureAxis, { size, position, total }: { size: number; position: number; total: number }) {
    el.style[axis === 'x' ? 'overflowX' : 'overflowY'] = 'auto'
    if (axis === 'x') {
        Object.defineProperty(el, 'scrollWidth', { value: total, configurable: true })
        Object.defineProperty(el, 'clientWidth', { value: total - size, configurable: true })
        el.scrollLeft = position
    } else {
        Object.defineProperty(el, 'scrollHeight', { value: total, configurable: true })
        Object.defineProperty(el, 'clientHeight', { value: total - size, configurable: true })
        el.scrollTop = position
    }
    return el
}

/** 真实地拿一次 composedPath：判据消费的就是它 */
function pathOf(target: HTMLElement, type = 'touchmove'): EventTarget[] {
    let path: EventTarget[] = []
    const capture = (event: Event) => { path = event.composedPath() }
    document.addEventListener(type, capture)
    target.dispatchEvent(new Event(type, { bubbles: true, composed: true }))
    document.removeEventListener(type, capture)
    return path
}

describe('findScrollableInPath', () => {
    it('浅 DOM：有余量才算可滚，到头了不算（否则滚到头的容器会一直霸占手势）', () => {
        const box = document.createElement('div')
        document.body.appendChild(box)
        makeScroller(box, 'y', { size: 300, position: 100, total: 600 })
        const path = pathOf(box)

        expect(findScrollableInPath(path, 'y', -30)).toBe(box)  // 手指上滑，下方还有余量
        expect(findScrollableInPath(path, 'y', 30)).toBe(box)   // 手指下滑，上方还有余量

        box.scrollTop = 0
        expect(findScrollableInPath(path, 'y', 30)).toBeNull()  // 到顶了，下滑不该归它
        box.scrollTop = 300
        expect(findScrollableInPath(path, 'y', -30)).toBeNull() // 到底了，上滑不该归它
    })

    it('穿透 shadow DOM：影子里的滚动区同样是「落点路径上的滚动区」', () => {
        const host = document.createElement('div')
        document.body.appendChild(host)
        const shadow = host.attachShadow({ mode: 'open' })
        const inner = document.createElement('div')
        shadow.appendChild(inner)
        makeScroller(inner, 'x', { size: 300, position: 0, total: 1500 })

        // 浅 DOM 侧只能看到宿主，宿主自己不可滚（overflow 默认 visible）
        expect(findScrollableInPath([host, document.body], 'x', -40)).toBeNull()
        expect(findScrollableInPath(pathOf(inner), 'x', -40)).toBe(inner)
    })

    it('overflow 关着的元素不算，stopAt 之外不看', () => {
        const outer = document.createElement('div')
        const inner = document.createElement('div')
        outer.appendChild(inner)
        document.body.appendChild(outer)
        makeScroller(inner, 'y', { size: 300, position: 100, total: 600 })
        inner.style.overflowY = 'hidden'

        const path = pathOf(inner)
        expect(findScrollableInPath(path, 'y', -30)).toBeNull()

        inner.style.overflowY = 'auto'
        expect(findScrollableInPath(path, 'y', -30, inner)).toBe(inner)
        expect(findScrollableInPath(path, 'y', -30, outer)).toBe(inner)
    })
})
