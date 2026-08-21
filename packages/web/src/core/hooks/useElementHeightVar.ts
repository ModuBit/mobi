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

import { useLayoutEffect, type RefObject } from 'react'

/**
 * 把 ref 元素的实时高度同步为**其父容器**上的 CSS 变量。
 *
 * 用途：浮层（Composer / GlassHeader）高度可变（附件展开、排队条、换行），
 * 滚动区需要 padding 让位但无法预知高度。ResizeObserver 自动跟随，全程零手动测量。
 *
 * 使用 useLayoutEffect 而非 useEffect：首帧绘制前同步写入变量，
 * 消除「先渲染一帧无 padding、再跳变」的闪动（本项目纯 SPA，SSR 警告不适用）。
 *
 * @param ref 目标元素（高度来源）
 * @param varName CSS 变量名，如 '--composer-h'
 */
export function useElementHeightVar(ref: RefObject<HTMLElement | null>, varName: string): void {
    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        const host = el.parentElement
        if (!host) return
        const apply = () => {
            host.style.setProperty(varName, `${el.offsetHeight}px`)
        }
        apply()
        const ro = new ResizeObserver(apply)
        ro.observe(el)
        return () => ro.disconnect()
    }, [ref, varName])
}
