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
import { IdleTimer } from '../../../src/modules/common/idleTimer'

vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() }
}))

/** 默认配置与生产一致：断开 10 分钟 / 空闲 1 天 / 预警提前 5 分钟 */
const DISCONNECT_TIMEOUT_MS = 600_000
const IDLE_TIMEOUT_MS = 86_400_000
const WARNING_MS = 300_000

function makeTimer(overrides?: Partial<ConstructorParameters<typeof IdleTimer>[0]>) {
    const callbacks = {
        onWarning: vi.fn(),
        onDisconnectTimeout: vi.fn(),
        onIdleTimeout: vi.fn()
    }
    const timer = new IdleTimer({
        disconnectTimeoutMs: DISCONNECT_TIMEOUT_MS,
        idleTimeoutMs: IDLE_TIMEOUT_MS,
        warningMs: WARNING_MS,
        ...callbacks,
        ...overrides
    })
    return { timer, callbacks }
}

describe('IdleTimer', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('空闲预警在 warningMs 前提前触发，空闲超时到点触发 onIdleTimeout', () => {
        const { timer, callbacks } = makeTimer()
        timer.start()

        vi.advanceTimersByTime(IDLE_TIMEOUT_MS - WARNING_MS)
        expect(callbacks.onWarning).toHaveBeenCalledTimes(1)
        expect(callbacks.onIdleTimeout).not.toHaveBeenCalled()

        vi.advanceTimersByTime(WARNING_MS)
        expect(callbacks.onIdleTimeout).toHaveBeenCalledTimes(1)
        expect(callbacks.onDisconnectTimeout).not.toHaveBeenCalled()
    })

    it('reset 刷新空闲计时器，不触发超时', () => {
        const { timer, callbacks } = makeTimer()
        timer.start()

        vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1_000)
        timer.reset()
        vi.advanceTimersByTime(IDLE_TIMEOUT_MS - 1_000)
        expect(callbacks.onIdleTimeout).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1_000)
        expect(callbacks.onIdleTimeout).toHaveBeenCalledTimes(1)
    })

    it('断开后到点触发 onDisconnectTimeout，且空闲计时暂停', () => {
        const { timer, callbacks } = makeTimer()
        timer.start()

        timer.onDisconnect()
        vi.advanceTimersByTime(DISCONNECT_TIMEOUT_MS)
        expect(callbacks.onDisconnectTimeout).toHaveBeenCalledTimes(1)
        // 断开期间 idle 计时被挂起，不应触发
        expect(callbacks.onIdleTimeout).not.toHaveBeenCalled()
    })

    it('重连后清除断开计时器，不再触发 onDisconnectTimeout', () => {
        const { timer, callbacks } = makeTimer()
        timer.start()

        timer.onDisconnect()
        timer.onReconnect()
        vi.advanceTimersByTime(DISCONNECT_TIMEOUT_MS * 2)
        expect(callbacks.onDisconnectTimeout).not.toHaveBeenCalled()
    })

    it('断开窗口内重复 onDisconnect（connect_error 每次重试触发）重连后不得误杀', () => {
        // 场景：hub 重启（deploy）→ 'disconnect' 启动断开计时 → 重连尝试每次
        // 'connect_error' 再调 onDisconnect → hub 恢复后重连成功。
        // 若重复 onDisconnect 重排计时器且覆盖引用，onReconnect 的 clearTimeout
        // 只能清掉最后一个，泄漏的照常触发——已重连的会话在首次断开 10 分钟后被误杀
        const { timer, callbacks } = makeTimer()
        timer.start()

        timer.onDisconnect()
        vi.advanceTimersByTime(1_000)
        timer.onDisconnect() // connect_error
        vi.advanceTimersByTime(1_000)
        timer.onDisconnect() // connect_error
        vi.advanceTimersByTime(2_000)
        timer.onReconnect()

        vi.advanceTimersByTime(DISCONNECT_TIMEOUT_MS * 2)
        expect(callbacks.onDisconnectTimeout).not.toHaveBeenCalled()
    })

    it('stop 清空全部计时器', () => {
        const { timer, callbacks } = makeTimer()
        timer.start()
        timer.onDisconnect()
        timer.stop()

        vi.advanceTimersByTime(DISCONNECT_TIMEOUT_MS * 2)
        vi.advanceTimersByTime(IDLE_TIMEOUT_MS)
        expect(callbacks.onDisconnectTimeout).not.toHaveBeenCalled()
        expect(callbacks.onIdleTimeout).not.toHaveBeenCalled()
        expect(callbacks.onWarning).not.toHaveBeenCalled()
    })

    it('stop 后 onDisconnect/onReconnect 均不排程', () => {
        const { timer, callbacks } = makeTimer()
        timer.stop()

        timer.onDisconnect()
        vi.advanceTimersByTime(DISCONNECT_TIMEOUT_MS)
        expect(callbacks.onDisconnectTimeout).not.toHaveBeenCalled()

        timer.onReconnect()
        vi.advanceTimersByTime(IDLE_TIMEOUT_MS)
        expect(callbacks.onIdleTimeout).not.toHaveBeenCalled()
    })
})
