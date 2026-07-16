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
export const STREAM_BASE_RATE = 0.1
/** 积压阈值：超过此字符数时自适应加速 */
const STREAM_CATCHUP_THRESHOLD = 50
/** 积压追赶时长（毫秒）：积压内容在此时长内匀速追完，约一个 snapshot 间隔 */
const STREAM_CATCHUP_DURATION_MS = 500

/**
 * 计算逐字揭示速率（字符/毫秒）。
 * 积压超过阈值时加速追平，否则回落到基础速率。
 *
 * 单位为 char/ms，与 STREAM_BASE_RATE 一致——这样 `chars = round(rate * dt_ms)`
 * 在基础与追赶两条分支都自洽。曾误用「帧数」(STREAM_CATCHUP_FRAMES) 作分母，
 * 被当成 ms 与 BASE_RATE 合并，使追赶速率放大约 16×（1帧≈16ms），
 * 导致每批 snapshot 在 2~3 帧内脉冲式清空 80%，表现为流式「一大块一大块」。
 */
export function computeRevealRate(gap: number): number {
    return gap > STREAM_CATCHUP_THRESHOLD
        ? Math.max(STREAM_BASE_RATE, gap / STREAM_CATCHUP_DURATION_MS)
        : STREAM_BASE_RATE
}

/**
 * 流式内容逐字揭示 hook。
 * 将批量到达的 snapshot 内容拆分为逐字显示，模拟打字机效果。
 * 自适应速率：积压时自动加速追平，追上后回落到基础速率。
 */
export function useStreamingContent(target: string, streaming?: boolean): string {
    const [display, setDisplay] = useState(streaming ? '' : target)
    const targetRef = useRef(target)
    const revealedRef = useRef(streaming ? 0 : target.length)
    // 本次内容是否曾处于流式。区分：
    // - 历史消息（从未流式）→ 全显
    // - 流式结束后的 full message（曾流式）→ 继续逐字到收敛，不被 snapToFull 打断
    // 否则 full message 到达时 streaming 变 false 会立即全显，覆盖 snapshot 阶段的逐字
    const wasStreamingRef = useRef(!!streaming)
    const rafRef = useRef(0)

    useEffect(() => {
        targetRef.current = target

        const snapToFull = () => {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = 0
            revealedRef.current = targetRef.current.length
            setDisplay(targetRef.current)
        }

        // 内容缩短 → 全显。不重置 wasStreamingRef：同 hook 实例内的内容缩短是
        // full message 经 normalize/清洗后短于 snapshot 已揭示长度（收敛），而非新消息
        // （新消息会 mount 新 hook 实例，wasStreaming 由其 mount 初值决定）
        if (target.length < revealedRef.current) {
            snapToFull()
            return
        }

        if (streaming) wasStreamingRef.current = true

        // 从未流式（历史消息）→ 立即全显
        if (!wasStreamingRef.current) {
            snapToFull()
            return
        }

        // 曾流式（含 full message 替换 snapshot 后 streaming 变 false）且有未揭示内容 → 继续逐字到收敛
        if (revealedRef.current < target.length && rafRef.current === 0) {
            let lastTime = performance.now()
            let lastRender = lastTime
            const tick = (now: number) => {
                const dt = Math.max(now - lastTime, 1)
                lastTime = now

                const gap = targetRef.current.length - revealedRef.current
                const rate = computeRevealRate(gap)
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

    useEffect(() => () => {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
    }, [])

    return display
}
