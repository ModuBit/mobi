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
import { computeRevealRate, STREAM_BASE_RATE, useStreamingContent } from '@/components/ui/useStreamingContent'

describe('computeRevealRate', () => {
    it('积压时按 char/ms 计算速率，使积压在 ~500ms 内匀速追完（而非数帧脉冲清空）', () => {
        // 150 字符积压：期望 ~0.3 char/ms（150 / 500ms），不应是 ~5（帧数被当 ms 用）
        const rate = computeRevealRate(150)
        // 上界：一帧 16ms × rate 揭示量应远小于 150（不能 2 帧清空 80%）
        // rate < 0.5 → 一帧最多 ~8 字符，30+ 帧才追完 = 匀速
        expect(rate).toBeLessThan(0.5)
        expect(rate).toBeGreaterThan(STREAM_BASE_RATE)
    })

    it('积压低于阈值时回落基础速率', () => {
        expect(computeRevealRate(30)).toBe(STREAM_BASE_RATE)
    })

    it('一帧（~16ms）揭示量不应超过积压的 10%（杜绝脉冲式大块）', () => {
        const gap = 200
        const rate = computeRevealRate(gap)
        const charsPerFrame = rate * 16 // 60fps 一帧
        expect(charsPerFrame).toBeLessThan(gap * 0.1)
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
})
