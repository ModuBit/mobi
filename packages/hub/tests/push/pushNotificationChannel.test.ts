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

function makeChannel({ hasActive }: { hasActive: boolean }) {
    const tracker = new VisibilityTracker()
    const manager = new SSEManager(0, tracker)
    if (hasActive) {
        manager.subscribe({ id: 'c1', namespace: 'ns1', visibility: 'hidden', send: () => {}, sendHeartbeat: () => {} })
    }
    const sendToNamespace = mock(() => Promise.resolve())
    const pushService = { sendToNamespace } as unknown as PushService
    const channel = new PushNotificationChannel(pushService, manager, 'https://app.test')
    return { channel, manager, sendToNamespace }
}

describe('PushNotificationChannel', () => {
    test('sendReady:有活跃连接 → 发 toast(带 kind=ready),不走 push', async () => {
        const { channel, sendToNamespace, manager } = makeChannel({ hasActive: true })
        const spy = mock((e: unknown) => {})
        manager.sendToast = mock(async (_ns: string, e: never) => { spy(e); return 1 }) as never

        await channel.sendReady(makeSession())

        expect(spy).toHaveBeenCalledTimes(1)
        const event = spy.mock.calls[0][0] as { data: { kind: string } }
        expect(event.data.kind).toBe('ready')
        expect(sendToNamespace.mock.calls).toHaveLength(0)
    })

    test('sendReady:无活跃连接 → 走 Web Push', async () => {
        const { channel, sendToNamespace } = makeChannel({ hasActive: false })
        await channel.sendReady(makeSession())
        expect(sendToNamespace.mock.calls).toHaveLength(1)
    })

    test('sendPermissionRequest:toast 带 kind=permission', async () => {
        const { channel, manager } = makeChannel({ hasActive: true })
        const spy = mock((e: unknown) => {})
        manager.sendToast = mock(async (_ns: string, e: never) => { spy(e); return 1 }) as never

        const session = makeSession({ agentState: { requests: { r1: { tool: 'Bash' } } } })
        await channel.sendPermissionRequest(session)

        const event = spy.mock.calls[0][0] as { data: { kind: string } }
        expect(event.data.kind).toBe('permission')
    })
})
