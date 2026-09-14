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
import type { DesktopViewCallbacks } from '@/core/desktop/desktopStreamClient'

/**
 * mock connectDesktopView：捕获每次连接的 callbacks（手动触发事件）与 disconnect spy。
 * 走 desktopStreamClient 的回调面（含 close code 语义），比 fake Rfb 更贴近真实链路。
 * 模块级稳定 mock 引用（避免 effect 循环陷阱——项目已知问题）。
 */
const rfbCallbacksPerConnection: DesktopViewCallbacks[][] = [[]]
const disconnectSpies: Array<ReturnType<typeof vi.fn>> = []

vi.mock('@/core/desktop/desktopStreamClient', () => ({
    connectDesktopView: vi.fn(async ({ callbacks }: { callbacks: DesktopViewCallbacks }) => {
        rfbCallbacksPerConnection[rfbCallbacksPerConnection.length - 1].push(callbacks)
        const disconnect = vi.fn()
        disconnectSpies.push(disconnect)
        return { disconnect }
    }),
    defaultRfbLoader: vi.fn(),
}))

/** 触发最新连接的 noVNC 事件 */
function emit(type: keyof DesktopViewCallbacks, detail?: unknown): void {
    const callbacks = rfbCallbacksPerConnection.at(-1)!.at(-1)!
    if (type === 'onConnect') callbacks.onConnect?.()
    else if (type === 'onDisconnect') callbacks.onDisconnect?.(detail as { clean: boolean })
    else if (type === 'onFailure') callbacks.onFailure?.(detail as string)
}

/** 稳定的 watch mock（引用稳定，避免 effect 循环陷阱） */
const watchMock = vi.fn<(machineId: string) => Promise<string>>()

function makeProvider() {
    return new DesktopStreamProvider({ watch: watchMock })
}

describe('DesktopStreamProvider 引用计数', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        rfbCallbacksPerConnection.length = 0
        rfbCallbacksPerConnection.push([])
        disconnectSpies.length = 0
        watchMock.mockReset()
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
        rfbCallbacksPerConnection.length = 0
        rfbCallbacksPerConnection.push([])
        disconnectSpies.length = 0
        watchMock.mockReset()
        watchMock.mockResolvedValue('token-1')
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('有引用时网络类异常断开（1006）→ 自动重走 watch（幂等恢复）', async () => {
        const provider = makeProvider()
        const lease = provider.acquire('m1')
        await vi.advanceTimersByTimeAsync(0)
        expect(watchMock).toHaveBeenCalledTimes(1)

        emit('onDisconnect', { clean: false, close: { code: 1006, reason: '' } })
        await vi.advanceTimersByTimeAsync(0)

        expect(watchMock).toHaveBeenCalledTimes(2)
        lease.release()
        provider.dispose()
    })

    it.each([4000, 4002])('服务端主动关闭（code=%i）→ 归因展示不自动重连', async (code) => {
        const provider = makeProvider()
        const lease = provider.acquire('m1')
        await vi.advanceTimersByTimeAsync(0)
        expect(watchMock).toHaveBeenCalledTimes(1)

        emit('onDisconnect', { clean: false, close: { code, reason: '' } })
        // 退避窗口走完也不重连
        await vi.advanceTimersByTimeAsync(60_000)
        expect(watchMock).toHaveBeenCalledTimes(1)
        expect(provider.getState('m1').phase).toBe('error')

        lease.release()
        provider.dispose()
    })

    it('watch 失败 → error 态 + 退避重试，重试成功翻回非 error', async () => {
        watchMock.mockRejectedValueOnce(new Error('cli offline')).mockResolvedValue('token-2')
        const provider = makeProvider()
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
        rfbCallbacksPerConnection.length = 0
        rfbCallbacksPerConnection.push([])
        disconnectSpies.length = 0
        watchMock.mockReset()
        watchMock.mockResolvedValue('token-1')
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('attachTo 把容器搬进 host；二次 attach 天然移动到新 host；release 时脱离', async () => {
        const provider = makeProvider()
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
