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
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useCachedInstance, clearCachedInstance, clearAllInstances } from '@/core/hooks/useCachedInstance'
import { renderHook } from '@testing-library/react'

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
})

describe('useCachedInstance', () => {
    it('首次 mount 调用 factory 创建实例', () => {
        const factory = vi.fn(() => ({ id: 'A' }))
        const { result } = renderHook(() => useCachedInstance('k1', factory))
        expect(factory).toHaveBeenCalledTimes(1)
        expect(result.current.instance).toEqual({ id: 'A' })
        expect(result.current.isReady).toBe(true)
    })

    it('unmount 不调 dispose，remount 复用同一实例（factory 不再调用）', () => {
        const factory = vi.fn(() => ({ id: 'B' }))
        const dispose = vi.fn()
        const r1 = renderHook(() => useCachedInstance('k2', factory, dispose))
        const first = r1.result.current.instance
        r1.unmount()
        expect(dispose).not.toHaveBeenCalled()

        const r2 = renderHook(() => useCachedInstance('k2', factory, dispose))
        expect(factory).toHaveBeenCalledTimes(1)
        expect(r2.result.current.instance).toBe(first)
    })

    it('不同 key 各自独立', () => {
        const fa = vi.fn(() => ({ tag: 'a' }))
        const fb = vi.fn(() => ({ tag: 'b' }))
        const ra = renderHook(() => useCachedInstance('ka', fa))
        const rb = renderHook(() => useCachedInstance('kb', fb))
        expect(ra.result.current.instance).toEqual({ tag: 'a' })
        expect(rb.result.current.instance).toEqual({ tag: 'b' })
    })

    it('同一 key 并发挂载复用同一实例（refCount 累加，factory 仅一次）', () => {
        const factory = vi.fn(() => ({ tag: 'shared' }))
        const r1 = renderHook(() => useCachedInstance('kdup', factory))
        const r2 = renderHook(() => useCachedInstance('kdup', factory))
        expect(factory).toHaveBeenCalledTimes(1)
        expect(r1.result.current.instance).toBe(r2.result.current.instance)
        // 卸载其一，实例仍存活（另一个仍持有）
        r1.unmount()
        expect(r2.result.current.instance).toEqual({ tag: 'shared' })
    })

    it('clearCachedInstance 调用 dispose 并删除条目，下次 mount 重新创建', () => {
        const dispose = vi.fn()
        let count = 0
        const factory = vi.fn(() => ({ n: ++count }))
        const r1 = renderHook(() => useCachedInstance('k3', factory, dispose))
        const first = r1.result.current.instance
        r1.unmount()

        clearCachedInstance('k3')
        expect(dispose).toHaveBeenCalledWith(first)

        const r2 = renderHook(() => useCachedInstance('k3', factory, dispose))
        expect(r2.result.current.instance).not.toBe(first)
        expect(r2.result.current.instance).toEqual({ n: 2 })
    })

    it('isReady 在 effect 同步后置真', () => {
        const r = renderHook(() => useCachedInstance('k4', () => ({ x: 1 })))
        expect(r.result.current.isReady).toBe(true)
        r.unmount()
    })

    it('clearAllInstances 清空全部：逐个 dispose 并允许重建', () => {
        const disposeA = vi.fn()
        const disposeB = vi.fn()
        const ra = renderHook(() => useCachedInstance('kall-a', () => ({ tag: 'a' }), disposeA))
        const rb = renderHook(() => useCachedInstance('kall-b', () => ({ tag: 'b' }), disposeB))
        const firstA = ra.result.current.instance
        const firstB = rb.result.current.instance
        ra.unmount()
        rb.unmount()

        clearAllInstances()
        expect(disposeA).toHaveBeenCalledWith(firstA)
        expect(disposeB).toHaveBeenCalledWith(firstB)

        // 清空后重建得到新实例
        const ra2 = renderHook(() => useCachedInstance('kall-a', () => ({ tag: 'a' })))
        expect(ra2.result.current.instance).not.toBe(firstA)
    })
})
