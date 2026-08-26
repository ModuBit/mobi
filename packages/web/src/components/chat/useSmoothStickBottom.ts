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
import { CHASE_EASE, CHASE_SNAP_PX } from './useStickToBottom'

/**
 * 小容器（如 thinking 内容盒）的缓动贴底。
 *
 * 与 useStickToBottom（主聊天列表）共用同一套追赶参数：trigger 变化（流式
 * 内容增长信号）→ 启动 rAF 缓动追赶，替代 `scrollTop = scrollHeight` 硬跳
 * （换行/增高时容器内容瞬跳一行，快输出下「一跳一跳」）。
 *
 * 与主列表 hook 的差异：无跟随意图管理（手势/恢复跟随）——容器语义是
 * 「流式期间恒贴底」，与旧硬钉一致；但保留**外部干预让位**：每帧核对上次
 * 设置的 scrollTop，被外部改动（程序补偿/浏览器 clamp）即中止本轮追赶，
 * 下一次 trigger 变化再重新接管。
 *
 * @param ref 滚动容器
 * @param trigger 变化即视为「内容可能增长」的信号（如流式 text）
 * @param enabled 是否启用（流式中 true；收起/历史态 false）
 */
export function useSmoothStickBottom(
    ref: RefObject<HTMLElement | null>,
    trigger: unknown,
    enabled: boolean,
): void {
    const rafRef = useRef(0)
    const expectedTopRef = useRef<number | null>(null)

    useEffect(() => {
        if (!enabled) return
        const el = ref.current
        if (!el || rafRef.current !== 0) return

        const frame = () => {
            rafRef.current = 0
            const el = ref.current
            if (!el) {
                expectedTopRef.current = null
                return
            }
            // 外部干预检测：上一帧设置的值被改动 → 中止让位（下次 trigger 重新接管）
            if (expectedTopRef.current !== null && el.scrollTop !== expectedTopRef.current) {
                expectedTopRef.current = null
                return
            }
            const bottom = el.scrollHeight - el.clientHeight
            const dist = bottom - el.scrollTop
            if (dist <= CHASE_SNAP_PX) {
                el.scrollTop = bottom
                expectedTopRef.current = null
                return
            }
            el.scrollTop += dist * CHASE_EASE
            // 期望值取「写后读回」：浏览器会把 scrollTop snap 到物理像素网格，
            // 存浮点计算值会下一帧误判「外部干预」而中止
            expectedTopRef.current = el.scrollTop
            rafRef.current = requestAnimationFrame(frame)
        }
        rafRef.current = requestAnimationFrame(frame)
    }, [trigger, enabled, ref])

    useEffect(() => () => {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
    }, [])
}
