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

/**
 * useIsDark 是「读 store 解析后档位」的纯消费者：system 档所需的 OS 偏好来自
 * store.systemIsDark（写入方见 uiStore.test.ts 的 subscribeSystemTheme），
 * 本 hook 不再自持 matchMedia 订阅——断言它对四种输入组合给出正确档位即可。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

// mock uiStore：绕过 persist（persist 的 localStorage 在本测试环境不可用），
// 保留 actual.resolveTheme（真档位解析逻辑，正是被测对象的一部分）
const { mockState } = vi.hoisted(() => ({
    mockState: { theme: 'dark' as 'light' | 'dark' | 'system', systemIsDark: false },
}))
vi.mock('@/core/data/stores/uiStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/data/stores/uiStore')>()
    return {
        ...actual,
        useUiStore: ((selector: (s: typeof mockState) => unknown) => selector(mockState)) as never,
    }
})

import { useIsDark } from '@/core/data/hooks/useIsDark'

describe('useIsDark', () => {
    beforeEach(() => {
        mockState.theme = 'dark'
        mockState.systemIsDark = false
    })

    it('theme=dark → true', () => {
        const { result } = renderHook(() => useIsDark())
        expect(result.current).toBe(true)
    })

    it('theme=light → false（与 OS 偏好无关）', () => {
        mockState.theme = 'light'
        mockState.systemIsDark = true
        const { result } = renderHook(() => useIsDark())
        expect(result.current).toBe(false)
    })

    it('theme=system → 按 store.systemIsDark 解析', () => {
        mockState.theme = 'system'
        mockState.systemIsDark = true
        expect(renderHook(() => useIsDark()).result.current).toBe(true)

        mockState.systemIsDark = false
        expect(renderHook(() => useIsDark()).result.current).toBe(false)
    })
})
