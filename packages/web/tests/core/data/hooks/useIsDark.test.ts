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

// mock uiStore：绕过 persist（persist 的 localStorage 在本测试环境不可用），
// 保留 actual.resolveTheme（system 模式解析 matchMedia）
const { mockState } = vi.hoisted(() => ({ mockState: { theme: 'dark' as string } }))
vi.mock('@/core/data/stores/uiStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/data/stores/uiStore')>()
    return {
        ...actual,
        useUiStore: ((selector: (s: { theme: string }) => unknown) => selector(mockState)) as never,
    }
})

import { useIsDark } from '@/core/data/hooks/useIsDark'

/** 构造可控 matchMedia mock：返回 { fire(matches) } 模拟 OS 主题切换。
 *  matches 用 getter 暴露（useIsDark 的 handler 会重读 matchMedia.matches） */
function mockMatchMedia(initial: boolean) {
    const listeners = new Set<(e: { matches: boolean }) => void>()
    let matches = initial
    const mql = {
        get matches() {
            return matches
        },
        addEventListener: (_ev: string, cb: (e: { matches: boolean }) => void) => {
            listeners.add(cb)
        },
        removeEventListener: (_ev: string, cb: (e: { matches: boolean }) => void) => {
            listeners.delete(cb)
        },
    }
    vi.stubGlobal('matchMedia', () => mql)
    return {
        fire: (m: boolean) => {
            matches = m
            listeners.forEach((cb) => cb({ matches: m }))
        },
    }
}

describe('useIsDark', () => {
    beforeEach(() => {
        mockState.theme = 'dark'
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('theme=dark → true', () => {
        mockState.theme = 'dark'
        const { result } = renderHook(() => useIsDark())
        expect(result.current).toBe(true)
    })

    it('theme=light → false', () => {
        mockState.theme = 'light'
        const { result } = renderHook(() => useIsDark())
        expect(result.current).toBe(false)
    })

    it('theme=system：解析 matchMedia，OS 切换实时响应', () => {
        const mql = mockMatchMedia(true) // OS 当前暗色
        mockState.theme = 'system'
        const { result } = renderHook(() => useIsDark())
        expect(result.current).toBe(true)

        // OS 切到亮色 → 监听器触发 → isDark 实时更新
        act(() => mql.fire(false))
        expect(result.current).toBe(false)
    })
})
