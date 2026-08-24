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

import { describe, test, expect, vi, afterEach } from 'vitest'
import { AgentSessionBase } from '@/agent/sessionBase'

/** 构造带 spy client 的 AgentSessionBase（构造参数最小满足，不触网） */
function makeSession() {
    const reportRunStarted = vi.fn()
    const client = {
        keepAlive: vi.fn(),
        reportRunStarted,
        startIdleTimer: vi.fn(),
        stopIdleTimer: vi.fn(),
        updateMetadata: vi.fn(),
    }
    const session = new AgentSessionBase({
        api: {} as never,
        client: client as never,
        path: '/tmp/p',
        logPath: '/tmp/log',
        sessionId: null,
        messageQueue: {} as never,
        onModeChange: () => {},
        sessionLabel: 'test',
        sessionIdLabel: 'test',
        applySessionIdToMetadata: (m) => m,
    })
    return { session, client }
}

describe('AgentSessionBase.onRunningChange 轮次起点上报（docs/pending.md #55）', () => {
    const sessions: ReturnType<typeof makeSession>[] = []
    afterEach(() => {
        // 构造函数起了 keepAlive setInterval，显式停掉防句柄泄漏
        for (const s of sessions.splice(0)) s.session.stopKeepAlive()
    })

    const make = () => {
        const s = makeSession()
        sessions.push(s)
        return s
    }

    test('running 翻转 false→true 时上报 run-started（一次翻转一次上报）', () => {
        const { session, client } = make()
        session.onRunningChange(true)
        expect(client.reportRunStarted).toHaveBeenCalledTimes(1)
        expect(client.reportRunStarted.mock.calls[0][0]).toBeGreaterThan(0)
    })

    test('重复同值上报不重复触发（翻转边沿触发，非电平）', () => {
        const { session, client } = make()
        session.onRunningChange(true)
        session.onRunningChange(true)
        expect(client.reportRunStarted).toHaveBeenCalledTimes(1)
    })

    test('true→false 不上报（轮次结束非起点）', () => {
        const { session, client } = make()
        session.onRunningChange(true)
        client.reportRunStarted.mockClear()
        session.onRunningChange(false)
        expect(client.reportRunStarted).not.toHaveBeenCalled()
    })

    test('下一轮 false→true 再次上报（每轮起点都刷新）', () => {
        const { session, client } = make()
        session.onRunningChange(true)
        session.onRunningChange(false)
        session.onRunningChange(true)
        expect(client.reportRunStarted).toHaveBeenCalledTimes(2)
    })
})
