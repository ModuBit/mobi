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

import { useEffect, useRef, useState } from 'react'

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
 * 而键盘值只在跨越阈值时才变——setState 前做值比对，值未变复用旧对象（React
 * 按 Object.is 判等跳过重渲染），避免每次事件都全量重渲染挂载方（ChatContainer）。
 */
/** 当前焦点是否在可编辑元素（键盘弹出的前提；INPUT/TEXTAREA/contenteditable 覆盖全部输入面） */
function isEditableFocus(): boolean {
    const el = document.activeElement
    if (!(el instanceof HTMLElement)) return false
    return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
}

export function useKeyboardViewport(): KeyboardViewport {
    const [state, setState] = useState<KeyboardViewport>({ keyboardInset: 0, layoutInset: 0 })
    const baselineRef = useRef(0)

    useEffect(() => {
        const vv = window.visualViewport
        if (!vv) return
        const update = () => {
            baselineRef.current = isEditableFocus()
                ? Math.max(baselineRef.current, window.innerHeight)
                : window.innerHeight
            const visible = Math.min(window.innerHeight, vv.offsetTop + vv.height)
            const inset = Math.max(0, Math.round(baselineRef.current - visible))
            const keyboardInset = inset >= KEYBOARD_INSET_THRESHOLD ? inset : 0
            const layoutInset = keyboardInset > 0 ? Math.max(0, Math.round(window.innerHeight - visible)) : 0
            setState(prev => prev.keyboardInset === keyboardInset && prev.layoutInset === layoutInset
                ? prev
                : { keyboardInset, layoutInset })
        }
        update()
        vv.addEventListener('resize', update)
        vv.addEventListener('scroll', update)
        return () => {
            vv.removeEventListener('resize', update)
            vv.removeEventListener('scroll', update)
        }
    }, [])

    return state
}
