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

import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerServiceWorker } from '@/core/pwa/registerSW'

/**
 * 注册路径的主动更新检查（registerSW.ts）：
 * 浏览器仅在页面导航时 diff sw.js，SPA/PWA 长驻不导航发现不了新版本，
 * 须由页面周期性主动 reg.update()。
 */

/** 桩掉 jsdom 没有的 navigator.serviceWorker，返回可断言的 registration */
function stubServiceWorker() {
    const update = vi.fn().mockResolvedValue(undefined)
    const reg = {
        waiting: null,
        update,
        addEventListener: vi.fn(),
    }
    const sw = {
        controller: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        register: vi.fn().mockResolvedValue(reg),
    }
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: sw })
    return { reg, update }
}

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('registerServiceWorker 主动更新检查', () => {
    it('页面可见时周期性主动 update() 发现新版本', async () => {
        vi.useFakeTimers()
        const { update } = stubServiceWorker()
        const cleanup = registerServiceWorker(vi.fn())

        await vi.advanceTimersByTimeAsync(60_000)
        expect(update).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(60_000)
        expect(update).toHaveBeenCalledTimes(2)

        cleanup()
    })

    it('页面隐藏时不发起检查', async () => {
        vi.useFakeTimers()
        const { update } = stubServiceWorker()
        const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
        const cleanup = registerServiceWorker(vi.fn())

        await vi.advanceTimersByTimeAsync(120_000)
        expect(update).not.toHaveBeenCalled()

        cleanup()
        visibilitySpy.mockRestore()
    })

    it('切回可见时立即检查', async () => {
        vi.useFakeTimers()
        const { update } = stubServiceWorker()
        const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
        const cleanup = registerServiceWorker(vi.fn())

        await vi.advanceTimersByTimeAsync(0)
        expect(update).not.toHaveBeenCalled()

        visibilitySpy.mockRestore()
        document.dispatchEvent(new Event('visibilitychange'))
        await vi.advanceTimersByTimeAsync(0)
        expect(update).toHaveBeenCalledTimes(1)

        cleanup()
    })

    it('注销后不再周期检查', async () => {
        vi.useFakeTimers()
        const { update } = stubServiceWorker()
        const cleanup = registerServiceWorker(vi.fn())

        await vi.advanceTimersByTimeAsync(60_000)
        cleanup()
        await vi.advanceTimersByTimeAsync(120_000)
        expect(update).toHaveBeenCalledTimes(1)
    })
})
