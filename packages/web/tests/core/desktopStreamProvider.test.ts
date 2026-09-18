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
import type { DesktopWatchResponse } from '@mobi/shared'

/**
 * mock connectDesktopView：捕获每次连接的 callbacks（手动触发事件）与 disconnect spy。
 * 走 desktopStreamClient 的回调面（含 close code 语义），比 fake Rfb 更贴近真实链路。
 * 模块级稳定 mock 引用（避免 effect 循环陷阱——项目已知问题）。
 */
const rfbCallbacksPerConnection: DesktopViewCallbacks[][] = [[]]
const disconnectSpies: Array<ReturnType<typeof vi.fn>> = []
const setViewOnlySpies: Array<ReturnType<typeof vi.fn>> = []

vi.mock('@/core/desktop/desktopStreamClient', () => ({
    connectDesktopView: vi.fn(async ({ callbacks }: { callbacks: DesktopViewCallbacks }) => {
        rfbCallbacksPerConnection[rfbCallbacksPerConnection.length - 1].push(callbacks)
        const disconnect = vi.fn()
        const setViewOnly = vi.fn()
        disconnectSpies.push(disconnect)
        setViewOnlySpies.push(setViewOnly)
        return { disconnect, setViewOnly }
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
const watchMock = vi.fn<(machineId: string) => Promise<DesktopWatchResponse>>()

function makeProvider(deps: Partial<ConstructorParameters<typeof DesktopStreamProvider>[0]> = {}) {
    return new DesktopStreamProvider({ watch: watchMock, ...deps })
}

/** 控制权 API mock（返回 hub 权威状态） */
function makeControlDeps() {
    const grantControl = vi.fn<(machineId: string) => Promise<{ sessionId: string; machineId: string; control: 'view-only' | 'controlled' }>>()
    const releaseControl = vi.fn<(machineId: string) => Promise<{ sessionId: string; machineId: string; control: 'view-only' | 'controlled' }>>()
    grantControl.mockResolvedValue({ sessionId: 's1', machineId: 'm1', control: 'controlled' })
    releaseControl.mockResolvedValue({ sessionId: 's1', machineId: 'm1', control: 'view-only' })
    return { grantControl, releaseControl }
}

describe('DesktopStreamProvider 引用计数', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        // provider 直连 URL 依赖 vite define 注入的全局；测试环境 stub 为 undefined（落回 jsdom origin）
        vi.stubGlobal('__MOBI_HUB_URL__', undefined)
        rfbCallbacksPerConnection.length = 0
        rfbCallbacksPerConnection.push([])
        disconnectSpies.length = 0
        setViewOnlySpies.length = 0
        watchMock.mockReset()
        watchMock.mockResolvedValue({ observeToken: 'token-1', expiresAtMs: Date.now() + 60_000, control: 'view-only' })
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

    it('getConnection：connected 期间暴露输入句柄，销毁后收回', async () => {
        const provider = makeProvider()
        expect(provider.getConnection('m1')).toBeUndefined()

        const lease = provider.acquire('m1')
        await vi.advanceTimersByTimeAsync(0)
        expect(provider.getConnection('m1')).toBeDefined()

        lease.release()
        vi.advanceTimersByTime(DESKTOP_STREAM_GRACE_MS)
        expect(provider.getConnection('m1')).toBeUndefined()
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
        // provider 直连 URL 依赖 vite define 注入的全局；测试环境 stub 为 undefined（落回 jsdom origin）
        vi.stubGlobal('__MOBI_HUB_URL__', undefined)
        rfbCallbacksPerConnection.length = 0
        rfbCallbacksPerConnection.push([])
        disconnectSpies.length = 0
        setViewOnlySpies.length = 0
        watchMock.mockReset()
        watchMock.mockResolvedValue({ observeToken: 'token-1', expiresAtMs: Date.now() + 60_000, control: 'view-only' })
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it.each([4000, 4002, 4003])('服务端归因关闭（code=%i）→ 归因展示不自动重连', async (code) => {
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

    it('网络类断开的自动重连走退避（1s 后才重试，不立即打 watch）', async () => {
        const provider = makeProvider()
        const lease = provider.acquire('m1')
        await vi.advanceTimersByTimeAsync(0)
        expect(watchMock).toHaveBeenCalledTimes(1)

        emit('onDisconnect', { clean: false, close: { code: 1006, reason: '' } })
        // 立即不重连
        expect(watchMock).toHaveBeenCalledTimes(1)
        // 退避 1s 后重试
        await vi.advanceTimersByTimeAsync(1_000)
        expect(watchMock).toHaveBeenCalledTimes(2)

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
        // provider 直连 URL 依赖 vite define 注入的全局；测试环境 stub 为 undefined（落回 jsdom origin）
        vi.stubGlobal('__MOBI_HUB_URL__', undefined)
        rfbCallbacksPerConnection.length = 0
        rfbCallbacksPerConnection.push([])
        disconnectSpies.length = 0
        setViewOnlySpies.length = 0
        watchMock.mockReset()
        watchMock.mockResolvedValue({ observeToken: 'token-1', expiresAtMs: Date.now() + 60_000, control: 'view-only' })
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

describe('DesktopStreamProvider 控制权（迭代 2）', () => {
    let grantControl: ReturnType<typeof makeControlDeps>['grantControl']
    let releaseControl: ReturnType<typeof makeControlDeps>['releaseControl']

    beforeEach(() => {
        vi.useFakeTimers()
        vi.stubGlobal('__MOBI_HUB_URL__', undefined)
        rfbCallbacksPerConnection.length = 0
        rfbCallbacksPerConnection.push([])
        disconnectSpies.length = 0
        setViewOnlySpies.length = 0
        watchMock.mockReset()
        watchMock.mockResolvedValue({ observeToken: 'token-1', expiresAtMs: Date.now() + 60_000, control: 'view-only' })
        const deps = makeControlDeps()
        grantControl = deps.grantControl
        releaseControl = deps.releaseControl
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    async function acquireConnected(provider: DesktopStreamProvider) {
        const lease = provider.acquire('m1')
        await vi.advanceTimersByTimeAsync(0)
        emit('onConnect')
        return lease
    }

    it('初始状态 view-only；接管后翻 controlled 并解除 noVNC 只读', async () => {
        const provider = makeProvider({ grantControl, releaseControl })
        const lease = await acquireConnected(provider)

        expect(provider.getState('m1').control).toBe('view-only')
        await provider.grantControl('m1')

        expect(grantControl).toHaveBeenCalledWith('m1')
        expect(provider.getState('m1').control).toBe('controlled')
        expect(setViewOnlySpies[0]).toHaveBeenLastCalledWith(false)

        lease.release()
        provider.dispose()
    })

    it('退出控制回落 view-only 并恢复只读', async () => {
        const provider = makeProvider({ grantControl, releaseControl })
        const lease = await acquireConnected(provider)
        await provider.grantControl('m1')

        await provider.releaseControl('m1')

        expect(provider.getState('m1').control).toBe('view-only')
        expect(setViewOnlySpies[0]).toHaveBeenLastCalledWith(true)

        lease.release()
        provider.dispose()
    })

    it('hub 侧变化经 SSE 事件对齐（超时回落等），不自持权威状态', async () => {
        const provider = makeProvider({ grantControl, releaseControl })
        const lease = await acquireConnected(provider)
        await provider.grantControl('m1')
        expect(provider.getState('m1').control).toBe('controlled')

        provider.ingestControlEvent('m1', 'view-only')

        expect(provider.getState('m1').control).toBe('view-only')
        expect(setViewOnlySpies[0]).toHaveBeenLastCalledWith(true)

        lease.release()
        provider.dispose()
    })

    it('重连到新观看流必回 view-only（watch 权威初值，不重放旧流快照）', async () => {
        const provider = makeProvider({ grantControl, releaseControl })
        const lease = await acquireConnected(provider)
        await provider.grantControl('m1')
        expect(provider.getState('m1')).toMatchObject({ control: 'controlled' })

        // 断线：hub 拆旧流（控制权随流消亡），重连 watch 建新流——权威初值 view-only
        watchMock.mockResolvedValue({ observeToken: 'token-2', expiresAtMs: Date.now() + 60_000, control: 'view-only' })
        emit('onDisconnect', { clean: false, close: { code: 1006, reason: '' } })
        await vi.advanceTimersByTimeAsync(1_000)
        emit('onConnect')

        expect(setViewOnlySpies[1]).toHaveBeenCalledWith(true)
        expect(provider.getState('m1')).toMatchObject({ phase: 'connected', control: 'view-only' })

        lease.release()
        provider.dispose()
    })

    it('授予 API 失败：状态保持 view-only（hub 权威），错误向上抛给调用方', async () => {
        grantControl.mockRejectedValueOnce(new Error('Stream not found'))
        const provider = makeProvider({ grantControl, releaseControl })
        const lease = await acquireConnected(provider)

        await expect(provider.grantControl('m1')).rejects.toThrow('Stream not found')
        expect(provider.getState('m1').control).toBe('view-only')

        lease.release()
        provider.dispose()
    })
})
