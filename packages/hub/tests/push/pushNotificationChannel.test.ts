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

import { describe, test, expect, mock } from 'bun:test'
import { PushNotificationChannel } from '../../src/push/pushNotificationChannel'
import { VisibilityTracker } from '../../src/visibility/visibilityTracker'
import { SSEManager } from '../../src/sse/sseManager'
import type { PushService } from '../../src/push/pushService'

/** 最小 Session 桩,满足 channel 读取的字段 */
function makeSession(overrides: Record<string, unknown> = {}) {
    return {
        id: 's1',
        namespace: 'ns1',
        active: true,
        agentState: {},
        ...overrides,
    } as never
}

/** 一个记录收到事件的测试连接 */
function makeConnection(id: string, visibility: 'visible' | 'hidden') {
    const calls: unknown[] = []
    return {
        id,
        visibility,
        send: mock((event: unknown) => { calls.push(event) }),
        sendHeartbeat: mock(() => {}),
        calls,
    }
}

type TestConnection = ReturnType<typeof makeConnection>

/** 组装 channel:真实 SSEManager(按需挂连接)+ mock pushService(控制订阅态) */
function setup(opts: { connections?: TestConnection[]; hasPush?: boolean }) {
    const tracker = new VisibilityTracker()
    const manager = new SSEManager(0, tracker)
    for (const conn of (opts.connections ?? [])) {
        manager.subscribe({
            id: conn.id,
            namespace: 'ns1',
            visibility: conn.visibility,
            send: conn.send,
            sendHeartbeat: conn.sendHeartbeat,
        })
    }
    const sendToNamespace = mock(() => Promise.resolve())
    const hasSubscription = mock(() => opts.hasPush ?? false)
    const pushService = { sendToNamespace, hasSubscription } as unknown as PushService
    const channel = new PushNotificationChannel(pushService, manager, 'https://app.test')
    return { channel, sendToNamespace, hasSubscription }
}

/** 取连接收到的第一个 toast 的 data.kind */
function toastKind(calls: unknown[]): string | undefined {
    const event = calls[0] as { data?: { kind?: string } }
    return event?.data?.kind
}

describe('PushNotificationChannel', () => {
    describe('投递决策(有可见连接 || 无 push 订阅 → SSE toast,否则 Web Push)', () => {
        test('有可见连接:SSE toast 送达,不打扰(不走 Web Push)', async () => {
            const conn = makeConnection('v1', 'visible')
            const { channel, sendToNamespace } = setup({ connections: [conn], hasPush: true })

            await channel.sendReady(makeSession())

            expect(conn.calls).toHaveLength(1)
            expect(sendToNamespace.mock.calls).toHaveLength(0)
        })

        test('仅 hidden 连接 + 有 push 订阅:走 Web Push,不投 SSE toast', async () => {
            const conn = makeConnection('h1', 'hidden')
            const { channel, sendToNamespace } = setup({ connections: [conn], hasPush: true })

            await channel.sendReady(makeSession())

            expect(conn.calls).toHaveLength(0)
            expect(sendToNamespace.mock.calls).toHaveLength(1)
        })

        test('仅 hidden 连接 + 无 push 订阅:SSE toast 兜底投给 hidden 连接', async () => {
            const conn = makeConnection('h1', 'hidden')
            const { channel, sendToNamespace } = setup({ connections: [conn], hasPush: false })

            await channel.sendReady(makeSession())

            expect(conn.calls).toHaveLength(1)
            expect(sendToNamespace.mock.calls).toHaveLength(0)
        })

        test('无活跃连接 + 有 push 订阅:走 Web Push', async () => {
            const { channel, sendToNamespace } = setup({ connections: [], hasPush: true })

            await channel.sendReady(makeSession())

            expect(sendToNamespace.mock.calls).toHaveLength(1)
        })

        test('无活跃连接 + 无 push 订阅:toast 投递 0 后仍尝试 Web Push(无订阅静默丢弃)', async () => {
            const { channel, sendToNamespace } = setup({ connections: [], hasPush: false })

            await channel.sendReady(makeSession())

            expect(sendToNamespace.mock.calls).toHaveLength(1)
        })
    })

    test('sendReady 的 SSE toast 带 kind=ready', async () => {
        const conn = makeConnection('v1', 'visible')
        const { channel } = setup({ connections: [conn], hasPush: true })

        await channel.sendReady(makeSession())

        expect(toastKind(conn.calls)).toBe('ready')
    })

    test('sendPermissionRequest 的 SSE toast 带 kind=permission', async () => {
        const conn = makeConnection('v1', 'visible')
        const { channel } = setup({ connections: [conn], hasPush: true })

        await channel.sendPermissionRequest(makeSession({ agentState: { requests: { r1: { tool: 'Bash' } } } }))

        expect(toastKind(conn.calls)).toBe('permission')
    })

    test('session 非活跃时不发任何通知', async () => {
        const conn = makeConnection('v1', 'visible')
        const { channel, sendToNamespace } = setup({ connections: [conn], hasPush: true })

        await channel.sendReady(makeSession({ active: false }))

        expect(conn.calls).toHaveLength(0)
        expect(sendToNamespace.mock.calls).toHaveLength(0)
    })
})
