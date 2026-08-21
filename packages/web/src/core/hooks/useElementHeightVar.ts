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

import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * 把 ref 元素的实时高度同步为**其父容器**上的 CSS 变量。
 *
 * 用途：浮层（Composer / GlassHeader）高度可变（附件展开、排队条、换行），
 * 滚动区需要 padding 让位但无法预知高度。ResizeObserver 自动跟随，全程零手动测量。
 *
 * 使用 useLayoutEffect 而非 useEffect：首帧绘制前同步写入变量，
 * 消除「先渲染一帧无 padding、再跳变」的闪动（本项目纯 SPA，SSR 警告不适用）。
 *
 * 元素身份追踪：RefObject 对象引用恒不变，直接进 effect 依赖无法感知 ref.current
 * 换指向。当调用方因条件分支切换（如 ChatPane 的移动端↔桌面端 isMobile 分支）导致
 * ref.current 指向新 DOM 节点时，必须重挂 ResizeObserver 到新节点、把变量写到新父容器，
 * 否则 observer 仍观察已脱离文档的旧节点，新分支的滚动区让位失效。
 *
 * @param ref 目标元素（高度来源）
 * @param varName CSS 变量名，如 '--composer-h'
 */
export function useElementHeightVar(ref: RefObject<HTMLElement | null>, varName: string): void {
    // 用 state 承载真实元素身份：RefObject 引用恒不变不能进依赖，
    // 只有经过 setEl 的身份比对才能让下方 effect 在元素切换时重跑
    const [el, setEl] = useState<HTMLElement | null>(null)
    // 每次渲染后比对 ref.current：条件分支切换导致 ref 指向新节点时，
    // 经 setEl 触发下方 effect 重挂 ResizeObserver（函数式更新保证身份未变时不重渲染）
    useLayoutEffect(() => {
        setEl(prev => (prev === ref.current ? prev : ref.current))
    })
    useLayoutEffect(() => {
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
    }, [el, varName])
}
