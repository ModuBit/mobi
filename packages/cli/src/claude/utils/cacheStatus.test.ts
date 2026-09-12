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

import { describe, expect, it } from 'vitest'
import { buildCacheStatusFromSessionStart } from './cacheStatus'

describe('buildCacheStatusFromSessionStart', () => {
    it('resume 且过期 → 产出 CacheStatus（可选字段仅有效数字携带）', () => {
        const status = buildCacheStatusFromSessionStart({
            source: 'resume',
            prompt_cache_likely_expired: true,
            context_tokens: 24000,
            seconds_since_last_response: 3720,
            estimated_cache_write_usd: 0.12,
        })
        expect(status).toMatchObject({
            expired: true,
            contextTokens: 24000,
            secondsSinceLastResponse: 3720,
            estimatedCacheWriteUsd: 0.12,
        })
        expect(typeof status!.observedAt).toBe('number')
    })

    it('可选字段缺失/非数字 → 缺省不携带', () => {
        const status = buildCacheStatusFromSessionStart({
            source: 'fork',
            prompt_cache_likely_expired: true,
        })
        expect(status).toEqual({ expired: true, observedAt: expect.any(Number) })

        const withJunk = buildCacheStatusFromSessionStart({
            source: 'resume',
            prompt_cache_likely_expired: true,
            context_tokens: '24000',
            seconds_since_last_response: Number.NaN,
        })
        expect(withJunk).toEqual({ expired: true, observedAt: expect.any(Number) })
    })

    it('非 resume/fork → null（startup/clear/compact 不上报）', () => {
        expect(buildCacheStatusFromSessionStart({
            source: 'startup',
            prompt_cache_likely_expired: true,
        })).toBeNull()
        expect(buildCacheStatusFromSessionStart({})).toBeNull()
    })

    it('resume 但缓存未过期 → null（warm 无信息量不上报）', () => {
        expect(buildCacheStatusFromSessionStart({
            source: 'resume',
            prompt_cache_likely_expired: false,
            context_tokens: 24000,
        })).toBeNull()
        expect(buildCacheStatusFromSessionStart({
            source: 'resume',
        })).toBeNull()
    })
})
