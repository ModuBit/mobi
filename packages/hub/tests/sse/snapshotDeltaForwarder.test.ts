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
import { SnapshotDeltaForwarder } from '../../src/sse/snapshotDeltaForwarder'
import { SnapshotDeltaAssembler } from '../../src/sync/snapshotDeltaAssembler'
import type { SyncEvent } from '../../src/sync/syncEngine'
import type { SnapshotBlock } from '@mobi/shared'

function envelope(text: string) {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: { type: 'assistant', message: { role: 'assistant', id: 'm', content: [{ type: 'text', text }], model: 'm' } },
        },
    }
}

function blocksOf(event: SyncEvent): SnapshotBlock[] {
    if (event.type !== 'message-snapshot') throw new Error(`期望 message-snapshot，得到 ${event.type}`)
    const content = (event.message as { content: { content: { data: { message: { content: SnapshotBlock[] } } } } }).content
    return content.content.data.message.content
}

function deltaEvent(rev: number, baseRev: number, text: string): Extract<SyncEvent, { type: 'message-snapshot-delta' }> {
    return {
        type: 'message-snapshot-delta',
        sessionId: 's1',
        namespace: 'ns1',
        localId: 'u1',
        rev,
        baseRev,
        deltas: [{ op: 'append', index: 0, text }],
    }
}

function setup() {
    const assembler = new SnapshotDeltaAssembler()
    const forwarder = new SnapshotDeltaForwarder(assembler)
    assembler.applyFull('s1', 'u1', envelope('hel'), 1)
    return { assembler, forwarder }
}

/** 真实链路建模：handler 先 apply（hub 缓存推进）再 emit，forwarder 广播时路由 */
function applyAndResolve(
    assembler: SnapshotDeltaAssembler,
    forwarder: SnapshotDeltaForwarder,
    event: ReturnType<typeof deltaEvent>,
    connection: { id: string; wantsDelta: boolean },
): SyncEvent | null {
    assembler.applyDelta(event.sessionId, {
        localId: event.localId, rev: event.rev, baseRev: event.baseRev, deltas: event.deltas,
    })
    return forwarder.resolve(event, connection)
}

describe('SnapshotDeltaForwarder - 订阅进度路由', () => {
    test('未协商 delta 的订阅（老 web）→ 全量 fallback（行为与票 01 一致）', () => {
        const { assembler, forwarder } = setup()
        const out = applyAndResolve(assembler, forwarder, deltaEvent(2, 1, 'lo'), { id: 'sub-legacy', wantsDelta: false })
        expect(out?.type).toBe('message-snapshot')
        if (out?.type === 'message-snapshot') {
            // 全量 fallback 带缓存当前内容与 snapshotRev（衔接后续 delta）
            expect(blocksOf(out)).toEqual([{ type: 'text', text: 'hello' }])
            expect(out.message.snapshotRev).toBe(2)
        }
    })

    test('游标衔接的订阅 → 原样转发 delta；游标推进', () => {
        const { assembler, forwarder } = setup()
        // 先经全量基线标记游标（message-snapshot 下发后 markFullSent）
        forwarder.markFullSent('sub-1', 'u1', 1)
        const out = applyAndResolve(assembler, forwarder, deltaEvent(2, 1, 'lo'), { id: 'sub-1', wantsDelta: true })
        expect(out).toMatchObject({ type: 'message-snapshot-delta', rev: 2, baseRev: 1 })

        // 下一帧 baseRev=2 衔接 → 继续转发
        const out2 = applyAndResolve(assembler, forwarder, deltaEvent(3, 2, '！'), { id: 'sub-1', wantsDelta: true })
        expect(out2).toMatchObject({ type: 'message-snapshot-delta', rev: 3 })
    })

    test('新订阅（无游标）→ 全量 fallback 并建游标；此后衔接', () => {
        const { assembler, forwarder } = setup()
        forwarder.markFullSent('sub-1', 'u1', 1)
        applyAndResolve(assembler, forwarder, deltaEvent(2, 1, 'lo'), { id: 'sub-1', wantsDelta: true }) // sub-1 到 rev2

        // sub-2 中途加入：无游标 → 全量 fallback（含当前累积）
        const out = applyAndResolve(assembler, forwarder, deltaEvent(3, 2, '！'), { id: 'sub-2', wantsDelta: true })
        expect(out?.type).toBe('message-snapshot')
        if (out?.type === 'message-snapshot') {
            expect(blocksOf(out)).toEqual([{ type: 'text', text: 'hello！' }])
        }
        // sub-2 游标已建（rev3），下一帧衔接
        const out2 = applyAndResolve(assembler, forwarder, deltaEvent(4, 3, '?'), { id: 'sub-2', wantsDelta: true })
        expect(out2?.type).toBe('message-snapshot-delta')
    })

    test('订阅各自游标独立互不影响', () => {
        const { assembler, forwarder } = setup()
        forwarder.markFullSent('sub-1', 'u1', 1)
        forwarder.markFullSent('sub-2', 'u1', 1)
        applyAndResolve(assembler, forwarder, deltaEvent(2, 1, 'a'), { id: 'sub-1', wantsDelta: true })
        // sub-2 未收到 rev2（游标仍 1）→ rev3 断档 → 全量 fallback
        const out = applyAndResolve(assembler, forwarder, deltaEvent(3, 2, 'b'), { id: 'sub-2', wantsDelta: true })
        expect(out?.type).toBe('message-snapshot')
    })

    test('缓存缺失（断档被 assembler 删/已清理）→ null 不下发', () => {
        const { forwarder, assembler } = setup()
        assembler.cleanupMessage('s1', 'u1')
        const out = applyAndResolve(assembler, forwarder, deltaEvent(2, 1, 'lo'), { id: 'sub-1', wantsDelta: false })
        expect(out).toBeNull()
    })

    test('resync：清该订阅游标 → 下一 delta 全量追赶', () => {
        const { assembler, forwarder } = setup()
        forwarder.markFullSent('sub-1', 'u1', 1)
        applyAndResolve(assembler, forwarder, deltaEvent(2, 1, 'lo'), { id: 'sub-1', wantsDelta: true })
        forwarder.resetSubscription('sub-1')
        const out = applyAndResolve(assembler, forwarder, deltaEvent(3, 2, '!'), { id: 'sub-1', wantsDelta: true })
        expect(out?.type).toBe('message-snapshot')
    })

    test('onUnsubscribe 清游标（重连后必然全量起步）', () => {
        const { assembler, forwarder } = setup()
        forwarder.markFullSent('sub-1', 'u1', 1)
        forwarder.onUnsubscribe('sub-1')
        const out = applyAndResolve(assembler, forwarder, deltaEvent(2, 1, 'lo'), { id: 'sub-1', wantsDelta: true })
        expect(out?.type).toBe('message-snapshot'
        )
    })

    test('markFullSent 对 rev=null（legacy 无链全量）不建游标（后续 delta 必 fallback）', () => {
        const { forwarder, assembler } = setup()
        assembler.applyFull('s2', 'u2', envelope('legacy'), null)
        forwarder.markFullSent('sub-1', 'u2', null)
        // 无链缓存 apply delta 也被 assembler 拒——resolve 拿不到内容 → null
        const out = applyAndResolve(assembler, forwarder, { ...deltaEvent(2, 1, 'x'), sessionId: 's2', localId: 'u2' }, { id: 'sub-1', wantsDelta: true })
        expect(out).toBeNull()
    })
})
