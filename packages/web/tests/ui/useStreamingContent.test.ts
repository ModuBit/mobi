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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
    computeRevealRate,
    STREAM_BASE_RATE,
    revealIntervalFor,
    useStreamingContent,
    sampleArrivalRate,
} from '@/components/ui/useStreamingContent'

describe('revealIntervalFor（长度自适应节流档位）', () => {
    it('正常长度（≤4k 字符）每帧揭示（interval 0）', () => {
        expect(revealIntervalFor(0)).toBe(0)
        expect(revealIntervalFor(4000)).toBe(0)
    })

    it('超长内容逐级拉长揭示间隔，把单段全量 re-parse 的每帧成本封顶', () => {
        expect(revealIntervalFor(4001)).toBe(32)
        expect(revealIntervalFor(8000)).toBe(32)
        expect(revealIntervalFor(8001)).toBe(48)
        expect(revealIntervalFor(16000)).toBe(48)
        expect(revealIntervalFor(16001)).toBe(64)
        expect(revealIntervalFor(100000)).toBe(64)
    })
})

describe('computeRevealRate（速率匹配揭示）', () => {
    it('积压超过阈值时按 char/ms 加速追赶，使积压在 ~500ms 内匀速追完', () => {
        const rate = computeRevealRate(150, 0.05)
        expect(rate).toBeLessThan(0.5)
        expect(rate).toBeGreaterThan(STREAM_BASE_RATE)
    })

    it('一帧（~16ms）揭示量不应超过积压的 10%（杜绝脉冲式大块）', () => {
        const gap = 200
        const rate = computeRevealRate(gap, 0.05)
        const charsPerFrame = rate * 16
        expect(charsPerFrame).toBeLessThan(gap * 0.1)
    })

    it('稳态（积压低于阈值）：揭示速率贴着到达速率略慢，保持缓冲不榨干（jitter buffer）', () => {
        // 到达 50 chars/s（0.05 char/ms）慢于基础速率 → 旧实现按 100 chars/s 揭示会
        // 追平后停滞等快照（一断一断）；匹配策略以 0.9×到达速率持续揭示
        const rate = computeRevealRate(20, 0.05)
        expect(rate).toBeCloseTo(0.045)
        expect(rate).toBeLessThan(0.05) // 永不快于到达 → 缓冲单调不空
    })

    it('稳态速率有下限：到达速率极低（EMA 冷启动/长间歇）时不塌零', () => {
        expect(computeRevealRate(20, 0)).toBeGreaterThan(0)
        expect(computeRevealRate(20, 0)).toBeLessThanOrEqual(STREAM_BASE_RATE)
    })
})

describe('sampleArrivalRate（EMA 采样基准）', () => {
    it('无基准（首样本）→ 只建基准不采样', () => {
        const r = sampleArrivalRate({ ema: 0.1, last: null }, 100, 50)
        expect(r.ema).toBe(0.1)
        expect(r.last).toEqual({ t: 100, len: 50 })
    })

    it('合格样本（dt ≥ 一帧）→ EMA = 0.3×旧 + 0.7×瞬时速率，基准推进', () => {
        const r = sampleArrivalRate({ ema: 0.1, last: { t: 0, len: 10 } }, 100, 60)
        // inst = (60-10)/100 = 0.5
        expect(r.ema).toBeCloseTo(0.1 * 0.3 + 0.5 * 0.7)
        expect(r.last).toEqual({ t: 100, len: 60 })
    })

    it('同帧爆发（len 增长但 dt < 一帧）→ 基准保留不采，字符并入下一样本', () => {
        const prev = { ema: 0.1, last: { t: 0, len: 10 } }
        const r = sampleArrivalRate(prev, 8, 110)  // +100 字符仅隔 8ms
        expect(r).toEqual(prev)
    })

    it('爆发后的合格样本计入全部增量字符（回归：覆写基准曾把前半段字符丢失出统计）', () => {
        // t=0 len=10 → t=8 爆发到 110（跳过）→ t=24 到 111。
        // bug 态（爆发时覆写基准）：inst = (111-110)/16 ≈ 0.06；修复后 dt=24 全量计：
        const r = sampleArrivalRate({ ema: 0.1, last: { t: 0, len: 10 } }, 24, 111)
        const inst = (111 - 10) / 24  // ≈ 4.2 char/ms
        expect(r.ema).toBeCloseTo(Math.min(2, 0.1 * 0.3 + inst * 0.7))
    })

    it('len 不变（无新增 rerender）→ 仅推进时间基准，EMA 不衰减', () => {
        const r = sampleArrivalRate({ ema: 0.1, last: { t: 0, len: 50 } }, 500, 50)
        expect(r.ema).toBe(0.1)
        expect(r.last).toEqual({ t: 500, len: 50 })
    })
})

describe('useStreamingContent', () => {
    // rAF / performance.now mock：手动推进帧，逐字 drip 在测试中可控
    let rafMap: Map<number, FrameRequestCallback>
    let rafSeq: number
    let now: number

    beforeEach(() => {
        rafMap = new Map()
        rafSeq = 1
        now = 0
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
            const id = rafSeq++
            rafMap.set(id, cb)
            return id
        })
        vi.stubGlobal('cancelAnimationFrame', (id: number) => {
            rafMap.delete(id)
        })
        vi.stubGlobal('performance', { now: () => now })
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    /** 推进一帧（dt ms）：触发当前 pending 的 rAF callback（不含其内新调度的） */
    function step(dt: number) {
        now += dt
        const pending = [...rafMap.values()]
        rafMap.clear()
        act(() => {
            for (const cb of pending) cb(now)
        })
    }

    /** 持续推进帧直到无 pending rAF（drip 收敛）或达上限 */
    function flush(dt = 60, maxFrames = 200) {
        let n = 0
        while (rafMap.size > 0 && n < maxFrames) {
            step(dt)
            n++
        }
    }

    it('非流式（历史消息）mount 立即全显', () => {
        const { result } = renderHook(() => useStreamingContent('hello world', false))
        expect(result.current).toBe('hello world')
    })

    it('流式 remount 时 target 已有长内容 → 立即全显，不逐字重放（修复折叠重展/切 session 卡死）', () => {
        const long = 'a'.repeat(1000)
        const { result } = renderHook(() => useStreamingContent(long, true))
        // 改前：display='' 然后从 0 drip 整段（O(n²) 重放）。改后：mount 即全显
        expect(result.current).toBe(long)
        // 且不启动 drip（无 pending rAF）
        expect(rafMap.size).toBe(0)
    })

    it('流式 mount 时 target 为空 → 后续 snapshot 到达逐字揭示（保留打字机效果）', () => {
        const { result, rerender } = renderHook(({ t }) => useStreamingContent(t, true), {
            initialProps: { t: '' },
        })
        expect(result.current).toBe('')

        // 第一个 snapshot 到达
        rerender({ t: 'a'.repeat(100) })
        expect(rafMap.size).toBeGreaterThan(0)
        // 一帧后逐字揭示一部分（非瞬间全显）
        step(60)
        expect(result.current.length).toBeGreaterThan(0)
        expect(result.current.length).toBeLessThan(100)
        // 持续推进直到揭示完成
        flush(60)
        expect(result.current).toBe('a'.repeat(100))
    })

    it('流式 remount 全显后，新到增量仍逐字揭示（不重放已有部分）', () => {
        const base = 'a'.repeat(1000)
        const { result, rerender } = renderHook(({ t }) => useStreamingContent(t, true), {
            initialProps: { t: base },
        })
        expect(result.current).toBe(base) // mount 全显

        // 增量到达：揭示应从 1000 起步，不回退
        rerender({ t: base + 'b'.repeat(50) })
        expect(rafMap.size).toBeGreaterThan(0)
        step(60)
        expect(result.current.length).toBeGreaterThanOrEqual(1000)
        expect(result.current.length).toBeLessThanOrEqual(1050)
        flush(60)
        expect(result.current).toBe(base + 'b'.repeat(50))
    })

    it('每帧连续更新：连续两帧 display 都增长（无 20fps 节流的跳帧阶梯）', () => {
        // target 100 字符（>50 触发追赶）：追赶速率 100/500ms = 0.2 char/ms
        const target = 'a'.repeat(100)
        const { result, rerender } = renderHook(({ t }) => useStreamingContent(t, true), {
            initialProps: { t: '' },
        })
        rerender({ t: target })
        expect(rafMap.size).toBeGreaterThan(0)

        const lens: number[] = []
        for (let i = 0; i < 5; i++) {
            step(16)
            lens.push(result.current.length)
        }
        // 每帧后长度都应大于前一帧（连续增长，无一帧跳空）
        for (let i = 1; i < lens.length; i++) {
            expect(lens[i]).toBeGreaterThan(lens[i - 1])
        }
        // 单帧步长应是小幅（追赶速率 0.2 char/ms × 16ms ≈ 3 字符）
        expect(Math.max(...lens.slice(1).map((l, i) => l - lens[i]), 0)).toBeLessThanOrEqual(5)
    })

    it('EMA 冷启动（首个 ≥16ms 样本前）按基础速率揭示——起笔不慢速', () => {
        // 首快照 40 字符（gap ≤ 50 走稳态分支）：EMA 未热时的稳态速率应为基础速率
        //（~90-100 chars/s），不得塌到 MIN_RATE 20 chars/s（表现为开头打字极慢）
        const { result, rerender } = renderHook(({ t }) => useStreamingContent(t, true), {
            initialProps: { t: '' },
        })
        rerender({ t: 'a'.repeat(40) })
        step(16)
        step(16)
        step(16)
        // 基础速率 × 48ms ≈ 4-5 字符；bug 态（EMA=0 → 20 chars/s）48ms 仅 ~1 字符
        expect(result.current.length).toBeGreaterThanOrEqual(4)
        expect(result.current.length).toBeLessThan(40)
    })

    it('慢速到达期间揭示流连续：无 ≥4 帧连续停滞（gap>0 时，jitter buffer）', () => {
        // 每 200ms 到达 10 字符（有效 50 chars/s，低于基础速率 100）。
        // 旧实现按基础速率揭示 → 每轮 100ms 追平、停滞 100ms 等下一批（一断一断）；
        // 速率匹配后以 ~45 chars/s 持续揭示，gap 不榨干 → 揭示流连续
        const { result, rerender } = renderHook(({ t }) => useStreamingContent(t, true), {
            initialProps: { t: '' },
        })
        let target = ''
        let targetLen = 0
        const lens: number[] = []
        for (let round = 0; round < 8; round++) {
            targetLen += 10
            target = 'a'.repeat(targetLen)
            act(() => { rerender({ t: target }) })
            for (let f = 0; f < 12; f++) {
                step(16)
                lens.push(result.current.length)
            }
        }
        // gap>0 期间的连续停滞帧数。跳过冷启动前两轮（EMA 未热按基础速率揭示有一轮旧节奏；
        // 首个合格样本含 mount 以来的全部到达字符会瞬时冲高 EMA，二轮内收敛到匹配速率）
        let maxDry = 0, dry = 0
        for (let i = 25; i < lens.length; i++) {
            if (lens[i] === lens[i-1] && lens[i] < targetLen) dry++
            else dry = 0
            maxDry = Math.max(maxDry, dry)
        }
        expect(maxDry).toBeLessThanOrEqual(3)
        flush(60)
        expect(result.current).toBe(target)
    })

    it('超长内容自适应节流：每帧到达但隔档揭示（48ms 档，非每帧），节奏仍连续', () => {
        // target 10k 字符 → 48ms 档：单段全量 re-parse 是 O(全文)，隔 3 帧揭示一次
        // 把每帧成本封顶；rAF 每帧仍被调度（间隔未到直接让位）
        const target = 'a'.repeat(10000)
        const { result, rerender } = renderHook(({ t }) => useStreamingContent(t, true), {
            initialProps: { t: '' },
        })
        rerender({ t: target })
        expect(rafMap.size).toBeGreaterThan(0)

        const lens: number[] = [result.current.length]
        for (let i = 0; i < 6; i++) {
            step(16)
            lens.push(result.current.length)
        }
        // 16ms × 3 = 48ms 才揭示一次：6 帧中恰 2 次揭示（第 3、6 帧）
        const reveals = lens.slice(1).filter((l, i) => l > lens[i])
        expect(reveals).toHaveLength(2)
        // 揭示步长按 dt=48ms 计（追赶速率 10k/500ms=20 char/ms × 48ms ≈ 960 字符），
        // 不会因节流脉冲清空——单次揭示仍是小比例
        const steps = lens.slice(1).map((l, i) => l - lens[i]).filter(d => d > 0)
        expect(Math.max(...steps)).toBeLessThanOrEqual(1000)
        // 持续推进到收敛
        flush(60)
        expect(result.current).toBe(target)
    })
})
