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
import { formatElapsedTime } from '@/core/utils/timeFormat'

describe('formatElapsedTime', () => {
    const base = 1000000

    it('0秒 → "0s"', () => {
        expect(formatElapsedTime(base, base)).toBe('0s')
    })

    it('纯秒数 → "34s"', () => {
        expect(formatElapsedTime(base, base + 34_000)).toBe('34s')
    })

    it('分钟+秒 → "2m 12s"', () => {
        expect(formatElapsedTime(base, base + 132_000)).toBe('2m 12s')
    })

    it('小时+分钟+秒 → "1h 12m 58s"', () => {
        expect(formatElapsedTime(base, base + 4_378_000)).toBe('1h 12m 58s')
    })

    it('负数差值 → "0s"（安全兜底）', () => {
        expect(formatElapsedTime(base + 10_000, base)).toBe('0s')
    })
})