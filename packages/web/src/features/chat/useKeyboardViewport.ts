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

import { useSyncExternalStore } from 'react'

/** 键盘视为弹出的最小 inset（px）：真机键盘高度 ≥150，URL 栏伸缩的抖动远小于此 */
const KEYBOARD_INSET_THRESHOLD = 80

export interface KeyboardViewport {
    /** 相对完整视口的键盘高度（基线 − 可视高）：「键盘是否弹出」的判定与 ghost 隐藏判据 */
    keyboardInset: number
    /** 当前 layout viewport 内被键盘占据的高度（innerHeight − 可视高）：fixed 元素的
     *  bottom 补偿——resize 模式下它 ≈ 0（layout viewport 已缩到键盘上方），iOS 模型下
     *  ≈ keyboardInset，直接用 keyboardInset 会在 Android 上把浮层抬出屏幕 */
    layoutInset: number
}

/**
 * 虚拟键盘占据底部的高度（0 = 键盘未弹出/无 visualViewport）。
 *
 * 关键陷阱（2026-09-23 真机实测）：Android resize 模式下 **layout viewport 本身缩到
 * 键盘上方**，innerHeight 已变小且 ≈ vv.height，`innerHeight − vv` 恒为 0——键盘
 * 测不出来。基线必须用**历史最大可视高度**：inset = 基线 − 当前可视高度。
 *
 * 基线跟随策略（棘轮教训）：基线**只升不降不可行**——桌面浏览器缩放恢复、移动端
 * URL 栏展开回落都是「innerHeight 变小 ≥ 阈值」的环境变化，会被永久误判为键盘。
 * 键盘与环境的唯一可靠区别是**焦点**：键盘只因输入焦点而弹出。故焦点在可编辑元素
 * 时基线只上调（保留键盘弹出前的最大值），无焦点时基线双向跟随当前环境（棘轮可逆）。
 * 焦点事件先于键盘 resize（键盘因焦点而弹），update 触发时判据已就位。
 *
 * visualViewport 的 scroll/resize 在移动端滚动、地址栏伸缩、捏合缩放期间连发，
 * 而键盘值只在跨越阈值时才变——store 写入前做值比对，值未变不通知订阅者。
 *
 * 双源模式（2026-10-31 键盘平滑动画）：
 * - **overlay 模式**（index.html 早期脚本对支持面浏览器设 overlaysContent=true，Android
 *   Chrome/PWA）：浏览器不再收缩视口，键盘浮在内容上，布局经 env(keyboard-inset-height)
 *   逐帧跟随键盘动画。此模式下 vv 不收缩 → 下方 vv 数学恒读 0，inset 改源
 *   geometrychange.boundingRect（键盘几何的逐帧权威值）。**不走 vv 路径的 80px 阈值**——
 *   阈值会把逐帧中间值砍成 0/终值两档，腾出空间的动画就被掐死；boundingRect 无噪声问题。
 *   layoutInset = keyboardInset（overlay 语义同 iOS 模型：fixed 元素全额补偿）。
 * - **vv 模式**（无 VirtualKeyboard API：iOS/Firefox）：既有 resizes-content/视觉视口
 *   数学原样保留，行为与历史一致。
 *
 * 外部 store + selector 订阅（code-review 2026-10-31）：overlay 模式下 inset 逐帧变化，
 * 若整页组件（ChatContainer）经 hook state 承接就会全页逐帧重渲染，平滑跟随被渲染成本
 * 吃掉。改为模块级 store，消费方按需订阅派生原值——页级组件只订 `inset > 0` 布尔
 * （整个键盘周期重渲染 2 次），键盘逐帧跟随只剩 QuoteCommentInput 这类小浮层承担。
 */
/** VirtualKeyboard API 形状子集（lib.dom 未收录，只取消费面） */
interface VirtualKeyboardLike {
    /** overlay 模式开关（index.html 早期脚本设 true）；分支判定读它而非 API 存在性 */
    overlaysContent: boolean
    boundingRect: { height: number }
    addEventListener(type: 'geometrychange', listener: () => void): void
    removeEventListener(type: 'geometrychange', listener: () => void): void
}
/** 当前焦点是否在可编辑元素（键盘弹出的前提；INPUT/TEXTAREA/contenteditable 覆盖全部输入面） */
function isEditableFocus(): boolean {
    const el = document.activeElement
    if (!(el instanceof HTMLElement)) return false
    return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
}

// ── 模块级单源 store（全局唯一键盘几何；事件监听按订阅者计数启停） ─────────────

let storeState: KeyboardViewport = { keyboardInset: 0, layoutInset: 0 }
const storeListeners = new Set<() => void>()
/** 当前事件监听的拆除器（watcher 启停单源；null = 未挂监听） */
let stopWatchers: (() => void) | null = null
let watcherRefs = 0

function storeUpdate(next: KeyboardViewport): void {
    if (next.keyboardInset === storeState.keyboardInset && next.layoutInset === storeState.layoutInset) return
    storeState = next
    for (const listener of storeListeners) listener()
}

function storeSubscribe(listener: () => void): () => void {
    storeListeners.add(listener)
    watcherRefs += 1
    if (watcherRefs === 1) stopWatchers = startWatchers()
    return () => {
        storeListeners.delete(listener)
        watcherRefs -= 1
        if (watcherRefs === 0 && stopWatchers) {
            stopWatchers()
            stopWatchers = null
        }
    }
}

/** 装事件监听（首个订阅者时一次）；返回拆除器。双源判定见顶部说明 */
function startWatchers(): () => void {
    // overlay 模式判定读真实 flag（与 index.html 早期脚本、CSS 的 env() 消费同一权威值）：
    // 只判 API 存在会在「带 API 但未开 overlay」的浏览器上走 geometrychange 源、
    // 而浏览器仍在收缩视口——双源各错一半且无报错
    const vk = (navigator as { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard
    if (vk?.overlaysContent === true) {
        const update = () => {
            const height = Math.max(0, Math.round(vk.boundingRect.height))
            // 两字段恒等写入（overlay 语义），单值比对即可
            storeUpdate({ keyboardInset: height, layoutInset: height })
        }
        update()
        vk.addEventListener('geometrychange', update)
        return () => vk.removeEventListener('geometrychange', update)
    }

    const vv = window.visualViewport
    if (!vv) return () => {}
    const baselineRef = { current: 0 }
    const update = () => {
        baselineRef.current = isEditableFocus()
            ? Math.max(baselineRef.current, window.innerHeight)
            : window.innerHeight
        const visible = Math.min(window.innerHeight, vv.offsetTop + vv.height)
        const inset = Math.max(0, Math.round(baselineRef.current - visible))
        const keyboardInset = inset >= KEYBOARD_INSET_THRESHOLD ? inset : 0
        const layoutInset = keyboardInset > 0 ? Math.max(0, Math.round(window.innerHeight - visible)) : 0
        storeUpdate({ keyboardInset, layoutInset })
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
        vv.removeEventListener('resize', update)
        vv.removeEventListener('scroll', update)
    }
}

/**
 * 按 selector 订阅键盘几何的切片。**selector 必须返回原始值**（useSyncExternalStore
 * 按 Object.is 判重渲染，返回新建对象会无限循环）。
 *
 * 典型用法：页级组件订 `s.keyboardInset > 0`（布尔，键盘周期只翻转 2 次）；
 * 键盘跟随浮层（引用评论输入）订数值本身（逐帧跟随动画）。
 */
export function useKeyboardViewportSelector<T>(selector: (state: KeyboardViewport) => T): T {
    return useSyncExternalStore(storeSubscribe, () => selector(storeState))
}

/** 测试专用：归零模块 store（store 跨测试存活，用例间隔离用） */
export function resetKeyboardViewportForTests(): void {
    storeState = { keyboardInset: 0, layoutInset: 0 }
}
