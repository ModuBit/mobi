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
import { formatTokens } from '@/core/lib/formatTokens'

describe('formatTokens', () => {
    it('三档基础：<1k 原值 / ≥1k 整数 k / ≥1m 一位小数 m', () => {
        expect(formatTokens(999)).toBe('999')
        expect(formatTokens(1000)).toBe('1k')
        expect(formatTokens(124000)).toBe('124k')
        expect(formatTokens(1_000_000)).toBe('1.0m')
        expect(formatTokens(1_300_000)).toBe('1.3m')
    })

    it('[999500, 999999] 边界进 m 档：round 到整数 k 会跳到 1000k，与上限 "1.0m" 自相矛盾', () => {
        // totalTokens=999600 / maxTokens=1000000 曾显示 "1000k / 1.0m"——已用看似超过上限
        expect(formatTokens(999_600)).toBe('1.0m')
        expect(formatTokens(999_500)).toBe('1.0m')
        // 阈值之下仍走 k 档且 round 不进位到 1000
        expect(formatTokens(999_499)).toBe('999k')
    })
})
