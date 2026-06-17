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
import type { SyncEvent } from '@mobi/shared'

// 捕获最近一次 fetchEventSource 调用的 options(onopen/onmessage/onclose/onerror 回调),
// 让测试可手动触发这些回调,精确控制 SSE 生命周期
const lastOptions = vi.hoisted(() => ({ current: {} as Record<string, any> }))

vi.mock('@microsoft/fetch-event-source', () => ({
    fetchEventSource: vi.fn(async (_url: string, options?: any) => {
        lastOptions.current = options ?? {}
    }),
}))

import { fetchEventSource } from '@microsoft/fetch-event-source'
import { SSEClient } from '@/core/data/realtime/sseClient'

// ── 测试辅助 ──────────────────────────────────────────────

/** 重置 mock:清调用记录 + 重设 implementation(保存 options 到 lastOptions) */
function resetFetchMock() {
    lastOptions.current = {}
    vi.mocked(fetchEventSource).mockClear()
    vi.mocked(fetchEventSource).mockImplementation(async (_url: string, options?: any) => {
        lastOptions.current = options ?? {}
    })
}

/** 构造伪 Response */
function makeResponse(status: number): Response {
    return { status, ok: status >= 200 && status < 300 } as Response
}

/** 连接并模拟首次 onopen(建立连接,hasConnected=true) */
async function openConn(client: SSEClient): Promise<void> {
    await client.connect()
    await lastOptions.current.onopen(makeResponse(200))
}

/** 模拟收到一个 SSE 事件(触发 onmessage,刷新活动时间) */
function emit(event: SyncEvent): void {
    lastOptions.current.onmessage({ data: JSON.stringify(event) })
}

/** 设置 document.hidden(mock visibility,默认可见) */
function setHidden(hidden: boolean): void {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
}

describe('SSEClient 后台连接稳定性', () => {
    beforeEach(() => {
        resetFetchMock()
    })

    it('切走页面/最小化时保持 SSE 连接(openWhenHidden: true)', async () => {
        // @microsoft/fetch-event-source 默认 openWhenHidden=false,
        // 页面进入 hidden 会主动 abort 连接——必须显式覆盖为 true
        const client = new SSEClient(() => 'http://localhost/api/events?token=t')
        await client.connect()

        expect(fetchEventSource).toHaveBeenCalledTimes(1)
        const options = vi.mocked(fetchEventSource).mock.calls[0][1]
        expect(options.openWhenHidden).toBe(true)
    })

    it('正常传入 URL 与 abort signal', async () => {
        const url = 'http://localhost/api/events?token=abc'
        const client = new SSEClient(() => url)
        await client.connect()

        expect(fetchEventSource).toHaveBeenCalledTimes(1)
        const [calledUrl] = vi.mocked(fetchEventSource).mock.calls[0]
        expect(calledUrl).toBe(url)
        // signal 用于 disconnect 时 abort,必须存在
        expect(vi.mocked(fetchEventSource).mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    })

    it('disconnect 后 abort signal 被触发', async () => {
        const client = new SSEClient(() => 'http://localhost/api/events?token=t')
        await client.connect()
        const signal = vi.mocked(fetchEventSource).mock.calls[0][1].signal
        expect(signal.aborted).toBe(false)

        client.disconnect()
        expect(signal.aborted).toBe(true)
    })
})

describe('SSEClient 重连分支', () => {
    beforeEach(() => {
        resetFetchMock()
    })

    it('首次连接 onopen 不发 connection-changed 事件', async () => {
        const client = new SSEClient(() => 'http://localhost/api/events?token=t')
        const events: SyncEvent[] = []
        client.subscribe((e) => events.push(e))
        await openConn(client)

        expect(events.filter((e) => e.type === 'connection-changed')).toHaveLength(0)
    })

    it('重连(connect 复用)onopen 走重连分支,发 connected:true + reconnected:true', async () => {
        const client = new SSEClient(() => 'http://localhost/api/events?token=t')
        const events: SyncEvent[] = []
        client.subscribe((e) => events.push(e))
        await openConn(client)
        expect(events).toHaveLength(0)

        // 模拟重连:connect 复用(由 scheduleReconnect 或 forceReconnect 触发)
        await client.connect()
        await lastOptions.current.onopen(makeResponse(200))

        // 重连分支应通知 connected:true reconnected:true(触发 SSEProvider 补拉漏数据)
        expect(events).toContainEqual({ type: 'connection-changed', connected: true, reconnected: true })
    })
})

describe('SSEClient 活动追踪 isStale', () => {
    beforeEach(() => {
        resetFetchMock()
        setHidden(false)
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
        setHidden(false)
    })

    it('连接/收到事件后 isStale() 为 false', async () => {
        const client = new SSEClient(() => 'url')
        await openConn(client)
        expect(client.isStale()).toBe(false)
        emit({ type: 'heartbeat' })
        expect(client.isStale()).toBe(false)
        // 距上次活动 89.999s 仍未过期(90s 阈值,留 1ms 余量)
        vi.advanceTimersByTime(89_999)
        expect(client.isStale()).toBe(false)
    })

    it('超过 90s 无活动 isStale() 为 true', async () => {
        const client = new SSEClient(() => 'url')
        await openConn(client)
        vi.advanceTimersByTime(90_000)
        expect(client.isStale()).toBe(true)
    })

    it('收到 heartbeat 也刷新活动时间(不被误判半死)', async () => {
        const client = new SSEClient(() => 'url')
        await openConn(client)
        vi.advanceTimersByTime(80_000)
        emit({ type: 'heartbeat' }) // hub 30s 心跳刷新活动时间
        vi.advanceTimersByTime(80_000) // 距上次活动 80s
        expect(client.isStale()).toBe(false)
    })
})

describe('SSEClient 心跳 watchdog', () => {
    beforeEach(() => {
        resetFetchMock()
        setHidden(false)
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
        setHidden(false)
    })

    it('前台 + 90s 无活动 → watchdog 触发重连', async () => {
        const client = new SSEClient(() => 'url')
        await openConn(client)
        expect(fetchEventSource).toHaveBeenCalledTimes(1)

        // watchdog 每 10s 检查,90s 时 isStale → forceReconnect → connect
        await vi.advanceTimersByTimeAsync(90_000)
        expect(fetchEventSource).toHaveBeenCalledTimes(2)
    })

    it('hidden 时 watchdog 跳过检查,不重连(移动端后台节流误判防护)', async () => {
        setHidden(true)
        const client = new SSEClient(() => 'url')
        await openConn(client)
        expect(fetchEventSource).toHaveBeenCalledTimes(1)

        // 后台超时也不重连(交给回前台逻辑处理)
        await vi.advanceTimersByTimeAsync(120_000)
        expect(fetchEventSource).toHaveBeenCalledTimes(1)
    })
})

describe('SSEClient reconnectIfStale / 防叠加', () => {
    beforeEach(() => {
        resetFetchMock()
        setHidden(false)
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
        setHidden(false)
    })

    it('非 stale 时 reconnectIfStale 返回 false 且不重连', async () => {
        const client = new SSEClient(() => 'url')
        await openConn(client)
        expect(client.reconnectIfStale()).toBe(false)
        await vi.advanceTimersByTimeAsync(0)
        expect(fetchEventSource).toHaveBeenCalledTimes(1)
    })

    it('stale 时 reconnectIfStale 返回 true 并触发重连', async () => {
        // 模拟后台期间连接变 stale:hidden 时 watchdog 跳过,留给 reconnectIfStale(回前台)处理
        setHidden(true)
        const client = new SSEClient(() => 'url')
        await openConn(client)
        vi.advanceTimersByTime(90_000) // 后台 90s → stale(watchdog hidden 跳过)
        expect(client.reconnectIfStale()).toBe(true)
        await vi.advanceTimersByTimeAsync(0) // flush 重连 connect 的 microtask
        expect(fetchEventSource).toHaveBeenCalledTimes(2)
    })

    it('防叠加:同次连接周期内重复请求只重连一次,onopen 后守卫恢复', async () => {
        setHidden(true) // 隔离 watchdog,专注于 reconnectIfStale 的守卫语义
        const client = new SSEClient(() => 'url')
        await openConn(client)
        vi.advanceTimersByTime(90_000)

        // 第 1 次触发重连(reconnectRequested 置位)
        expect(client.reconnectIfStale()).toBe(true)
        await vi.advanceTimersByTimeAsync(0) // flush 重连 connect

        // 同次周期内第 2 次(尚未 onopen):守卫挡住,不重复重连
        expect(client.reconnectIfStale()).toBe(false)
        await vi.advanceTimersByTimeAsync(0)
        expect(fetchEventSource).toHaveBeenCalledTimes(2) // 仍只重连 1 次

        // 新连接 onopen → 守卫重置,可再次触发(半死新连接仍可恢复)
        await lastOptions.current.onopen(makeResponse(200))
        vi.advanceTimersByTime(90_000)
        expect(client.reconnectIfStale()).toBe(true)
    })
})
