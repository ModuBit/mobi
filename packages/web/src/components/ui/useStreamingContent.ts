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
 * 稳态揭示速率相对到达速率的折扣：刻意略慢于到达，让缓冲单调不空——
 * 揭示流连续（jitter buffer 语义），替代「尽快追平→停滞等快照」的停-走循环
 */
const STREAM_MATCH_FACTOR = 0.9
/** 稳态速率下限：到达速率未知/极低（EMA 冷启动、长间歇）时不塌零 */
const STREAM_MIN_RATE = 0.02
/** 到达速率 EMA 的上界（char/ms）：防同帧 rerender 等极端瞬时速率污染 */
const STREAM_ARRIVAL_EMA_CAP = 2

/** 同帧多次 rerender 时 dt 被钳到一帧内，瞬时速率虚高会污染 EMA——此类样本不采 */
const STREAM_SAMPLE_MIN_DT_MS = 16

/** EMA 采样记忆：上次样本的时间与长度基准 */
export interface ArrivalSample {
    ema: number
    last: { t: number; len: number } | null
}

/**
 * 更新到达速率采样（EMA 单步，抽纯函数便于单测）。
 *
 * 三分支语义：
 * - len 增长且 dt ≥ 一帧 → 采样：EMA = 0.3×旧 + 0.7×瞬时速率（cap 封顶）
 * - len 增长但 dt < 一帧（同帧爆发 rerender）→ **保留旧基准不采**——本批字符并入下一个
 *   合格样本（若覆写基准，爆发的前半段字符永久丢失出统计，瞬时速率被系统性低估）
 * - len 不变（无新增 rerender）→ 仅推进时间基准：下次采样的 dt 只覆盖真正的新增时段，
 *   停滞期不被稀释进速率；EMA 不衰减（间歇 ≠ 吞吐为零）
 */
export function sampleArrivalRate(prev: ArrivalSample, now: number, len: number): ArrivalSample {
    const last = prev.last
    if (!last || len === last.len) {
        return { ema: prev.ema, last: { t: now, len } }
    }
    if (now - last.t < STREAM_SAMPLE_MIN_DT_MS) {
        return prev
    }
    const inst = (len - last.len) / (now - last.t)
    return {
        ema: Math.min(STREAM_ARRIVAL_EMA_CAP, prev.ema * 0.3 + inst * 0.7),
        last: { t: now, len },
    }
}

/**
 * 长度自适应节流档位（target 字符数 → 最小揭示间隔 ms）。
 *
 * 单段渲染下 XMarkdown 对 content 是全量 parse + 全量 sanitize + 全量建树
 * （库的流式优化只覆盖输入稳定层，见 useStreaming hook），每揭示一次的成本
 * 随内容长度线性增长。正常长度每帧揭示（60-120Hz 连续流动感）；超长内容
 * 逐级拉长间隔把每帧成本封顶——时间制档位不随屏幕刷新率漂移（120Hz 屏
 * 与 60Hz 屏的揭示节奏一致）。流式中 target 单调增长，档位只升不降，
 * 无边界抖动问题。
 */
const STREAM_INTERVAL_TIERS: Array<{ maxLen: number; interval: number }> = [
    { maxLen: 4000, interval: 0 },
    { maxLen: 8000, interval: 32 },
    { maxLen: 16000, interval: 48 },
    { maxLen: Number.POSITIVE_INFINITY, interval: 64 },
]

/** 按内容长度取最小揭示间隔（ms），档位语义见 {@link STREAM_INTERVAL_TIERS} */
export function revealIntervalFor(len: number): number {
    return STREAM_INTERVAL_TIERS.find(tier => len <= tier.maxLen)!.interval
}

/**
 * 计算逐字揭示速率（字符/毫秒）。
 *
 * - 积压超过阈值：加速追赶（gap / 500ms），使批量快照在 ~一个间隔内匀速追完
 * - 稳态（积压低于阈值）：**速率匹配**——贴着到达速率 × 0.9 揭示且封顶基础速率。
 *   到达慢于基础速率时（慢模型/proxy/突发快照），旧实现按基础速率揭示会追平
 *   缓冲后停滞等下一批（体感「一断一断」）；匹配策略让揭示流连续、缓冲不榨干
 */
export function computeRevealRate(gap: number, arrivalRate: number): number {
    if (gap > STREAM_CATCHUP_THRESHOLD) {
        return Math.max(STREAM_BASE_RATE, gap / STREAM_CATCHUP_DURATION_MS)
    }
    return Math.min(STREAM_BASE_RATE, Math.max(STREAM_MIN_RATE, arrivalRate * STREAM_MATCH_FACTOR))
}

/**
 * 流式内容逐字揭示 hook。
 * 将批量到达的 snapshot 内容拆分为逐字显示，模拟打字机效果。
 * 自适应速率：积压时自动加速追平，追上后回落到基础速率。
 */
export function useStreamingContent(target: string, streaming?: boolean): string {
    // mount 时对齐到当前 target 长度：drip 只揭示「mount 之后到达的增量」，
    // 不重放已有内容。这样折叠重展 / 切走 session 再切回（组件 remount）时，
    // 长内容立即全显而非从 0 逐字重放——后者会让 XMarkdown 对越来越长的串反复
    // re-parse（O(n²)），长 thinking / 长正文 remount 时直接卡死。
    // 首次实时生成场景不受影响：block 创建时 target 通常为 ''，mount 即全显空，
    // 第一个 snapshot 到达后 effect 启动 drip 逐字揭示增量，打字机效果保留。
    const [display, setDisplay] = useState(target)
    const targetRef = useRef(target)
    const revealedRef = useRef(target.length)
    // 本次内容是否曾处于流式。区分：
    // - 历史消息（从未流式）→ 全显
    // - 流式结束后的 full message（曾流式）→ 继续逐字到收敛，不被 snapToFull 打断
    // 否则 full message 到达时 streaming 变 false 会立即全显，覆盖 snapshot 阶段的逐字
    const wasStreamingRef = useRef(!!streaming)
    const streamingRef = useRef(!!streaming)
    // 到达速率 EMA（char/ms）：快照节奏的有效吞吐，供稳态速率匹配（jitter buffer）。
    // 初始为基础速率——冷启动（首个 ≥16ms 样本前）按基础速率揭示，与旧节奏一致，
    // 不因 EMA 未热塌到下限（否则每条消息开头都有一个 ~20 chars/s 的慢速窗口）
    const arrivalEmaRef = useRef(STREAM_BASE_RATE)
    const arrivalLastRef = useRef<{ t: number; len: number } | null>(null)
    // 揭示量浮点累积：慢速率（<1 字符/帧）跨帧凑整提交，避免「每帧强制 ≥1 字符」
    // 把缓冲瞬间榨干又停滞（这正是「一断一断」的成因之一）
    const revealProgressRef = useRef(0)
    const rafRef = useRef(0)

    useEffect(() => {
        targetRef.current = target
        streamingRef.current = !!streaming

        // 到达速率 EMA 采样（语义见 sampleArrivalRate）：仅在实际有新内容时更新
        const now = performance.now()
        const sampled = sampleArrivalRate(
            { ema: arrivalEmaRef.current, last: arrivalLastRef.current },
            now, target.length,
        )
        arrivalEmaRef.current = sampled.ema
        arrivalLastRef.current = sampled.last

        const snapToFull = () => {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = 0
            revealProgressRef.current = 0
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
            let lastRevealTime = performance.now()
            const tick = (now: number) => {
                // 长度自适应节流：间隔未到直接让位（rAF 每帧仍被调度），
                // 揭示量按实际间隔 dt 计——节奏拉长的同时速率守恒，不会脉冲清空
                const interval = revealIntervalFor(targetRef.current.length)
                if (now - lastRevealTime < interval) {
                    rafRef.current = requestAnimationFrame(tick)
                    return
                }
                const dt = Math.max(now - lastRevealTime, 1)
                lastRevealTime = now

                const gap = targetRef.current.length - revealedRef.current
                if (gap <= 0) {
                    // 缓冲已空：停转待下一个快照唤醒（effect 重启 tick）。
                    // 速率匹配下稳态 gap 不归零，此路径只在「真正无内容可显」时进入
                    revealProgressRef.current = 0
                    rafRef.current = 0
                    return
                }

                // 消息已结束（streaming 翻 false）→ 无需保缓冲，全速收敛
                const rate = streamingRef.current
                    ? computeRevealRate(gap, arrivalEmaRef.current)
                    : Math.max(STREAM_BASE_RATE, gap / STREAM_CATCHUP_DURATION_MS)

                revealProgressRef.current += rate * dt
                const commit = Math.floor(revealProgressRef.current)
                if (commit >= 1) {
                    revealProgressRef.current -= commit
                    revealedRef.current = Math.min(
                        revealedRef.current + commit,
                        targetRef.current.length,
                    )
                    // 正常长度（≤4k）每帧提交 1-3 字符的连续流动感（120Hz 屏同样平滑）；
                    // 超长内容由 interval 档位拉长节奏，替代旧 50ms 节流的 20fps 阶梯跳变
                    setDisplay(targetRef.current.slice(0, revealedRef.current))
                }

                if (revealedRef.current < targetRef.current.length) {
                    rafRef.current = requestAnimationFrame(tick)
                } else {
                    revealProgressRef.current = 0
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
