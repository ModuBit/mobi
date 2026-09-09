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

import { describe, expect, test } from 'bun:test'
import type { SnapshotDeltaFrame } from '@mobi/shared'

import { SnapshotDeltaStats } from '../../src/sync/snapshotDeltaStats'
import { SnapshotSync } from '../../src/sync/snapshotSync'
import { blocksOf, envelope, textEnvelope } from '../helpers/snapshotDelta'

const delta = (rev: number, baseRev: number, text: string): SnapshotDeltaFrame => ({
    localId: 'stream-1',
    rev,
    baseRev,
    deltas: [{ op: 'append', index: 0, text }],
})

describe('SnapshotSync', () => {
    test('已获完整基线的订阅继续接收衔接增量', () => {
        const sync = new SnapshotSync()
        const subscription = sync.attachSubscription({ id: 'web-1', wantsDelta: true })

        const full = sync.ingest({
            kind: 'full',
            sessionId: 'session-1',
            localId: 'stream-1',
            content: textEnvelope('hel'),
            rev: 1,
        })
        expect(full.status).toBe('accepted')
        if (full.status !== 'accepted') return
        expect(subscription.resolve(full.publication)).toBe(full.publication)

        const appended = sync.ingest({
            kind: 'delta',
            sessionId: 'session-1',
            frame: delta(2, 1, 'lo'),
        })
        expect(appended.status).toBe('accepted')
        if (appended.status !== 'accepted') return
        expect(subscription.resolve(appended.publication)).toBe(appended.publication)

        const lateSubscription = sync.attachSubscription({ id: 'web-2', wantsDelta: true })
        const catchUp = lateSubscription.resolve(appended.publication)
        expect(catchUp?.type).toBe('message-snapshot')
        if (catchUp?.type !== 'message-snapshot') return
        expect(blocksOf(catchUp.message.content)).toEqual([{ type: 'text', text: 'hello' }])
    })

    test('订阅重同步立即取得当前完整基线，并从该版本继续接收增量', () => {
        const sync = new SnapshotSync()
        const subscription = sync.attachSubscription({ id: 'web-1', wantsDelta: true })
        const full = sync.ingest({
            kind: 'full', sessionId: 'session-1', localId: 'stream-1', content: textEnvelope('a'), rev: 1,
        })
        expect(full.status).toBe('accepted')
        if (full.status !== 'accepted') return
        subscription.resolve(full.publication)

        const appended = sync.ingest({ kind: 'delta', sessionId: 'session-1', frame: delta(2, 1, 'b') })
        expect(appended.status).toBe('accepted')
        if (appended.status !== 'accepted') return
        subscription.resolve(appended.publication)

        const baselines = subscription.resync('session-1')
        expect(baselines).toHaveLength(1)
        expect(baselines[0].message.snapshotRev).toBe(2)
        expect(blocksOf(baselines[0].message.content)).toEqual([{ type: 'text', text: 'ab' }])

        const next = sync.ingest({ kind: 'delta', sessionId: 'session-1', frame: delta(3, 2, 'c') })
        expect(next.status).toBe('accepted')
        if (next.status !== 'accepted') return
        expect(subscription.resolve(next.publication)).toBe(next.publication)
    })

    test('迟到的旧 CLI lease 不能清理新连接接管后的快照', () => {
        const sync = new SnapshotSync()
        const oldLease = sync.attachCli('session-1')
        sync.ingest({
            kind: 'full', sessionId: 'session-1', localId: 'stream-1', content: textEnvelope('a'), rev: 1,
        })
        const currentLease = sync.attachCli('session-1')

        oldLease.disconnect()
        expect(sync.ingest({ kind: 'delta', sessionId: 'session-1', frame: delta(2, 1, 'b') }).status)
            .toBe('accepted')

        currentLease.disconnect()
        expect(sync.ingest({ kind: 'delta', sessionId: 'session-1', frame: delta(3, 2, 'c') }))
            .toEqual({ status: 'ignored', reason: 'missing-baseline' })
    })

    test('持久化消息和流结束按各自 localId 清理，流结束同时撤销订阅基线', () => {
        const sync = new SnapshotSync()
        const subscription = sync.attachSubscription({ id: 'web-1', wantsDelta: true })
        const full = sync.ingest({
            kind: 'full', sessionId: 'session-1', localId: 'stream-1', content: textEnvelope('a'), rev: 1,
        })
        expect(full.status).toBe('accepted')
        if (full.status !== 'accepted') return
        subscription.resolve(full.publication)

        sync.messagePersisted('session-1', 'final-message-id')
        expect(sync.ingest({ kind: 'delta', sessionId: 'session-1', frame: delta(2, 1, 'b') }).status)
            .toBe('accepted')

        sync.endStream('session-1', 'stream-1')
        expect(subscription.resync('session-1')).toEqual([])
        expect(sync.ingest({ kind: 'delta', sessionId: 'session-1', frame: delta(3, 2, 'c') }))
            .toEqual({ status: 'ignored', reason: 'missing-baseline' })
    })

    test('陈旧全量不覆盖当前基线，版本断档使流等待下一次完整基线', () => {
        const sync = new SnapshotSync()
        sync.ingest({
            kind: 'full', sessionId: 'session-1', localId: 'stream-1', content: textEnvelope('new'), rev: 5,
        })

        expect(sync.ingest({
            kind: 'full', sessionId: 'session-1', localId: 'stream-1', content: textEnvelope('old'), rev: 4,
        })).toEqual({ status: 'ignored', reason: 'stale-full' })
        expect(sync.ingest({ kind: 'delta', sessionId: 'session-1', frame: delta(6, 5, '!') }).status)
            .toBe('accepted')

        expect(sync.ingest({ kind: 'delta', sessionId: 'session-1', frame: delta(8, 7, '?') }))
            .toEqual({ status: 'ignored', reason: 'revision-gap' })
        expect(sync.ingest({ kind: 'delta', sessionId: 'session-1', frame: delta(9, 8, '?') }))
            .toEqual({ status: 'ignored', reason: 'missing-baseline' })
        expect(sync.ingest({
            kind: 'full', sessionId: 'session-1', localId: 'stream-1', content: textEnvelope('fresh'), rev: 10,
        }).status).toBe('accepted')
    })

    test('过期的流式缓存不会被重同步或后续增量继续使用', () => {
        let now = 1_000
        const sync = new SnapshotSync({ ttlMs: 60_000, now: () => now })
        const subscription = sync.attachSubscription({ id: 'web-1', wantsDelta: true })
        sync.ingest({
            kind: 'full', sessionId: 'session-1', localId: 'stream-1', content: textEnvelope('a'), rev: 1,
        })

        now += 60_001
        expect(subscription.resync('session-1')).toEqual([])
        expect(sync.ingest({ kind: 'delta', sessionId: 'session-1', frame: delta(2, 1, 'b') }))
            .toEqual({ status: 'ignored', reason: 'missing-baseline' })
    })

    test('订阅游标过期时用当前完整基线追赶', () => {
        let now = 1_000
        const sync = new SnapshotSync({ ttlMs: 120_000, cursorTtlMs: 60_000, now: () => now })
        const subscription = sync.attachSubscription({ id: 'web-1', wantsDelta: true })
        const full = sync.ingest({
            kind: 'full', sessionId: 'session-1', localId: 'stream-1', content: textEnvelope('a'), rev: 1,
        })
        expect(full.status).toBe('accepted')
        if (full.status !== 'accepted') return
        subscription.resolve(full.publication)

        now += 60_001
        const appended = sync.ingest({ kind: 'delta', sessionId: 'session-1', frame: delta(2, 1, 'b') })
        expect(appended.status).toBe('accepted')
        if (appended.status !== 'accepted') return
        const catchUp = subscription.resolve(appended.publication)
        expect(catchUp?.type).toBe('message-snapshot')
    })

    test('按序应用 thinking、new-block 和 replace-block，并由完整追赶暴露重建结果', () => {
        const sync = new SnapshotSync()
        sync.ingest({
            kind: 'full',
            sessionId: 'session-1',
            localId: 'stream-1',
            content: envelope([{ type: 'thinking', thinking: 'th' }]),
            rev: 1,
        })
        expect(sync.ingest({
            kind: 'delta',
            sessionId: 'session-1',
            frame: {
                localId: 'stream-1',
                rev: 2,
                baseRev: 1,
                deltas: [
                    { op: 'append', index: 0, text: 'ink' },
                    { op: 'new-block', index: 1, block: { type: 'tool_use', id: 't1', name: 'Bash', input: {} } },
                ],
            },
        }).status).toBe('accepted')
        const replaced = sync.ingest({
            kind: 'delta',
            sessionId: 'session-1',
            frame: {
                localId: 'stream-1',
                rev: 3,
                baseRev: 2,
                deltas: [{
                    op: 'replace-block',
                    index: 1,
                    block: { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
                }],
            },
        })
        expect(replaced.status).toBe('accepted')
        if (replaced.status !== 'accepted') return

        const late = sync.attachSubscription({ id: 'late', wantsDelta: false })
        const full = late.resolve(replaced.publication)
        expect(full?.type).toBe('message-snapshot')
        if (full?.type !== 'message-snapshot') return
        expect(blocksOf(full.message.content)).toEqual([
            { type: 'thinking', thinking: 'think' },
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
        ])
    })

    test('违规增量返回结构化原因并丢弃基线，直到下一次完整帧', () => {
        const sync = new SnapshotSync()
        sync.ingest({
            kind: 'full',
            sessionId: 'session-1',
            localId: 'stream-1',
            content: envelope([{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]),
            rev: 1,
        })
        expect(sync.ingest({
            kind: 'delta',
            sessionId: 'session-1',
            frame: delta(2, 1, 'invalid append'),
        })).toEqual({ status: 'ignored', reason: 'invalid-delta' })
        expect(sync.ingest({
            kind: 'delta',
            sessionId: 'session-1',
            frame: { ...delta(3, 2, ''), deltas: [] },
        })).toEqual({ status: 'ignored', reason: 'missing-baseline' })
    })

    test('legacy 或不可导航的完整帧原样发布，但不建立增量链', () => {
        const sync = new SnapshotSync()
        const legacyContent = textEnvelope('legacy')
        const legacy = sync.ingest({
            kind: 'full', sessionId: 'session-1', localId: 'stream-1', content: legacyContent, rev: null,
        })
        expect(legacy.status).toBe('accepted')
        if (legacy.status !== 'accepted' || legacy.publication.type !== 'message-snapshot') return
        expect(legacy.publication.message.content).toBe(legacyContent)
        expect(sync.ingest({ kind: 'delta', sessionId: 'session-1', frame: delta(1, 0, 'x') }))
            .toEqual({ status: 'ignored', reason: 'missing-baseline' })

        const weird = { role: 'agent', content: { type: 'text', text: 'not output envelope' } }
        expect(sync.ingest({
            kind: 'full', sessionId: 'session-1', localId: 'stream-2', content: weird, rev: 1,
        }).status).toBe('accepted')
        expect(sync.ingest({
            kind: 'delta', sessionId: 'session-1', frame: { ...delta(2, 1, 'x'), localId: 'stream-2' },
        })).toEqual({ status: 'ignored', reason: 'missing-baseline' })
    })

    test('相同 localId 在不同会话中拥有独立缓存与订阅游标', () => {
        const sync = new SnapshotSync()
        const subscription = sync.attachSubscription({ id: 'web-1', wantsDelta: true })
        for (const [sessionId, text, rev] of [['session-1', 'a', 1], ['session-2', 'x', 5]] as const) {
            const full = sync.ingest({
                kind: 'full', sessionId, localId: 'stream-1', content: textEnvelope(text), rev,
            })
            expect(full.status).toBe('accepted')
            if (full.status === 'accepted') subscription.resolve(full.publication)
        }

        const first = sync.ingest({ kind: 'delta', sessionId: 'session-1', frame: delta(2, 1, 'b') })
        const second = sync.ingest({ kind: 'delta', sessionId: 'session-2', frame: delta(6, 5, 'y') })
        expect(first.status).toBe('accepted')
        expect(second.status).toBe('accepted')
        if (first.status !== 'accepted' || second.status !== 'accepted') return
        expect(subscription.resolve(first.publication)?.type).toBe('message-snapshot-delta')
        expect(subscription.resolve(second.publication)?.type).toBe('message-snapshot-delta')

        sync.endStream('session-1', 'stream-1')
        expect(subscription.resync('session-1')).toEqual([])
        expect(subscription.resync('session-2')).toHaveLength(1)
    })

    test('在 module 边界统一记录 CLI 入站与 Web 订阅出站流量', () => {
        const stats = new SnapshotDeltaStats(true, 30_000, () => {})
        const sync = new SnapshotSync({ stats })
        const subscription = sync.attachSubscription({ id: 'web-1', wantsDelta: true })
        const full = sync.ingest({
            kind: 'full', sessionId: 'session-1', localId: 'stream-1', content: textEnvelope('a'), rev: 1,
        })
        expect(full.status).toBe('accepted')
        if (full.status !== 'accepted') return
        subscription.resolve(full.publication)
        const next = sync.ingest({ kind: 'delta', sessionId: 'session-1', frame: delta(2, 1, 'b') })
        expect(next.status).toBe('accepted')
        if (next.status !== 'accepted') return
        subscription.resolve(next.publication)

        expect(stats.snapshot()).toMatchObject({
            'cli-to-hub': { fullFrames: 1, deltaFrames: 1 },
            'hub-to-web': { fullFrames: 1, deltaFrames: 1 },
        })
    })

    test('同 id 的新订阅接管后旧 handle 失效，close 后不能继续解析或重同步', () => {
        const sync = new SnapshotSync()
        const old = sync.attachSubscription({ id: 'web-1', wantsDelta: true })
        const current = sync.attachSubscription({ id: 'web-1', wantsDelta: true })
        const full = sync.ingest({
            kind: 'full', sessionId: 'session-1', localId: 'stream-1', content: textEnvelope('a'), rev: 1,
        })
        expect(full.status).toBe('accepted')
        if (full.status !== 'accepted') return

        expect(old.resolve(full.publication)).toBeNull()
        old.close()
        expect(current.resolve(full.publication)).toBe(full.publication)
        current.close()
        expect(current.resolve(full.publication)).toBeNull()
        expect(current.resync('session-1')).toEqual([])
    })
})
