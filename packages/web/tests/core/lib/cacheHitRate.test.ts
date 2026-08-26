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
import { calcCacheHitRate } from '@/core/lib/cacheHitRate'

describe('calcCacheHitRate', () => {
    it('正常四项：cacheRead / (input + cacheCreation + cacheRead)，一位小数', () => {
        // ContextRing 实测场景：127744/(1199+256+127744) ≈ 98.9%
        expect(calcCacheHitRate({ inputTokens: 1199, cacheCreationTokens: 256, cacheReadTokens: 127744 })).toBe(98.9)
    })

    it('精度锁定 0.1%：真实 ~99.73% 不被整数舍入吞成 100', () => {
        // turn 概要实测场景：input 2k / cacheRead 726k → 整数 round 曾误显 ⚡100%
        expect(calcCacheHitRate({ inputTokens: 2000, cacheCreationTokens: 0, cacheReadTokens: 726000 })).toBe(99.7)
    })

    it('渠道未上报缓存字段（cacheRead 缺失）→ undefined，≠ 命中 0%', () => {
        expect(calcCacheHitRate({ inputTokens: 100 })).toBeUndefined()
        expect(calcCacheHitRate({ inputTokens: 100, cacheCreationTokens: 50 })).toBeUndefined()
    })

    it('分母 0（本地命令等）→ undefined', () => {
        expect(calcCacheHitRate({})).toBeUndefined()
        expect(calcCacheHitRate({ inputTokens: 0, cacheReadTokens: 0 })).toBeUndefined()
    })
})
