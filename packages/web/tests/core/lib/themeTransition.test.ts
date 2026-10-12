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
 * 主题切换过渡编排（core/lib/themeTransition）：
 * - 降级路径（无 API / 减少动效 / 未自检 / 自检超预算）一律直写 store，不碰 View Transition；
 * - 启用路径把档位写在 transition 的 update 回调里（快照才拍得到新档位）；
 * - 揭示起点取最近一次指针位置，写在根上的 --vt-reveal-* 变量。
 *
 * 模块带会话级状态（自检结论、指针位置），故每个用例用 vi.resetModules() 重新加载，
 * 而不是加测试专用的重置出口。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/core/config/i18n', () => ({
    default: { changeLanguage: vi.fn() },
}))

interface FakeTransition {
    ready: Promise<void>
    finished: Promise<void>
    skipTransition: () => void
}

const startViewTransitionSpy = vi.fn()
/** 自检读两次 performance.now()，用可控时钟量出「首帧延迟」 */
let clock = 0
/** 空 transition 的 fake 在 ready 落定时推进时钟，模拟真实的快照开销 */
let readyDelayMs = 0

function installStartViewTransition(): void {
    startViewTransitionSpy.mockImplementation((callback: () => void | Promise<void>) => {
        const transition: FakeTransition = {
            ready: Promise.resolve().then(() => {
                clock += readyDelayMs
            }),
            finished: Promise.resolve(),
            skipTransition: vi.fn(),
        }
        void callback()
        return transition
    })
    Object.defineProperty(document, 'startViewTransition', {
        value: startViewTransitionSpy,
        configurable: true,
        writable: true,
    })
}

function installMatchMedia(reducedMotion: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
        value: (query: string) => ({
            matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
            media: query,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            dispatchEvent: () => false,
        }),
        configurable: true,
        writable: true,
    })
}

/** 自检前的让位（whenIdle）在 jsdom 里走 setTimeout(800) 兜底，测试内联执行 */
function installIdleCallback(): void {
    Object.defineProperty(window, 'requestIdleCallback', {
        value: (callback: () => void) => {
            callback()
            return 0
        },
        configurable: true,
        writable: true,
    })
}

async function loadModules() {
    vi.resetModules()
    const transition = await import('@/core/lib/themeTransition')
    const store = await import('@/core/data/stores/uiStore')
    return { ...transition, useUiStore: store.useUiStore }
}

beforeEach(() => {
    clock = 0
    readyDelayMs = 0
    startViewTransitionSpy.mockReset()
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    installIdleCallback()
    installMatchMedia(false)
})

afterEach(() => {
    vi.restoreAllMocks()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (document as any).startViewTransition
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).matchMedia
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).requestIdleCallback
    document.documentElement.removeAttribute('style')
})

describe('switchTheme 降级路径', () => {
    it('无 startViewTransition 时直接写 store', async () => {
        const { switchTheme, useUiStore } = await loadModules()

        switchTheme('light')

        expect(useUiStore.getState().theme).toBe('light')
        expect(startViewTransitionSpy).not.toHaveBeenCalled()
    })

    it('未完成自检时保守直写（不押注未知能力）', async () => {
        installStartViewTransition()
        const { switchTheme, useUiStore } = await loadModules()

        switchTheme('light')

        expect(useUiStore.getState().theme).toBe('light')
        expect(startViewTransitionSpy).not.toHaveBeenCalled()
    })

    it('prefers-reduced-motion 时自检直接判降级', async () => {
        installStartViewTransition()
        installMatchMedia(true)
        const { switchTheme, warmUpThemeTransition, useUiStore } = await loadModules()

        await warmUpThemeTransition()
        switchTheme('light')

        expect(useUiStore.getState().theme).toBe('light')
        expect(startViewTransitionSpy).not.toHaveBeenCalled()
    })

    it('自检首帧超预算时判降级', async () => {
        installStartViewTransition()
        readyDelayMs = 300
        const { switchTheme, warmUpThemeTransition, useUiStore } = await loadModules()

        await warmUpThemeTransition()
        // 自检自身会起一次空 transition，清掉后再看切换是否还走 VT
        startViewTransitionSpy.mockClear()
        switchTheme('light')

        expect(useUiStore.getState().theme).toBe('light')
        expect(startViewTransitionSpy).not.toHaveBeenCalled()
    })
})

describe('switchTheme 启用路径', () => {
    it('自检通过后走 startViewTransition，档位在 update 回调内落定', async () => {
        installStartViewTransition()
        readyDelayMs = 20
        const { switchTheme, warmUpThemeTransition, useUiStore } = await loadModules()

        await warmUpThemeTransition()
        startViewTransitionSpy.mockClear()
        switchTheme('light')

        expect(startViewTransitionSpy).toHaveBeenCalledTimes(1)
        // 回调是同步执行的（flushSync 包住 store 写入），调用返回时档位已落定
        expect(useUiStore.getState().theme).toBe('light')
    })

    it('自检只跑一次（已有结论不再重测）', async () => {
        installStartViewTransition()
        readyDelayMs = 20
        const { warmUpThemeTransition } = await loadModules()

        await warmUpThemeTransition()
        const afterFirst = startViewTransitionSpy.mock.calls.length
        await warmUpThemeTransition()

        expect(startViewTransitionSpy.mock.calls.length).toBe(afterFirst)
    })

    it('并发调用只跑一次自检（StrictMode 双挂载不许开两个 probe）', async () => {
        installStartViewTransition()
        readyDelayMs = 20
        const { warmUpThemeTransition } = await loadModules()

        // 不 await 第一条：模拟 StrictMode 下挂载 effect 连跑两次（两处都在 await whenIdle
        // 之前通过「尚未自检」检查）。两个 probe 并发时后启动的会打断先启动的（其 ready
        // reject），把达标机器误判成不支持——故必须单飞。
        await Promise.all([warmUpThemeTransition(), warmUpThemeTransition()])

        expect(startViewTransitionSpy).toHaveBeenCalledTimes(1)
    })

    it('揭示起点取最近一次指针位置', async () => {
        installStartViewTransition()
        readyDelayMs = 20
        const { switchTheme, warmUpThemeTransition } = await loadModules()
        await warmUpThemeTransition()

        window.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 20 }))
        switchTheme('light')

        const style = document.documentElement.style
        expect(style.getPropertyValue('--vt-reveal-left')).toBe('10px')
        expect(style.getPropertyValue('--vt-reveal-top')).toBe('20px')
        expect(style.getPropertyValue('--vt-reveal-right')).toBe(`${window.innerWidth - 10}px`)
        expect(style.getPropertyValue('--vt-reveal-bottom')).toBe(`${window.innerHeight - 20}px`)
    })

    it('无指针记录时起点落在视口中心', async () => {
        installStartViewTransition()
        readyDelayMs = 20
        const { switchTheme, warmUpThemeTransition } = await loadModules()
        await warmUpThemeTransition()

        switchTheme('light')

        expect(document.documentElement.style.getPropertyValue('--vt-reveal-left')).toBe(
            `${window.innerWidth / 2}px`
        )
    })
})
