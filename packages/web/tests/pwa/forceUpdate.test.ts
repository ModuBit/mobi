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
import { planForceUpdate } from '@/core/pwa/forceUpdate'

describe('planForceUpdate', () => {
    it('无 SW 支持 → reload(直接刷新,绕过一切)', () => {
        expect(planForceUpdate({ hasSw: false, hasWaiting: false })).toBe('reload')
    })

    it('有 SW 且有 waiting 新 SW → skipWaiting(复用激活链路)', () => {
        expect(planForceUpdate({ hasSw: true, hasWaiting: true })).toBe('skipWaiting')
    })

    it('有 SW 但无 waiting → clearCaches(应对 SW 未检测到更新但版本不对)', () => {
        expect(planForceUpdate({ hasSw: true, hasWaiting: false })).toBe('clearCaches')
    })
})

describe('forceUpdateAndReload', () => {
    let reloadSpy: ReturnType<typeof vi.fn>
    let originalCaches: CacheStorage | undefined
    let originalSW: unknown

    beforeEach(() => {
        // resetModules 重置 forceUpdate.ts 模块级 forcing 标志
        // (测试无真实 reload,forcing 会跨用例泄露,必须每用例重置模块实例)
        vi.resetModules()

        // mock window.location.reload(jsdom 无 location.reload 实现)
        reloadSpy = vi.fn()
        Object.defineProperty(window, 'location', {
            value: { ...window.location, reload: reloadSpy },
            writable: true,
        })

        // mock caches(无 waiting 分支会清缓存)
        originalCaches = (window as unknown as { caches?: CacheStorage }).caches
        Object.defineProperty(window, 'caches', {
            value: {
                keys: vi.fn().mockResolvedValue(['precache-v2', 'runtime']),
                delete: vi.fn().mockResolvedValue(true),
            },
            configurable: true,
        })

        // 默认无 SW(走 clearCaches → reload)
        originalSW = (navigator as unknown as { serviceWorker?: unknown }).serviceWorker
        delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker
    })

    afterEach(() => {
        vi.restoreAllMocks()
        Object.defineProperty(window, 'caches', { value: originalCaches, configurable: true })
        ;(navigator as unknown as { serviceWorker?: unknown }).serviceWorker = originalSW
    })

    it('无 SW → 清缓存并 reload', async () => {
        const { forceUpdateAndReload } = await import('@/core/pwa/forceUpdate')
        await forceUpdateAndReload()
        expect(reloadSpy).toHaveBeenCalledTimes(1)
    })

    it('重复调用被去重(正在硬刷新中,第二次直接 return)', async () => {
        const { forceUpdateAndReload } = await import('@/core/pwa/forceUpdate')
        await forceUpdateAndReload()
        await forceUpdateAndReload()
        // reload 只被调用一次(第二次被 forcing 标志挡掉)
        expect(reloadSpy).toHaveBeenCalledTimes(1)
    })
})
