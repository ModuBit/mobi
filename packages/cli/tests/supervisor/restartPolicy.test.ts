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
import { nextBackoffMs, nextCrashCount, shouldGiveUp } from '@/supervisor/restartPolicy'

describe('supervisor 重启策略', () => {
    it('退避序列：1s → 2s → 4s → 8s → 16s → 30s 封顶', () => {
        expect([1, 2, 3, 4, 5, 6, 7, 20].map(nextBackoffMs)).toEqual([
            1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
        ])
    })

    it('非法入参按第 1 次处理', () => {
        expect(nextBackoffMs(0)).toBe(1_000)
        expect(nextBackoffMs(-3)).toBe(1_000)
    })

    it('运行不足 60s 崩溃 → 计数累加', () => {
        expect(nextCrashCount(2, 59_999)).toBe(3)
        expect(nextCrashCount(0, 0)).toBe(1)
    })

    it('稳定运行 ≥ 60s 后崩溃 → 重新起算（本次记 1）', () => {
        expect(nextCrashCount(4, 60_000)).toBe(1)
        expect(nextCrashCount(4, 600_000)).toBe(1)
    })

    it('连续 5 次放弃', () => {
        expect(shouldGiveUp(4)).toBe(false)
        expect(shouldGiveUp(5)).toBe(true)
    })
})
