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
 * 手势归属的唯一判据：**沿着落点的事件路径，找在这个方向上还有余量的滚动容器**。
 *
 * 为什么必须走 `composedPath()` 而不是 `parentElement` 上溯：web component 的滚动区在
 * shadow root 里（pierre diff 的 `<code>`、终端视口……），浅 DOM 的祖先链上根本没有它——
 * 用 `parentElement` 判必然把它判成「这里没得滚」，于是手势被上层的 sheet 拖动或滚动锁吞掉。
 * `composedPath()` 是浏览器给的完整路径，**天然包含 shadow 内部与各级宿主**，
 * 一份判据同时覆盖浅 DOM 与 shadow DOM。
 *
 * 方向语义与「手指往哪走」一致：delta > 0 表示手指往正方向（下 / 右）走，此时内容
 * 要往上 / 左走，所以要求容器还有**上方 / 左方**的余量（`scrollTop > 0` / `scrollLeft > 0`）；
 * delta < 0 反之。只看「能不能滚」而不看「往哪滚」，会让已经滚到头的容器继续霸占手势。
 */

export type GestureAxis = 'x' | 'y'

/** 元素在这个方向上还有余量可滚吗（overflow 关着的不算） */
function hasResidue(el: HTMLElement, axis: GestureAxis, delta: number): boolean {
    const style = getComputedStyle(el)
    const overflow = axis === 'x' ? style.overflowX : style.overflowY
    if (overflow === 'visible' || overflow === 'hidden') return false
    const size = axis === 'x' ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight
    if (size <= 1) return false
    const position = axis === 'x' ? el.scrollLeft : el.scrollTop
    return delta > 0 ? position > 0 : position < size
}

/**
 * 事件路径上第一个「在这个方向上还能滚」的容器；没有就返回 null（= 手势该归上层）。
 * `stopAt` 是上界（含它自己）——sheet 传自己的内容区，越过内容区就不是「内容里的滚动区」了。
 */
export function findScrollableInPath(
    path: readonly EventTarget[],
    axis: GestureAxis,
    delta: number,
    stopAt?: Element | null,
): HTMLElement | null {
    for (const node of path) {
        if (!(node instanceof HTMLElement)) continue
        if (hasResidue(node, axis, delta)) return node
        if (stopAt && node === stopAt) break
    }
    return null
}
