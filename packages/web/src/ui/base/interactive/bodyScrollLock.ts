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
 * 弹层期间锁住背景滚动——**用钉住 body 的方式，绝不拦 touch 事件**。
 *
 * 为什么自己写而不用 react-remove-scroll（Radix Dialog 默认带的那个）：它靠一条
 * **document 级、非 passive 的 touchmove** + `preventDefault` 来达到目的，而它的判据
 * 只沿浅 DOM 的 `parentNode` 找可滚祖先——shadow DOM 里的滚动区（pierre diff 的
 * `<code>`、终端视口……）它一概看不见，判成「无处可滚」就把整段手势 preventDefault。
 * 结果是一个纯 CSS 就能滚的组件被上层锁吞掉（2026-10-13 实测：同一个裸 pierre diff，
 * 放 sheet 里、放 sheet 外都拿到 `[true,true]`）。
 *
 * 钉 body（`position: fixed` + `top: -scrollY`）达到同样的「背景不许动」，
 * 却不碰任何触摸事件——谁能不能滚，交回浏览器按 CSS 自己判。
 *
 * 引用计数：嵌套 sheet 各自持有一份，最后一个释放时恢复原样式与滚动位置。
 */

let locks = 0
let savedStyle: string | null = null
let savedScrollY = 0

/** 上锁；返回释放函数（幂等，重复调用只释放一次） */
export function lockBodyScroll(): () => void {
    const body = document.body
    if (locks === 0) {
        savedStyle = body.getAttribute('style')
        savedScrollY = window.scrollY
        // 只在需要时写，其它内联样式原样保留
        body.style.position = 'fixed'
        body.style.top = `-${savedScrollY}px`
        body.style.left = '0'
        body.style.right = '0'
        body.style.width = '100%'
        body.style.overflow = 'hidden'
    }
    locks += 1
    let released = false
    return () => {
        if (released) return
        released = true
        locks -= 1
        if (locks > 0) return
        if (savedStyle === null) body.removeAttribute('style')
        else body.setAttribute('style', savedStyle)
        savedStyle = null
        window.scrollTo(0, savedScrollY)
    }
}

/** 仅测试用：把引用计数归零，避免用例之间互相污染 */
export function __resetBodyScrollLockForTest(): void {
    locks = 0
    savedStyle = null
    savedScrollY = 0
}
