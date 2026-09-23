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
 * See the specific language governing permissions and
 * limitations under the License.
 */

import { useEffect, useRef, useState } from 'react'

/** 键盘视为弹出的最小 inset（px）：真机键盘高度 ≥150，URL 栏伸缩的抖动远小于此 */
const KEYBOARD_INSET_THRESHOLD = 80

/**
 * 虚拟键盘占据底部的高度（0 = 键盘未弹出/无 visualViewport）。
 *
 * 关键陷阱（2026-09-23 真机实测）：Android resize 模式下 **layout viewport 本身缩到
 * 键盘上方**，innerHeight 已变小且 ≈ vv.height，`innerHeight − vv` 恒为 0——键盘
 * 测不出来。基线必须用**历史最大可视高度**（ref 跟踪，旋转/URL 栏收起时上调，
 * 键盘弹出这类「变小」不下调）：inset = 基线 − 当前可视高度。
 */
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
 * 测不出来。基线必须用**历史最大可视高度**（ref 跟踪，旋转/URL 栏收起时上调，
 * 键盘弹出这类「变小」不下调）：inset = 基线 − 当前可视高度。
 */
export function useKeyboardViewport(): KeyboardViewport {
    const [state, setState] = useState<KeyboardViewport>({ keyboardInset: 0, layoutInset: 0 })
    const baselineRef = useRef(0)

    useEffect(() => {
        const vv = window.visualViewport
        if (!vv) return
        const update = () => {
            baselineRef.current = Math.max(baselineRef.current, window.innerHeight)
            const visible = Math.min(window.innerHeight, vv.offsetTop + vv.height)
            const inset = Math.max(0, Math.round(baselineRef.current - visible))
            const keyboardInset = inset >= KEYBOARD_INSET_THRESHOLD ? inset : 0
            setState({
                keyboardInset,
                // 键盘未弹出时恒 0，弹出时才做 bottom 补偿（避免 URL 栏抖动带来的漂移）
                layoutInset: keyboardInset > 0 ? Math.max(0, Math.round(window.innerHeight - visible)) : 0,
            })
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
