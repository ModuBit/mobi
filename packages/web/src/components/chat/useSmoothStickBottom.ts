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
 * 含缓动数学/精确贴底/外部干预检测）：trigger 变化（流式内容增长信号）→
 * 启动 rAF 缓动追赶，替代 `scrollTop = scrollHeight` 硬跳（换行/增高时
 * 容器内容瞬跳一行，快输出下「一跳一跳」）。
 *
 * 与主列表 hook 的差异：无跟随意图管理（手势/恢复跟随）——容器语义是
 * 「流式期间恒贴底」，与旧硬钉一致；但保留**外部干预让位**：每帧核对上次
 * 设置的 scrollTop，被外部改动（程序补偿/浏览器 clamp）即中止本轮追赶，
 * 下一次 trigger 变化再重新接管。
 *
 * @param ref 滚动容器
 * @param trigger 变化即视为「内容可能增长」的信号（如流式 text）
 * @param enabled 是否启用（流式中 true；收起/历史态 false——含在飞帧循环的急停）
 */
export function useSmoothStickBottom(
    ref: RefObject<HTMLElement | null>,
    trigger: unknown,
    enabled: boolean,
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
        if (!el || rafRef.current !== 0) return

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
        rafRef.current = requestAnimationFrame(frame)
    }, [trigger, enabled, ref])

    useEffect(() => () => {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
    }, [])
}
