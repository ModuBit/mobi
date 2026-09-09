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

import { describe, test, expect } from 'bun:test'
import { registerSessionHandlers } from '../../src/socket/handlers/cli/sessionHandlers'
import type { SessionHandlersDeps } from '../../src/socket/handlers/cli/sessionHandlers'
import { BackgroundTaskTracker } from '../../src/sync/backgroundTaskTracker'
import { SnapshotSync } from '../../src/sync/snapshotSync'
import { textEnvelope, blocksOf as envelopeBlocksOf } from '../helpers/snapshotDelta'
import type { StoredSession } from '../../src/store/types'
import type { SyncEvent } from '../../src/sync/syncEngine'

/**
 * snapshot delta 协议 handler 层接缝测试（票 01 建 CLI→hub 段、票 02 加 hub→web 段）：
 * session-message 帧（全量/增量/legacy）进 → message-snapshot（全量）/ message-snapshot-delta（增量）出。
 * 断言外部行为（帧进出），不触及拼接器内部状态。
 */

function makeStoredSession(sid: string): StoredSession {
    return {
        id: sid, tag: null, namespace: 'default', machineId: null,
        createdAt: 1, updatedAt: 1, metadata: null, metadataVersion: 0,
        agentState: null, agentStateVersion: 0, runtimeState: null,
        runtimeStateUpdatedAt: null, projectId: null, pinned: false, seq: 1,
    }
}

/** CLI 真实发送的全量信封形状（wrapAsDecryptedMessage → convertSnapshot），共用 helper */
function envelope(text: string) {
    return textEnvelope(text)
}

/** 从 message-snapshot 事件中取 blocks（窄化 + 复用信封 helper 的生产导航逻辑） */
function blocksOf(event: SyncEvent): { type: string; text?: string }[] {
    if (event.type !== 'message-snapshot') throw new Error('非 message-snapshot 事件')
    return envelopeBlocksOf(event.message.content)
}

function makeHarness() {
    const events: SyncEvent[] = []
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const fakeSocket = {
        on(event: string, handler: (...args: unknown[]) => void) { handlers.set(event, handler) },
        to() { return { emit() {} } },
        emit(event: string, ...args: unknown[]) { handlers.get(event)?.(...args) },
    }
    const deps: SessionHandlersDeps = {
        store: {} as unknown as SessionHandlersDeps['store'],
        resolveSessionAccess: (sid: string) => ({ ok: true as const, value: makeStoredSession(sid) }),
        emitAccessError: () => {},
        backgroundTaskTracker: new BackgroundTaskTracker(),
        snapshotSync: new SnapshotSync(),
        onWebappEvent: (e: SyncEvent) => { events.push(JSON.parse(JSON.stringify(e))) },
    }
    registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
    const send = (payload: unknown) => fakeSocket.emit('session-message', payload)
    const emitRaw = (event: string, payload: unknown) => fakeSocket.emit(event, payload)
    const of = <T extends SyncEvent['type']>(type: T) => events.filter((e): e is Extract<SyncEvent, { type: T }> => e.type === type)
    return { send, emitRaw, snapshots: () => of('message-snapshot'), deltas: () => of('message-snapshot-delta') }
}

describe('snapshot delta：session-message 帧 → SSE 事件', () => {
    test('全量帧（带 rev）→ message-snapshot（带 snapshotRev）；衔接增量帧 → message-snapshot-delta 原样', () => {
        const { send, snapshots, deltas } = makeHarness()

        send({ sid: 's1', localId: 'u1', snapshot: true, message: envelope('hel'), frame: { rev: 1, baseRev: null } })
        send({ sid: 's1', localId: 'u1', snapshotDelta: { localId: 'u1', rev: 2, baseRev: 1, deltas: [{ op: 'append', index: 0, text: 'lo' }] } })

        expect(snapshots()).toHaveLength(1)
        expect(snapshots()[0].message.localId).toBe('u1')
        expect(snapshots()[0].message.snapshotRev).toBe(1)
        expect(blocksOf(snapshots()[0])).toEqual([{ type: 'text', text: 'hel' }])

        expect(deltas()).toHaveLength(1)
        expect(deltas()[0]).toMatchObject({
            sessionId: 's1', localId: 'u1', rev: 2, baseRev: 1,
            deltas: [{ op: 'append', index: 0, text: 'lo' }],
        })
    })

    test('断档增量帧不 emit（丢弃优于错乱）；全量帧重发后恢复 delta 转发', () => {
        const { send, snapshots, deltas } = makeHarness()

        send({ sid: 's1', localId: 'u1', snapshot: true, message: envelope('a'), frame: { rev: 1, baseRev: null } })
        // 断档：baseRev=5 与缓存 rev=1 不衔接 → 无任何事件
        send({ sid: 's1', localId: 'u1', snapshotDelta: { localId: 'u1', rev: 6, baseRev: 5, deltas: [{ op: 'append', index: 0, text: 'x' }] } })
        expect(deltas()).toHaveLength(0)
        expect(snapshots()).toHaveLength(1)

        // CLI 重发全量（重基线规则）后恢复正常
        send({ sid: 's1', localId: 'u1', snapshot: true, message: envelope('fresh'), frame: { rev: 10, baseRev: null } })
        send({ sid: 's1', localId: 'u1', snapshotDelta: { localId: 'u1', rev: 11, baseRev: 10, deltas: [{ op: 'append', index: 0, text: '!' }] } })
        expect(snapshots()).toHaveLength(2)
        expect(deltas()).toHaveLength(1)
        expect(deltas()[0]).toMatchObject({ rev: 11, baseRev: 10 })
    })

    test('legacy 全量（老 CLI，无 frame）直通下发且不带 snapshotRev', () => {
        const { send, snapshots } = makeHarness()
        send({ sid: 's1', localId: 'u1', snapshot: true, message: envelope('legacy') })
        expect(snapshots()).toHaveLength(1)
        expect(snapshots()[0].message.snapshotRev).toBeUndefined()
        expect(blocksOf(snapshots()[0])).toEqual([{ type: 'text', text: 'legacy' }])
    })

    test('增量帧 message 字段缺省不影响路由（snapshotDelta 优先于 legacy 分支）', () => {
        const { send, snapshots, deltas } = makeHarness()
        send({ sid: 's1', localId: 'u1', snapshot: true, message: envelope('base'), frame: { rev: 1, baseRev: null } })
        // sendSnapshotDelta 的 message: undefined —— 不应被误判为 legacy 全量
        send({ sid: 's1', localId: 'u1', message: undefined, snapshotDelta: { localId: 'u1', rev: 2, baseRev: 1, deltas: [] } })
        expect(snapshots()).toHaveLength(1)
        expect(deltas()).toHaveLength(1)
    })

    test('B1：snapshot-stream-end 清流缓存——结束后同 localId 的新链从全量重启，且游标精确（不误杀其他消息）', () => {
        const { send, emitRaw, snapshots, deltas } = makeHarness()
        send({ sid: 's1', localId: 'u1', snapshot: true, message: envelope('a'), frame: { rev: 1, baseRev: null } })
        send({ sid: 's1', localId: 'u1', snapshotDelta: { localId: 'u1', rev: 2, baseRev: 1, deltas: [{ op: 'append', index: 0, text: 'b' }] } })

        // stream-end：full message 落库后 CLI 发的结束信号（localId = 流 sdkUuid，
        // 与 full message 的 jsonl uuid 不同——hub 无法自行映射，靠此信号）
        emitRaw('snapshot-stream-end', { sid: 's1', localId: 'u1' })

        // 清理后：同 localId 衔接旧 rev 的增量不再被接受（链已断，等全量重基线）
        send({ sid: 's1', localId: 'u1', snapshotDelta: { localId: 'u1', rev: 3, baseRev: 2, deltas: [{ op: 'append', index: 0, text: 'c' }] } })
        expect(deltas()).toHaveLength(1) // 仅清理前那帧

        // 新链从全量重启（rev 重新计数）
        send({ sid: 's1', localId: 'u1', snapshot: true, message: envelope('new'), frame: { rev: 1, baseRev: null } })
        expect(snapshots()).toHaveLength(2)
    })

    test('A2：迟到的陈旧全量帧（rev 落后于缓存）不下发（socket.io-client 重连 sendBuffer 重放乱序防护）', () => {
        const { send, snapshots } = makeHarness()
        send({ sid: 's1', localId: 'u1', snapshot: true, message: envelope('fresh'), frame: { rev: 10, baseRev: null } })
        // 断线期间缓冲的陈旧全量在 connect 后重放：rev=3 < 缓存 10 → 整帧拒绝
        send({ sid: 's1', localId: 'u1', snapshot: true, message: envelope('stale'), frame: { rev: 3, baseRev: null } })
        expect(snapshots()).toHaveLength(1)
        expect(blocksOf(snapshots()[0])).toEqual([{ type: 'text', text: 'fresh' }])
    })

    test('snapshot-stream-end 参数非法 / 会话不存在时静默忽略', () => {
        const { send, emitRaw, snapshots } = makeHarness()
        send({ sid: 's1', localId: 'u1', snapshot: true, message: envelope('a'), frame: { rev: 1, baseRev: null } })
        emitRaw('snapshot-stream-end', { sid: 's1' }) // 缺 localId
        emitRaw('snapshot-stream-end', null)
        emitRaw('snapshot-stream-end', { sid: 'nope', localId: 'u1' }) // 会话不存在
        // 缓存未被误清：衔接的增量仍可转发
        send({ sid: 's1', localId: 'u1', snapshotDelta: { localId: 'u1', rev: 2, baseRev: 1, deltas: [{ op: 'append', index: 0, text: 'b' }] } })
        expect(snapshots()).toHaveLength(1)
    })
})
