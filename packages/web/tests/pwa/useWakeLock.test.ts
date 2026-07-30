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
import { renderHook } from '@testing-library/react'
import { useWakeLock } from '@/core/pwa/useWakeLock'

/** 微任务 flush：等待 hook 内 request().then 落定 */
function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 安装 wakeLock mock，返回 request/release 的 spy 工厂 */
function installWakeLock(opts?: { reject?: Error }) {
    const releases: ReturnType<typeof vi.fn>[] = []
    const request = vi.fn(async () => {
        const release = vi.fn().mockResolvedValue(undefined)
        const sentinel = { released: false, release } as unknown as WakeLockSentinel
        releases.push(sentinel)
        if (opts?.reject) throw opts.reject
        return sentinel
    })
    Object.defineProperty(navigator, 'wakeLock', {
        value: { request },
        configurable: true,
        writable: true,
    })
    return { request, releases }
}

function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', {
        value: state,
        configurable: true,
    })
}

describe('useWakeLock', () => {
    let original: unknown

    beforeEach(() => {
        original = (navigator as unknown as { wakeLock?: unknown }).wakeLock
        setVisibility('visible')
    })

    afterEach(() => {
        // 还原 wakeLock
        Object.defineProperty(navigator, 'wakeLock', {
            value: original,
            configurable: true,
            writable: true,
        })
        vi.restoreAllMocks()
    })

    it('active=true → 请求 screen wakeLock', async () => {
        const { request } = installWakeLock()
        renderHook(() => useWakeLock(true))
        await flush()
        expect(request).toHaveBeenCalledWith('screen')
        expect(request).toHaveBeenCalledTimes(1)
    })

    it('active 由 true → false → 释放已获取的 sentinel', async () => {
        const { request, releases } = installWakeLock()
        const { rerender } = renderHook(({ a }: { a: boolean }) => useWakeLock(a), {
            initialProps: { a: true },
        })
        await flush()
        expect(releases.length).toBe(1)
        rerender({ a: false })
        await flush()
        expect(releases[0].release).toHaveBeenCalledTimes(1)
        expect(request).toHaveBeenCalledTimes(1)
    })

    it('浏览器不支持（无 wakeLock）→ 静默 no-op，不抛错', () => {
        delete (navigator as unknown as { wakeLock?: unknown }).wakeLock
        expect(() => renderHook(() => useWakeLock(true))).not.toThrow()
    })

    it('request reject（如 NotAllowedError）→ 吞掉异常，不抛错', async () => {
        installWakeLock({ reject: new DOMException('NotAllowed', 'NotAllowedError') })
        const { unmount } = renderHook(() => useWakeLock(true))
        await flush()
        // 不抛错即通过；卸载也不应抛
        expect(() => unmount()).not.toThrow()
    })

    it('页面切后台再切回可见 → 重新获取（系统在后台已自动释放）', async () => {
        const { request, releases } = installWakeLock()
        renderHook(() => useWakeLock(true))
        await flush()
        expect(request).toHaveBeenCalledTimes(1)

        // 切后台：显式释放当前 sentinel（防个别实现未及时自动释放），ref 清空
        setVisibility('hidden')
        document.dispatchEvent(new Event('visibilitychange'))
        await flush()
        expect(releases[0].release).toHaveBeenCalledTimes(1)

        // 切回可见：应重新获取
        setVisibility('visible')
        document.dispatchEvent(new Event('visibilitychange'))
        await flush()

        expect(request).toHaveBeenCalledTimes(2)
    })

    it('active=false 时切回可见 → 不获取', async () => {
        const { request } = installWakeLock()
        renderHook(({ a }: { a: boolean }) => useWakeLock(a), {
            initialProps: { a: false },
        })
        await flush()
        setVisibility('hidden')
        document.dispatchEvent(new Event('visibilitychange'))
        setVisibility('visible')
        document.dispatchEvent(new Event('visibilitychange'))
        await flush()
        expect(request).not.toHaveBeenCalled()
    })

    it('卸载 → 释放当前 sentinel', async () => {
        const { releases } = installWakeLock()
        const { unmount } = renderHook(() => useWakeLock(true))
        await flush()
        unmount()
        expect(releases[0].release).toHaveBeenCalledTimes(1)
    })
})
