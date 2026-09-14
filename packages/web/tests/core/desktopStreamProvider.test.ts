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
import { DesktopStreamProvider, DESKTOP_STREAM_GRACE_MS } from '@/core/desktop/desktopStreamProvider'
import type { RfbConstructor } from '@/core/desktop/desktopStreamClient'

/**
 * fake noVNC 构造器：addEventListener 收集事件监听，手动触发。
 * 模块级单例（稳定引用，避免 hook 循环陷阱——项目已知问题）。
 */
const rfbListeners = new Map<string, Array<(event: unknown) => void>>()
const disconnectSpies: Array<ReturnType<typeof vi.fn>> = []

function makeRfbLoader(): { loader: () => Promise<RfbConstructor>; emit: (type: string, detail?: unknown) => void } {
    const RfbCtor = function (this: unknown, _target: HTMLElement) {
        const listeners: Record<string, Array<(event: unknown) => void>> = {}
        rfbListeners.clear()
        Object.defineProperty(this, 'scaleViewport', { value: true, writable: true })
        Object.defineProperty(this, 'viewOnly', { value: true, writable: true })
        Object.defineProperty(this, 'background', { value: 'transparent', writable: true })
        ;(this as { addEventListener: (type: string, fn: (e: unknown) => void) => void }).addEventListener = (
            type,
            fn,
        ) => {
            listeners[type] = listeners[type] ?? []
            listeners[type].push(fn)
            rfbListeners.set(type, listeners[type])
        }
        const disconnect = vi.fn(() => {
            rfbListeners.get('disconnect')?.forEach((fn) => fn({ detail: { clean: true } }))
        })
        disconnectSpies.push(disconnect)
        ;(this as { disconnect: () => void }).disconnect = disconnect
    } as unknown as RfbConstructor
    return {
        loader: () => Promise.resolve(RfbCtor),
        emit: (type, detail) => {
            rfbListeners.get(type)?.forEach((fn) => fn({ detail }))
        },
    }
}

/** 稳定的 watch mock（引用稳定，避免 effect 循环陷阱） */
const watchMock = vi.fn<(machineId: string) => Promise<string>>()

function makeProvider() {
    return new DesktopStreamProvider({ watch: watchMock, loader: makeRfbLoader().loader })
}

// 测试用的稳定 watch/loader（供直接构造 provider 的场景）
const { loader: stableLoader, emit } = makeRfbLoader()

function makeStableProvider() {
    return new DesktopStreamProvider({ watch: watchMock, loader: stableLoader })
}

describe('DesktopStreamProvider 引用计数', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        watchMock.mockReset()
        disconnectSpies.length = 0
        watchMock.mockResolvedValue('token-1')
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('同 machineId 两个 lease 复用同一条连接（watch 与 noVNC 只走一次）', async () => {
        const provider = makeProvider()
        const lease1 = provider.acquire('m1')
        const lease2 = provider.acquire('m1')
        await vi.advanceTimersByTimeAsync(0)

        expect(watchMock).toHaveBeenCalledTimes(1)

        lease1.release()
        lease2.release()
        provider.dispose()
    })

    it('引用归零起 30s 宽限，宽限满才断开', async () => {
        const provider = makeProvider()
        const lease = provider.acquire('m1')
        await vi.advanceTimersByTimeAsync(0)

        lease.release()
        expect(disconnectSpies[0]).not.toHaveBeenCalled()

        vi.advanceTimersByTime(DESKTOP_STREAM_GRACE_MS - 1)
        expect(disconnectSpies[0]).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1)
        expect(disconnectSpies[0]).toHaveBeenCalledTimes(1)
        provider.dispose()
    })

    it('宽限期内重新 acquire 复用连接，宽限定时器取消', async () => {
        const provider = makeProvider()
        const lease1 = provider.acquire('m1')
        await vi.advanceTimersByTimeAsync(0)
        lease1.release()

        vi.advanceTimersByTime(DESKTOP_STREAM_GRACE_MS / 2)
        const lease2 = provider.acquire('m1')
        await vi.advanceTimersByTimeAsync(0)

        expect(watchMock).toHaveBeenCalledTimes(1) // 未重连
        vi.advanceTimersByTime(DESKTOP_STREAM_GRACE_MS)
        expect(disconnectSpies[0]).not.toHaveBeenCalled() // 宽限定时器未触发

        lease2.release()
        vi.advanceTimersByTime(DESKTOP_STREAM_GRACE_MS)
        expect(disconnectSpies[0]).toHaveBeenCalledTimes(1)
        provider.dispose()
    })
})

describe('DesktopStreamProvider 断线恢复', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        watchMock.mockReset()
        disconnectSpies.length = 0
        watchMock.mockResolvedValue('token-1')
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('有引用时异常断开 → 自动重走 watch（幂等恢复）', async () => {
        const provider = makeStableProvider()
        const lease = provider.acquire('m1')
        await vi.advanceTimersByTimeAsync(0)
        expect(watchMock).toHaveBeenCalledTimes(1)

        emit('disconnect', { clean: false })
        await vi.advanceTimersByTimeAsync(0)

        expect(watchMock).toHaveBeenCalledTimes(2)
        lease.release()
        provider.dispose()
    })

    it('无引用时断开不重连（宽限语义之外的 clean 断开）', async () => {
        const provider = makeStableProvider()
        const lease = provider.acquire('m1')
        await vi.advanceTimersByTimeAsync(0)
        lease.release()
        vi.advanceTimersByTime(DESKTOP_STREAM_GRACE_MS)

        emit('disconnect', { clean: false })
        await vi.advanceTimersByTimeAsync(0)
        expect(watchMock).toHaveBeenCalledTimes(1)
        provider.dispose()
    })

    it('watch 失败 → error 态 + 退避重试，重试成功翻回 connecting/connected', async () => {
        watchMock.mockRejectedValueOnce(new Error('cli offline')).mockResolvedValue('token-2')
        const provider = makeStableProvider()
        const lease = provider.acquire('m1')

        await vi.advanceTimersByTimeAsync(0)
        expect(provider.getState('m1')).toMatchObject({ phase: 'error' })

        // 退避 1s 后重试成功
        await vi.advanceTimersByTimeAsync(1_000)
        expect(watchMock).toHaveBeenCalledTimes(2)
        expect(provider.getState('m1').phase).not.toBe('error')

        lease.release()
        provider.dispose()
    })
})

describe('DesktopStreamProvider DOM 搬迁', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        watchMock.mockReset()
        disconnectSpies.length = 0
        watchMock.mockResolvedValue('token-1')
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('attachTo 把容器搬进 host；二次 attach 天然移动到新 host；release 时脱离', async () => {
        const provider = makeStableProvider()
        const lease = provider.acquire('m1')
        await vi.advanceTimersByTimeAsync(0)

        const host1 = document.createElement('div')
        const host2 = document.createElement('div')
        document.body.append(host1, host2)

        lease.attachTo(host1)
        const container = host1.firstElementChild
        expect(container).not.toBeNull()

        lease.attachTo(host2)
        expect(host1.firstElementChild).toBeNull()
        expect(host2.firstElementChild).toBe(container)

        lease.release()
        expect(host2.firstElementChild).toBeNull()
        provider.dispose()
    })
})
