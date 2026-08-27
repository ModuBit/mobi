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

import { useEffect, useRef, type RefObject } from 'react'
import { chaseStep } from './scrollChase'

/**
 * 小容器（如 thinking 内容盒）的缓动贴底。
 *
 * 与 useStickToBottom（主聊天列表）共用同一套追赶机制（{@link chaseStep}，
 * 含缓动数学/精确贴底/外部干预检测）：**ResizeObserver 观测高度信号源** →
 * 增高即启动 rAF 缓动追赶，替代 `scrollTop = scrollHeight` 硬跳（换行/增高时
 * 容器内容瞬跳一行，快输出下「一跳一跳」）。
 *
 * ## 为什么观测 DOM 而不是 React 参数作触发信号
 *
 * 内容盒里的 Markdown 逐字揭示（useStreamingContent）在 rAF 里 setState，DOM
 * 每帧增高——这些变化不经过组件 props。若以「流式 text」（SSE 快照粒度）为
 * 触发：追赶循环 ~130ms 收敛退出后到下一快照前（~300-500ms）新增的高度无人
 * 跟随，思考盒滞后数行后在快照瞬间跳追——正是本 hook 要消灭的「一跳一跳」
 * 在小容器上的残留。RO 与主列表 hook 的观测对象语义一致（主列表 RO 观测
 * `.ant-bubble-list-scroll-content`）。
 *
 * ## 为什么默认提供 observeRef（观测目标 ≠ 滚动容器）
 *
 * thinking 内容盒带 `maxHeight: 200`：内容不足时容器随内容增高、RO 有信号；
 * **一旦超过上限容器被 clamp 固定，border-box 恒定、RO 从此静默**——内容继续
 * 流式增长无人跟随，「思考多了就不贴底」。故须观测不受 maxHeight 约束的内层
 * 内容元素（其高度随 Markdown 每帧增长）。不传则退回观测滚动容器自身。
 *
 * 与主列表 hook 的差异：无跟随意图管理（手势/恢复跟随）——容器语义是
 * 「流式期间恒贴底」，与旧硬钉一致；但保留**外部干预让位**：每帧核对上次
 * 设置的 scrollTop，被外部改动（程序补偿/浏览器 clamp）即中止本轮追赶，
 * 下一次 RO 触发再重新接管。
 *
 * @param ref 滚动容器（被设置 scrollTop 的目标）
 * @param enabled 是否启用（流式中 true；收起/历史态 false——含在飞帧循环的急停与 RO 拆除）
 * @param options.observeRef 高度信号源（受 maxHeight 约束的容器必传内层内容元素）
 */
export function useSmoothStickBottom(
    ref: RefObject<HTMLElement | null>,
    enabled: boolean,
    options?: { observeRef?: RefObject<HTMLElement | null> },
): void {
    const rafRef = useRef(0)
    const expectedTopRef = useRef<number | null>(null)
    // enabled 的最新值：在飞的追赶帧循环据此急停（effect 只拦新启动，rAF 链
    // 不会自动断——契约「禁用即不动作」须在帧内自守卫）
    const enabledRef = useRef(enabled)
    enabledRef.current = enabled

    useEffect(() => {
        if (!enabled) return
        const el = ref.current
        if (!el) return
        // 高度信号源：内容元素（未 clamp 时才允许缺省回退到滚动容器自身）
        const observed = options?.observeRef?.current ?? el

        const frame = () => {
            rafRef.current = 0
            const el = ref.current
            if (!el || !enabledRef.current) {
                expectedTopRef.current = null
                return
            }
            const step = chaseStep(el, expectedTopRef.current)
            expectedTopRef.current = step.expectedTop
            if (!step.done) {
                rafRef.current = requestAnimationFrame(frame)
            }
        }
        // 循环在飞则让位（RO 高频触发不去重启动）；收敛后下一次 RO 触发自然续追
        if (rafRef.current !== 0) return
        rafRef.current = requestAnimationFrame(frame)

        // RO 回调高频轻量：仅当无在飞循环时排一帧
        const observer = new ResizeObserver(() => {
            if (rafRef.current !== 0) return
            rafRef.current = requestAnimationFrame(frame)
        })
        observer.observe(observed)
        return () => observer.disconnect()
    }, [enabled, ref, options?.observeRef])

    useEffect(() => () => {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
    }, [])
}
