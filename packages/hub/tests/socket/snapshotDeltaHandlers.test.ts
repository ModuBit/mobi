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
import { SnapshotDeltaAssembler } from '../../src/sync/snapshotDeltaAssembler'
import type { StoredSession } from '../../src/store/types'
import type { SyncEvent } from '../../src/sync/syncEngine'

/**
 * snapshot delta 协议（.scratch/snapshot-delta 票 01）handler 层接缝测试：
 * session-message 帧（全量/增量/legacy）进 → message-snapshot 事件出。
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

/** CLI 真实发送的全量信封形状（wrapAsDecryptedMessage → convertSnapshot） */
function envelope(text: string) {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                message: { role: 'assistant', id: 'msg_1', content: [{ type: 'text', text }], model: 'm' },
            },
        },
    }
}

/** 从 message-snapshot 事件中取 blocks（message.content = 信封，信封.content.data 才是 rawLog） */
function blocksOf(event: SyncEvent): { type: string; text?: string }[] {
    if (event.type !== 'message-snapshot') throw new Error('非 message-snapshot 事件')
    const envelope = (event.message as { content: { content: { data: { message: { content: unknown } } } } }).content
    return envelope.content.data.message.content as { type: string; text?: string }[]
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
        snapshotAssembler: new SnapshotDeltaAssembler(),
        // 拼接器 emit 的是缓存共享引用（hub 下发即时序列化、无拷贝）；
        // 测试断言历史帧须在捕获时深拷贝快照，否则后续 delta 变异污染断言
        onWebappEvent: (e: SyncEvent) => { events.push(JSON.parse(JSON.stringify(e))) },
    }
    registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
    const send = (payload: unknown) => fakeSocket.emit('session-message', payload)
    const snapshots = () => events.filter((e): e is Extract<SyncEvent, { type: 'message-snapshot' }> => e.type === 'message-snapshot')
    return { send, snapshots }
}

describe('snapshot delta：session-message 帧 → message-snapshot 下发', () => {
    test('全量帧（带 rev）建链下发；衔接的增量帧 apply 后下发重建全量', () => {
        const { send, snapshots } = makeHarness()

        send({ sid: 's1', localId: 'u1', snapshot: true, message: envelope('hel'), frame: { rev: 1, baseRev: null } })
        send({ sid: 's1', localId: 'u1', snapshotDelta: { localId: 'u1', rev: 2, baseRev: 1, deltas: [{ op: 'append', index: 0, text: 'lo' }] } })

        expect(snapshots()).toHaveLength(2)
        expect(snapshots()[0].message.localId).toBe('u1')
        expect(blocksOf(snapshots()[0])).toEqual([{ type: 'text', text: 'hel' }])
        // 增量帧下发的 message-snapshot 是 hub 缓存重建的全量（票 01 语义：web 无感知）
        expect(blocksOf(snapshots()[1])).toEqual([{ type: 'text', text: 'hello' }])
        expect(snapshots()[1].message.localId).toBe('u1')
    })

    test('断档增量帧不下发（丢弃优于错乱）；全量帧重发后恢复', () => {
        const { send, snapshots } = makeHarness()

        send({ sid: 's1', localId: 'u1', snapshot: true, message: envelope('a'), frame: { rev: 1, baseRev: null } })
        // 断档：baseRev=5 与缓存 rev=1 不衔接
        send({ sid: 's1', localId: 'u1', snapshotDelta: { localId: 'u1', rev: 6, baseRev: 5, deltas: [{ op: 'append', index: 0, text: 'x' }] } })
        expect(snapshots()).toHaveLength(1)

        // CLI 重发全量（重基线规则）后恢复正常
        send({ sid: 's1', localId: 'u1', snapshot: true, message: envelope('fresh'), frame: { rev: 10, baseRev: null } })
        send({ sid: 's1', localId: 'u1', snapshotDelta: { localId: 'u1', rev: 11, baseRev: 10, deltas: [{ op: 'append', index: 0, text: '!' }] } })
        expect(snapshots()).toHaveLength(3)
        expect(blocksOf(snapshots()[2])).toEqual([{ type: 'text', text: 'fresh!' }])
    })

    test('legacy 全量（老 CLI，无 frame）直通下发，同样内容透传', () => {
        const { send, snapshots } = makeHarness()
        send({ sid: 's1', localId: 'u1', snapshot: true, message: envelope('legacy') })
        expect(snapshots()).toHaveLength(1)
        expect(blocksOf(snapshots()[0])).toEqual([{ type: 'text', text: 'legacy' }])
    })

    test('增量帧 message 字段缺省不影响路由（snapshotDelta 优先）', () => {
        const { send, snapshots } = makeHarness()
        send({ sid: 's1', localId: 'u1', snapshot: true, message: envelope('base'), frame: { rev: 1, baseRev: null } })
        // sendSnapshotDelta 的 message: undefined —— 不应被误判为 legacy 全量
        send({ sid: 's1', localId: 'u1', message: undefined, snapshotDelta: { localId: 'u1', rev: 2, baseRev: 1, deltas: [] } })
        // deltas 空帧：apply 成功（内容不变），仍下发（与 CLI 空帧抑制互补，hub 不吞）
        expect(snapshots()).toHaveLength(2)
    })
})
