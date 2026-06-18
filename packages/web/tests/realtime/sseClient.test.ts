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

/**
 * 存活态 mock:返回 pending promise,仅 signal.abort 时 resolve(模拟真实库行为)。
 *
 * 默认 mock 立即 resolve,connect() 的 await 不保持 pending——无法表示"连接存活"这一
 * watchdog/forceReconnect 竞态的前提。存活态 mock 让连接建立后 await 持续 pending(像真实连接),
 * 仅在 disconnect/forceReconnect abort 时 settle,从而能复现"旧 connect 的 finally 与新 connect 竞态"。
 */
function useLiveMock() {
    vi.mocked(fetchEventSource).mockImplementation((_url: string, options?: any) => {
        lastOptions.current = options ?? {}
        const signal = options?.signal as AbortSignal | undefined
        return new Promise<void>((resolve) => {
            if (signal?.aborted) {
                resolve()
                return
            }
            signal?.addEventListener('abort', () => resolve(), { once: true })
        })
    })
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

describe('SSEClient 重连退避与抖动', () => {
    let randomSpy: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
        resetFetchMock()
        setHidden(false)
        vi.useFakeTimers()
        // 默认 jitter=0,精确验证退避;jitter 用例单独覆盖
        randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
    })
    afterEach(() => {
        randomSpy.mockRestore()
        vi.useRealTimers()
        setHidden(false)
    })

    it('onerror 抛错而非返回 delay(停止库内部重连,统一走 scheduleReconnect)', async () => {
        const client = new SSEClient(() => 'url')
        const events: SyncEvent[] = []
        client.subscribe((e) => events.push(e))
        await openConn(client) // isConnected=true
        // onerror 应抛错:库 catch → reject → connect catch → scheduleReconnect 单一入口
        expect(() => lastOptions.current.onerror(new Error('net'))).toThrow('net')
        // 抛错前先通知断连
        expect(events).toContainEqual({ type: 'connection-changed', connected: false })
    })

    it('连接错误(fetchEventSource reject)经 connect catch → scheduleReconnect 重连', async () => {
        // 模拟库 reject(onerror throw 后的库行为)→ connect catch → scheduleReconnect
        vi.mocked(fetchEventSource).mockImplementationOnce(async (_u: string, o?: any) => {
            lastOptions.current = o ?? {}
            throw new Error('rejected')
        })
        const client = new SSEClient(() => 'url')
        await client.connect()
        expect(fetchEventSource).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(1000) // 首次退避 1s
        expect(fetchEventSource).toHaveBeenCalledTimes(2) // 重连
    })

    it('连续失败指数退避:1s → 2s → 4s', async () => {
        const client = new SSEClient(() => 'url')
        await openConn(client)

        // 第 1 次:delay=1s(attempt=0)
        lastOptions.current.onclose()
        await vi.advanceTimersByTimeAsync(999)
        expect(fetchEventSource).toHaveBeenCalledTimes(1) // 未到
        await vi.advanceTimersByTimeAsync(1)
        expect(fetchEventSource).toHaveBeenCalledTimes(2) // attempt→1

        // 第 2 次:delay=2s(attempt=1)
        lastOptions.current.onclose()
        await vi.advanceTimersByTimeAsync(1999)
        expect(fetchEventSource).toHaveBeenCalledTimes(2)
        await vi.advanceTimersByTimeAsync(1)
        expect(fetchEventSource).toHaveBeenCalledTimes(3) // attempt→2

        // 第 3 次:delay=4s(attempt=2)
        lastOptions.current.onclose()
        await vi.advanceTimersByTimeAsync(3999)
        expect(fetchEventSource).toHaveBeenCalledTimes(3)
        await vi.advanceTimersByTimeAsync(1)
        expect(fetchEventSource).toHaveBeenCalledTimes(4) // attempt→3
    })

    it('重连含 jitter:delay = 退避值 + 0~500ms', async () => {
        randomSpy.mockReturnValue(0.5) // jitter = 0.5 * 500 = 250ms
        const client = new SSEClient(() => 'url')
        await openConn(client)
        lastOptions.current.onclose()
        // delay = 1000 + 250 = 1250ms
        await vi.advanceTimersByTimeAsync(1249)
        expect(fetchEventSource).toHaveBeenCalledTimes(1) // 未到
        await vi.advanceTimersByTimeAsync(1)
        expect(fetchEventSource).toHaveBeenCalledTimes(2)
    })

    it('成功重连后 onopen 重置退避(下次 delay 回到 1s,非继续翻倍)', async () => {
        const client = new SSEClient(() => 'url')
        await openConn(client)
        // 退避两次(attempt→2,delay 应为 4s)
        lastOptions.current.onclose()
        await vi.advanceTimersByTimeAsync(1000) // 重连,attempt→1
        lastOptions.current.onclose()
        await vi.advanceTimersByTimeAsync(2000) // 重连,attempt→2
        // 成功 onopen → 退避归零
        await lastOptions.current.onopen(makeResponse(200))
        // 下次失败 delay 应回到 1s(若不重置则为 8s)
        lastOptions.current.onclose()
        await vi.advanceTimersByTimeAsync(999)
        expect(fetchEventSource).toHaveBeenCalledTimes(3) // 1s 未到
        await vi.advanceTimersByTimeAsync(1)
        expect(fetchEventSource).toHaveBeenCalledTimes(4)
    })
})

describe('SSEClient 连接存活态竞态(forceReconnect 不被旧 finally 破坏)', () => {
    beforeEach(() => {
        resetFetchMock()
        useLiveMock()
        setHidden(false)
        vi.useFakeTimers()
    })
    afterEach(() => {
        vi.useRealTimers()
        setHidden(false)
        resetFetchMock()
    })

    it('watchdog forceReconnect 后,旧连接 finally 不破坏新连接的 isConnecting 守卫', async () => {
        const client = new SSEClient(() => 'url')
        // 连接 A(存活态:fetchEventSource pending,仅 abort 才 resolve)
        void client.connect()
        await vi.advanceTimersByTimeAsync(0) // flush:A 调 fetchEventSource
        await lastOptions.current.onopen(makeResponse(200)) // A 建立(lastActivityAt=now)
        expect(fetchEventSource).toHaveBeenCalledTimes(1)
        const signalA = lastOptions.current.signal // A 的 controller signal(forceReconnect 前保存)

        // 推进 90s:watchdog 检测半死 → forceReconnect
        // (teardown abort A → A 的 fetchEventSource resolve → A finally;connect B)
        await vi.advanceTimersByTimeAsync(90_000)
        await vi.advanceTimersByTimeAsync(0) // 充分 flush:A finally + B 启动
        expect(fetchEventSource).toHaveBeenCalledTimes(2) // B 已调用
        // 加强:直接验证状态机——A 已被 abort(清理)+ B 存活(新连接 signal 未破坏)
        expect(signalA.aborted).toBe(true)
        expect(lastOptions.current.signal.aborted).toBe(false)

        // 关键:此时 B 存活,isConnecting 应仍为 true。
        // 再调 connect() 模拟外部重复入口——守卫生效应被挡住,不启动第 3 个连接。
        // #5 修复前:A 的 finally 把 isConnecting 复位为 false → connect() 绕过守卫 → 启动第 3 个(3 次)。
        // #5 修复后:generation 校验,旧 finally 不复位 → connect() 被守卫挡(仍 2 次)。
        void client.connect()
        await vi.advanceTimersByTimeAsync(0)
        expect(fetchEventSource).toHaveBeenCalledTimes(2)

        client.disconnect()
    })
})
