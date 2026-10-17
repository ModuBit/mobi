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

import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { CacheStatus } from '@mobi/shared'
import i18n from '@/core/config/i18n'

afterEach(cleanup)

import { CacheExpiredRow } from '@/features/chat/CacheExpiredRow'

const expiredCache: CacheStatus = {
    expired: true,
    contextTokens: 24_000,
    secondsSinceLastResponse: 3720,
    estimatedCacheWriteUsd: 0.12,
    observedAt: 1_700_000_000_000,
}

beforeAll(async () => {
    await i18n.changeLanguage('zh')
})

describe('CacheExpiredRow', () => {
    it('渲染系统行：过期标题 + 重缓存规模 + 成本', () => {
        render(<CacheExpiredRow cacheStatus={expiredCache} />)
        const row = screen.getByTestId('cache-expired-row')
        expect(row.textContent).toContain('缓存已过期')
        expect(row.textContent).toContain('首轮将重缓存 ~24.0k tokens')
        expect(row.textContent).toContain('$0.12')
    })

    it('规模/成本缺省时只渲染标题，不出现悬空分隔符', () => {
        render(<CacheExpiredRow cacheStatus={{ expired: true, observedAt: 1 }} />)
        expect(screen.getByTestId('cache-expired-row').textContent).toBe('缓存已过期')
    })
})
