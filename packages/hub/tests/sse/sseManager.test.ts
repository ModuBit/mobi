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
import { SnapshotSync } from '../../src/sync/snapshotSync'
import { VisibilityTracker } from '../../src/visibility/visibilityTracker'
import { blocksOf, textEnvelope } from '../helpers/snapshotDelta'

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
        const manager = new SSEManager(0, tracker, new SnapshotSync())
        expect(manager.hasActiveConnection('ns1')).toBe(false)

        manager.subscribe({
            id: 'c1', namespace: 'ns1', visibility: 'visible',
            send: () => {}, sendHeartbeat: () => {},
        })
        expect(manager.hasActiveConnection('ns1')).toBe(true)
        expect(manager.hasActiveConnection('ns2')).toBe(false)
    })

    test('hasVisibleConnection: 有可见连接返回 true,只有 hidden 或无连接返回 false', () => {
        const tracker = new VisibilityTracker()
        const manager = new SSEManager(0, tracker, new SnapshotSync())
        expect(manager.hasVisibleConnection('ns1')).toBe(false)

        manager.subscribe({
            id: 'c1', namespace: 'ns1', visibility: 'hidden',
            send: () => {}, sendHeartbeat: () => {},
        })
        expect(manager.hasVisibleConnection('ns1')).toBe(false)

        manager.subscribe({
            id: 'c2', namespace: 'ns1', visibility: 'visible',
            send: () => {}, sendHeartbeat: () => {},
        })
        expect(manager.hasVisibleConnection('ns1')).toBe(true)
        expect(manager.hasVisibleConnection('ns2')).toBe(false)
    })

    test('hasVisibleConnection: 连接从 visible 切到 hidden 后变 false', () => {
        const tracker = new VisibilityTracker()
        const manager = new SSEManager(0, tracker, new SnapshotSync())
        manager.subscribe({
            id: 'c1', namespace: 'ns1', visibility: 'visible',
            send: () => {}, sendHeartbeat: () => {},
        })
        expect(manager.hasVisibleConnection('ns1')).toBe(true)

        // 模拟前端上报 hidden(visibility 切换)
        tracker.setVisibility('c1', 'ns1', 'hidden')
        expect(manager.hasVisibleConnection('ns1')).toBe(false)
    })

    test('sendToast 发给该 namespace 所有连接(含 hidden 后台)', async () => {
        const tracker = new VisibilityTracker()
        const manager = new SSEManager(0, tracker, new SnapshotSync())
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
        const manager = new SSEManager(0, tracker, new SnapshotSync())
        const other = makeConnection('c1', 'ns2', { visible: true })
        manager.subscribe({ id: other.id, namespace: 'ns2', visibility: 'visible', send: other.send, sendHeartbeat: other.sendHeartbeat })

        const toast = { type: 'toast', namespace: 'ns1', data: { kind: 'ready', title: 't', body: 'b', sessionId: 's1', url: '/u' } }
        const delivered = await manager.sendToast('ns1', toast as never)
        expect(delivered).toBe(0)
        expect(other.calls).toHaveLength(0)
    })

    test('快照广播由订阅 handle 决定增量直发或完整追赶', () => {
        const tracker = new VisibilityTracker()
        const sync = new SnapshotSync()
        const manager = new SSEManager(0, tracker, sync)
        const modern = makeConnection('modern', 'ns1')
        const legacy = makeConnection('legacy', 'ns1')
        manager.subscribe({
            id: modern.id, namespace: 'ns1', sessionId: 's1', snapshotDelta: true,
            send: modern.send, sendHeartbeat: modern.sendHeartbeat,
        })
        manager.subscribe({
            id: legacy.id, namespace: 'ns1', sessionId: 's1',
            send: legacy.send, sendHeartbeat: legacy.sendHeartbeat,
        })

        const full = sync.ingest({
            kind: 'full', sessionId: 's1', localId: 'u1', content: textEnvelope('hel'), rev: 1,
        })
        expect(full.status).toBe('accepted')
        if (full.status !== 'accepted') return
        manager.broadcast({ ...full.publication, namespace: 'ns1' })

        const next = sync.ingest({
            kind: 'delta',
            sessionId: 's1',
            frame: {
                localId: 'u1', rev: 2, baseRev: 1,
                deltas: [{ op: 'append', index: 0, text: 'lo' }],
            },
        })
        expect(next.status).toBe('accepted')
        if (next.status !== 'accepted') return
        manager.broadcast({ ...next.publication, namespace: 'ns1' })

        expect((modern.calls[1] as { type: string }).type).toBe('message-snapshot-delta')
        const legacyCatchUp = legacy.calls[1] as { type: string; message: { content: unknown } }
        expect(legacyCatchUp.type).toBe('message-snapshot')
        expect(blocksOf(legacyCatchUp.message.content)).toEqual([{ type: 'text', text: 'hello' }])
    })

    test('resyncSnapshots 定向补发当前完整基线', () => {
        const tracker = new VisibilityTracker()
        const sync = new SnapshotSync()
        const manager = new SSEManager(0, tracker, sync)
        const connection = makeConnection('c1', 'ns1')
        manager.subscribe({
            id: connection.id, namespace: 'ns1', sessionId: 's1', snapshotDelta: true,
            send: connection.send, sendHeartbeat: connection.sendHeartbeat,
        })
        sync.ingest({
            kind: 'full', sessionId: 's1', localId: 'u1', content: textEnvelope('active'), rev: 4,
        })

        expect(manager.resyncSnapshots('c1', 's1')).toBe(1)
        expect(connection.calls).toHaveLength(1)
        expect(connection.calls[0]).toMatchObject({
            type: 'message-snapshot', namespace: 'ns1', message: { localId: 'u1', snapshotRev: 4 },
        })
    })
})
