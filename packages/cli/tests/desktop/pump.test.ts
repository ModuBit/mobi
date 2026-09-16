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

import { describe, expect, test } from 'vitest'
import { PassThrough } from 'node:stream'
import { createStreamPump, duplexEndpoint, type PumpEndpoint } from '../../src/desktop/pump'

/** 测试用 sleep（bun:test 移植 vitest 后替代 Bun.sleep） */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** 内存 Duplex 端点适配器的测试镜像（换实现方式后仍应成立的端点契约） */
function makeMemoryEndpoint() {
    const written: Uint8Array[] = []
    let drainCallback: (() => void) | null = null
    let open = true
    const endpoint: PumpEndpoint = {
        send(data) {
            if (!open) return false
            written.push(data)
            return true
        },
        pause() {},
        resume() {},
        onDrain(callback) {
            drainCallback = callback
        },
        close() {
            open = false
        },
        isOpen() {
            return open
        },
    }
    return {
        endpoint,
        written,
        drain: () => drainCallback?.(),
        setOpen: (value: boolean) => {
            open = value
        },
        isPaused: () => false,
    }
}

/** 记录 pause/resume 调用的端点包装 */
function withPauseTracking(endpoint: PumpEndpoint) {
    const calls: string[] = []
    return {
        endpoint: {
            ...endpoint,
            pause: () => {
                calls.push('pause')
                endpoint.pause()
            },
            resume: () => {
                calls.push('resume')
                endpoint.resume()
            },
        },
        calls,
    }
}

function bytes(...values: number[]): Uint8Array {
    return new Uint8Array(values)
}

describe('createStreamPump（内存端点）', () => {
    test('a→b 与 b→a 双向透传', () => {
        const a = makeMemoryEndpoint()
        const b = makeMemoryEndpoint()
        const pump = createStreamPump(a.endpoint, b.endpoint)

        pump.feed('a', bytes(1, 2, 3))
        pump.feed('b', bytes(9))

        expect(b.written).toEqual([bytes(1, 2, 3)])
        expect(a.written).toEqual([bytes(9)])
    })

    test('目标背压 → 来源被暂停；排空 → 恢复', () => {
        const aTracked = withPauseTracking(makeMemoryEndpoint().endpoint)
        const bDrainCallbacks: Array<() => void> = []
        const b: PumpEndpoint = {
            send: () => false, // 恒背压
            pause() {},
            resume() {},
            onDrain(callback) {
                bDrainCallbacks.push(callback)
            },
            close() {},
            isOpen: () => true,
        }
        const pump = createStreamPump(aTracked.endpoint, b)

        pump.feed('a', bytes(1))
        expect(aTracked.calls).toEqual(['pause'])

        // b 侧缓冲排空 → a 恢复读取
        for (const callback of bDrainCallbacks) {
            callback()
        }
        expect(aTracked.calls).toEqual(['pause', 'resume'])
    })

    test('目标关闭 → 泵 teardown 并通知', () => {
        const a = makeMemoryEndpoint()
        const b = makeMemoryEndpoint()
        const pump = createStreamPump(a.endpoint, b.endpoint)

        const reasons: string[] = []
        pump.onTeardown((reason) => reasons.push(reason))

        b.setOpen(false)
        pump.feed('a', bytes(1)) // 目标已关 → teardown

        expect(a.endpoint.isOpen()).toBe(false)
        expect(reasons).toHaveLength(1)
    })

    test('teardown 幂等，通知只发一次', () => {
        const a = makeMemoryEndpoint()
        const b = makeMemoryEndpoint()
        const pump = createStreamPump(a.endpoint, b.endpoint)

        const reasons: string[] = []
        pump.onTeardown((reason) => reasons.push(reason))
        pump.teardown('x')
        pump.teardown('y')

        expect(reasons).toEqual(['x'])
    })

    test('teardown 后注册的回调立即收到通知', () => {
        const a = makeMemoryEndpoint()
        const b = makeMemoryEndpoint()
        const pump = createStreamPump(a.endpoint, b.endpoint)
        pump.teardown('early')

        const reasons: string[] = []
        pump.onTeardown((reason) => reasons.push(reason))
        expect(reasons).toEqual(['early'])
    })
})

describe('duplexEndpoint（内存 Duplex 适配器）', () => {
    test('write/pause/resume/drain 对接 PassThrough', async () => {
        const received: Uint8Array[] = []
        const target = new PassThrough()
        target.on('data', (chunk: Buffer) => received.push(new Uint8Array(chunk)))

        const source = new PassThrough()
        source.pipe(target)
        const endpoint = duplexEndpoint(source)

        expect(endpoint.isOpen()).toBe(true)
        expect(endpoint.send(bytes(7, 8))).toBe(true)
        await sleep(5)
        expect(received).toEqual([bytes(7, 8)])

        endpoint.close()
        source.destroy()
        target.destroy()
        expect(endpoint.isOpen()).toBe(false)
    })

    test('两根内存 Duplex 经泵对接：端到端透传', async () => {
        const left = new PassThrough()
        const right = new PassThrough()

        const fromRight: Uint8Array[] = []
        const fromLeft: Uint8Array[] = []
        right.on('data', (chunk: Buffer) => fromRight.push(new Uint8Array(chunk)))
        left.on('data', (chunk: Buffer) => fromLeft.push(new Uint8Array(chunk)))

        const pump = createStreamPump(duplexEndpoint(left), duplexEndpoint(right))
        pump.feed('a', bytes(1))
        pump.feed('b', bytes(2))

        await sleep(10)
        expect(fromRight).toEqual([bytes(1)])
        expect(fromLeft).toEqual([bytes(2)])
        pump.teardown()
    })
})
