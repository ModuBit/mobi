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
import { SSEManager } from '../../src/sse/sseManager'
import { VisibilityTracker } from '../../src/visibility/visibilityTracker'

/** 构造一个 SSE 连接的 send 回调,记录是否被调用 */
function makeConnection(id: string, namespace: string, opts?: { visible?: boolean }) {
    const calls: unknown[] = []
    const send = mock((event: unknown) => { calls.push(event) })
    return {
        id,
        namespace,
        send,
        sendHeartbeat: mock(() => {}),
        calls,
        visible: opts?.visible ?? true,
    }
}

describe('SSEManager', () => {
    test('hasActiveConnection: 有连接返回 true,无连接返回 false', () => {
        const tracker = new VisibilityTracker()
        const manager = new SSEManager(0, tracker)
        expect(manager.hasActiveConnection('ns1')).toBe(false)

        manager.subscribe({
            id: 'c1', namespace: 'ns1', visibility: 'visible',
            send: () => {}, sendHeartbeat: () => {},
        })
        expect(manager.hasActiveConnection('ns1')).toBe(true)
        expect(manager.hasActiveConnection('ns2')).toBe(false)
    })

    test('sendToast 发给该 namespace 所有连接(含 hidden 后台)', async () => {
        const tracker = new VisibilityTracker()
        const manager = new SSEManager(0, tracker)
        const visibleConn = makeConnection('c1', 'ns1', { visible: true })
        const hiddenConn = makeConnection('c2', 'ns1', { visible: false })

        manager.subscribe({ id: visibleConn.id, namespace: 'ns1', visibility: 'visible', send: visibleConn.send, sendHeartbeat: visibleConn.sendHeartbeat })
        manager.subscribe({ id: hiddenConn.id, namespace: 'ns1', visibility: 'hidden', send: hiddenConn.send, sendHeartbeat: hiddenConn.sendHeartbeat })

        const toast = { type: 'toast', namespace: 'ns1', data: { kind: 'ready', title: 't', body: 'b', sessionId: 's1', url: '/u' } }
        const delivered = await manager.sendToast('ns1', toast as never)

        expect(delivered).toBe(2)
        expect(visibleConn.calls).toHaveLength(1)
        expect(hiddenConn.calls).toHaveLength(1) // 关键:hidden 连接也能收到
    })

    test('sendToast 不发给其它 namespace', async () => {
        const tracker = new VisibilityTracker()
        const manager = new SSEManager(0, tracker)
        const other = makeConnection('c1', 'ns2', { visible: true })
        manager.subscribe({ id: other.id, namespace: 'ns2', visibility: 'visible', send: other.send, sendHeartbeat: other.sendHeartbeat })

        const toast = { type: 'toast', namespace: 'ns1', data: { kind: 'ready', title: 't', body: 'b', sessionId: 's1', url: '/u' } }
        const delivered = await manager.sendToast('ns1', toast as never)
        expect(delivered).toBe(0)
        expect(other.calls).toHaveLength(0)
    })
})
