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

import { useEffect, useState } from 'react'

/** 键盘视为弹出的最小 inset（px）：真机键盘高度 ≥150，URL 栏伸缩的抖动远小于此 */
const KEYBOARD_INSET_THRESHOLD = 80

/**
 * 虚拟键盘占据底部的高度（layout viewport 坐标系；0 = 键盘未弹出/无 visualViewport）。
 *
 * Android resize 模式下 layout viewport 缩到键盘上方（innerHeight 变小），iOS layout
 * viewport 不变而 visualViewport 缩小——两种模型下「键盘上缘」统一为
 * `vv.offsetTop + vv.height`，inset = innerHeight − 键盘上缘。
 *
 * 消费方：引用评论浮层的键盘跟随定位（QuoteCommentInput）、SelectionGhost 的键盘隐藏
 * （ChatContainer）——fixed/冻结坐标在视口被键盘压缩后全部失效，必须感知 inset 补偿。
 */
export function useKeyboardInset(): number {
    const [inset, setInset] = useState(0)

    useEffect(() => {
        const vv = window.visualViewport
        if (!vv) return
        const update = () => {
            setInset(Math.max(0, Math.round(window.innerHeight - (vv.offsetTop + vv.height))))
        }
        update()
        vv.addEventListener('resize', update)
        vv.addEventListener('scroll', update)
        return () => {
            vv.removeEventListener('resize', update)
            vv.removeEventListener('scroll', update)
        }
    }, [])

    return inset >= KEYBOARD_INSET_THRESHOLD ? inset : 0
}
