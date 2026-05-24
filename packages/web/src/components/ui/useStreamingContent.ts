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

/** 逐字揭示基础速率（字符/毫秒），~120 chars/sec */
const STREAM_BASE_RATE = 0.1
/** 积压阈值：超过此字符数时自适应加速 */
const STREAM_CATCHUP_THRESHOLD = 50
/** 积压追赶帧数（≈30帧 ≈ 500ms，即一个 snapshot 间隔内追完） */
const STREAM_CATCHUP_FRAMES = 30

/**
 * 流式内容逐字揭示 hook。
 * 将批量到达的 snapshot 内容拆分为逐字显示，模拟打字机效果。
 * 自适应速率：积压时自动加速追平，追上后回落到基础速率。
 */
export function useStreamingContent(target: string, streaming?: boolean): string {
    const [display, setDisplay] = useState(target)
    const targetRef = useRef(target)
    const revealedRef = useRef(target.length)
    const rafRef = useRef(0)

    useEffect(() => {
        targetRef.current = target

        // 非流式或新消息（内容缩短）→ 立即显示全部
        if (!streaming || target.length < revealedRef.current) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = 0
            revealedRef.current = target.length
            setDisplay(target)
            return
        }

        // 有未揭示内容且动画未在运行 → 启动
        if (revealedRef.current < target.length && rafRef.current === 0) {
            let lastTime = performance.now()
            let lastRender = lastTime
            const tick = (now: number) => {
                const dt = Math.max(now - lastTime, 1)
                lastTime = now

                const gap = targetRef.current.length - revealedRef.current
                const rate = gap > STREAM_CATCHUP_THRESHOLD
                    ? Math.max(STREAM_BASE_RATE, gap / STREAM_CATCHUP_FRAMES)
                    : STREAM_BASE_RATE
                const chars = Math.max(1, Math.round(rate * dt))
                revealedRef.current = Math.min(revealedRef.current + chars, targetRef.current.length)

                // 节流 DOM 更新到 ~20fps，避免 XMarkdown 高频重解析
                if (now - lastRender >= 50 || revealedRef.current >= targetRef.current.length) {
                    lastRender = now
                    setDisplay(targetRef.current.slice(0, revealedRef.current))
                }

                if (revealedRef.current < targetRef.current.length) {
                    rafRef.current = requestAnimationFrame(tick)
                } else {
                    rafRef.current = 0
                }
            }
            rafRef.current = requestAnimationFrame(tick)
        }
    }, [target, streaming])

    useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

    return display
}
