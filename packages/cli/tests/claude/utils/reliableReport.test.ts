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
import { ReliableRewindReportQueue, type AckSocket, type PendingRewindReport } from '../../../src/claude/utils/reliableReport'

vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

/** 可控的 fake ack socket：捕获 emitAck，ack 由测试手动触发 */
function makeFakeSocket(connected = true) {
    const calls: { event: string; body: unknown; ack: (err?: unknown, res?: unknown) => void }[] = []
    const socket: AckSocket = {
        get connected() { return connected },
        emitAck: (event, body, callback) => { calls.push({ event, body, ack: callback }) },
    }
    return {
        socket,
        calls,
        setConnected(next: boolean) { connected = next },
    }
}

const truncated: PendingRewindReport = {
    event: 'rewound-truncated',
    body: { sid: 's1', nativeId: 'u1', deleteFromSeq: 3 },
}
const completed: PendingRewindReport = {
    event: 'rewind-completed',
    body: { sid: 's1', filesRestored: true },
}

/**
 * ReliableRewindReportQueue（M5：两段回报 ack + 重放）。
 * @see packages/cli/src/claude/utils/reliableReport.ts
 */
describe('ReliableRewindReportQueue', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('ack 成功 → 出队；单飞保序（truncated ack 前 completed 不发）', () => {
        const fake = makeFakeSocket()
        const queue = new ReliableRewindReportQueue(fake.socket, 5_000)

        queue.enqueue(truncated)
        queue.enqueue(completed)
        // 只发了队首 truncated，completed 等待
        expect(fake.calls.map(c => c.event)).toEqual(['rewound-truncated'])

        fake.calls[0]!.ack(null)
        // truncated 已确认 → completed 接续发出
        expect(fake.calls.map(c => c.event)).toEqual(['rewound-truncated', 'rewind-completed'])
        expect(queue.size).toBe(1)

        fake.calls[1]!.ack(null)
        expect(queue.size).toBe(0)
    })

    it('ack 失败/超时 → 队首保留，重试间隔后原样重发', () => {
        const fake = makeFakeSocket()
        const queue = new ReliableRewindReportQueue(fake.socket, 5_000)

        queue.enqueue(truncated)
        fake.calls[0]!.ack(new Error('timeout'))
        expect(queue.size).toBe(1)

        // 间隔未到：不重发
        vi.advanceTimersByTime(4_999)
        expect(fake.calls).toHaveLength(1)

        // 间隔到：原样重发
        vi.advanceTimersByTime(1)
        expect(fake.calls).toHaveLength(2)
        expect(fake.calls[1]!.body).toEqual(truncated.body)

        // 重发 ack 成功 → 队列清空
        fake.calls[1]!.ack(null)
        expect(queue.size).toBe(0)
    })

    it('断线不发，重连 onConnected 补发', () => {
        const fake = makeFakeSocket(false)
        const queue = new ReliableRewindReportQueue(fake.socket, 5_000)

        queue.enqueue(truncated)
        expect(fake.calls).toHaveLength(0)

        fake.setConnected(true)
        queue.onConnected()
        expect(fake.calls).toHaveLength(1)
        fake.calls[0]!.ack(null)
        expect(queue.size).toBe(0)
    })

    it('ack 失败后断线：重试 timer 到点但未连接不发；重连后再发', () => {
        const fake = makeFakeSocket()
        const queue = new ReliableRewindReportQueue(fake.socket, 5_000)

        queue.enqueue(truncated)
        fake.calls[0]!.ack(new Error('timeout'))
        fake.setConnected(false)
        vi.advanceTimersByTime(5_000)
        expect(fake.calls).toHaveLength(1)

        fake.setConnected(true)
        queue.onConnected()
        expect(fake.calls).toHaveLength(2)
    })

    it('连续失败：重试不叠加 timer（同一时刻至多一个在途、一个 timer）', () => {
        const fake = makeFakeSocket()
        const queue = new ReliableRewindReportQueue(fake.socket, 5_000)

        queue.enqueue(truncated)
        fake.calls[0]!.ack(new Error('t1'))
        vi.advanceTimersByTime(5_000)
        fake.calls[1]!.ack(new Error('t2'))
        vi.advanceTimersByTime(5_000)
        // 两次重试各一条在途，无并发
        expect(fake.calls).toHaveLength(3)
        expect(queue.size).toBe(1)
    })
})
