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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePwaMode } from '@/components/layout/usePwaMode'

describe('usePwaMode', () => {
    afterEach(() => { vi.restoreAllMocks() })

    it('display-mode: standalone 匹配 → 返回 true', () => {
        vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
            matches: query === '(display-mode: standalone)',
            media: query,
            onchange: null,
            addListener: vi.fn(), removeListener: vi.fn(),
            addEventListener: vi.fn(), removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }) as MediaQueryList)
        const { result } = renderHook(() => usePwaMode())
        expect(result.current).toBe(true)
    })

    it('非 standalone → 返回 false', () => {
        vi.spyOn(window, 'matchMedia').mockImplementation((_query: string) => ({
            matches: false,
            media: '',
            onchange: null,
            addListener: vi.fn(), removeListener: vi.fn(),
            addEventListener: vi.fn(), removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(),
        }) as MediaQueryList)
        const { result } = renderHook(() => usePwaMode())
        expect(result.current).toBe(false)
    })
})
