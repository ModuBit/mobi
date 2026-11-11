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
 * subscribeSystemTheme：把 OS 暗色偏好写进 store.systemIsDark 的订阅（全站主题
 * 跟 OS 切档的唯一通知源，由 ThemeProvider 挂载）。
 * 断言外部行为：订阅后 store 与 OS 同步、OS 变更时 store 跟着变、退订后不再变。
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { resolveTheme, subscribeSystemTheme, useUiStore } from '@/core/data/stores/uiStore'

/** 可控 matchMedia 桩：返回 { fire(matches) } 模拟 OS 切换，并记录监听器增删次数 */
function mockMatchMedia(initial: boolean) {
    const listeners = new Set<(e: { matches: boolean }) => void>()
    let matches = initial
    const addEventListener = vi.fn((_ev: string, cb: (e: { matches: boolean }) => void) => {
        listeners.add(cb)
    })
    const removeEventListener = vi.fn((_ev: string, cb: (e: { matches: boolean }) => void) => {
        listeners.delete(cb)
    })
    const mql = {
        get matches() {
            return matches
        },
        addEventListener,
        removeEventListener,
    }
    vi.stubGlobal('matchMedia', () => mql)
    return {
        addEventListener,
        removeEventListener,
        fire: (m: boolean) => {
            matches = m
            listeners.forEach((cb) => cb({ matches: m }))
        },
    }
}

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('resolveTheme', () => {
    it('非 system 档直接返回档位本身', () => {
        expect(resolveTheme('light', true)).toBe('light')
        expect(resolveTheme('dark', false)).toBe('dark')
    })

    it('system 档落 OS 偏好', () => {
        expect(resolveTheme('system', true)).toBe('dark')
        expect(resolveTheme('system', false)).toBe('light')
    })
})

describe('subscribeSystemTheme', () => {
    it('订阅即刻对齐 OS 当前偏好，OS 变更时同步进 store', () => {
        const mql = mockMatchMedia(true)
        const unsubscribe = subscribeSystemTheme()

        expect(useUiStore.getState().systemIsDark).toBe(true)

        mql.fire(false)
        expect(useUiStore.getState().systemIsDark).toBe(false)

        mql.fire(true)
        expect(useUiStore.getState().systemIsDark).toBe(true)

        unsubscribe()
    })

    it('重复订阅只挂一个 matchMedia 监听，退订到 0 才摘', () => {
        const mql = mockMatchMedia(false)
        const off1 = subscribeSystemTheme()
        const off2 = subscribeSystemTheme()

        expect(mql.addEventListener).toHaveBeenCalledTimes(1)

        off1()
        expect(mql.removeEventListener).not.toHaveBeenCalled()

        off2()
        expect(mql.removeEventListener).toHaveBeenCalledTimes(1)
    })

    it('退订后 OS 变更不再写 store', () => {
        const mql = mockMatchMedia(false)
        subscribeSystemTheme()()
        useUiStore.setState({ systemIsDark: false })

        mql.fire(true)
        expect(useUiStore.getState().systemIsDark).toBe(false)
    })
})

describe('persist 白名单（声明「persist 跟随用户偏好」的字段必须收进 partialize）', () => {
    // 反馈开关声明为 persist 跟随用户偏好——漏白名单则刷新回默认值，
    // 用户关闭的反馈静默回开（2026-11-11 实锤：partialize 漏收两开关）
    function readPersisted(): Record<string, unknown> {
        const raw = localStorage.getItem('mobi-ui')
        expect(raw).toBeTruthy()
        return JSON.parse(raw!) as Record<string, unknown>
    }

    beforeEach(() => {
        localStorage.removeItem('mobi-ui')
    })

    it('初始化快照包含反馈开关', () => {
        useUiStore.getState().setSoundFeedbackEnabled(true)
        const state = readPersisted().state as Record<string, unknown>
        expect(state.theme).toBeDefined()
        expect(state.locale).toBeDefined()
        expect(state.sidebarExpanded).toBeDefined()
        expect(state.soundFeedbackEnabled).toBeDefined()
        expect(state.hapticFeedbackEnabled).toBeDefined()
    })

    it('翻转反馈开关立即写回持久化快照', () => {
        useUiStore.getState().setSoundFeedbackEnabled(false)
        useUiStore.getState().setHapticFeedbackEnabled(false)
        const state = readPersisted().state as Record<string, unknown>
        expect(state.soundFeedbackEnabled).toBe(false)
        expect(state.hapticFeedbackEnabled).toBe(false)
    })
})
