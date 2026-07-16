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

import { describe, it, expect } from 'vitest'
import { computeRevealRate, STREAM_BASE_RATE } from '@/components/ui/useStreamingContent'

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
