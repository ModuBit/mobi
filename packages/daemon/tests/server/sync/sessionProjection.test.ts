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
import { applySessionEnd, projectSession } from '../../../src/sync/sessionProjection'
import type { StoredSession } from '../../../src/store/types'

/**
 * 投影单源（深化候选②）：接口即测试面——直接喂 StoredSession 断言 Session，
 * 无需起整个 SessionCache + 假 publisher。锁三类回归：
 * ① 终结快照从 stored 到内存行不缺字段（4a1a3cc5 前科）；
 * ② 脏枚举值窄化为 null，不向 SSE/Web 扩散；
 * ③ 只存在于内存的 active/running/mode 不被 DB 行覆盖。
 */

function makeStored(overrides: Partial<StoredSession> = {}): StoredSession {
    return {
        id: 's1',
        tag: 'tag-1',
        namespace: 'default',
        createdAt: 1000,
        updatedAt: 2000,
        metadata: null,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        runtimeState: null,
        runtimeStateUpdatedAt: null,
        workspaceId: 'ws-1',
        pinned: true,
        seq: 7,
        endReason: null,
        pauseTrigger: null,
        endedAt: null,
        ...overrides,
    }
}

describe('projectSession — stored → 内存 Session', () => {
    test('终结快照三字段投影齐全（warm-on-open 判 pause 的供数面）', () => {
        const session = projectSession(makeStored({
            endReason: 'pause',
            pauseTrigger: 'governor_evict',
            endedAt: 1234,
        }))

        expect(session.endReason).toBe('pause')
        expect(session.pauseTrigger).toBe('governor_evict')
        expect(session.endedAt).toBe(1234)
    })

    test('脏枚举值窄化为 null（DB 手改/老数据不向 wire 扩散）', () => {
        const session = projectSession(makeStored({
            endReason: 'not-a-reason',
            pauseTrigger: 'not-a-trigger',
        }))

        expect(session.endReason).toBeNull()
        expect(session.pauseTrigger).toBeNull()
    })

    test('内存态字段取 existing：active/running/mode 不被 DB 行覆盖', () => {
        const existing = projectSession(makeStored())
        existing.active = true
        existing.activeAt = 555
        existing.running = true
        existing.runningAt = 666
        existing.mode = 'remote'

        const session = projectSession(makeStored(), existing)

        expect(session.active).toBe(true)
        expect(session.activeAt).toBe(555)
        expect(session.running).toBe(true)
        expect(session.runningAt).toBe(666)
        expect(session.mode).toBe('remote')
    })

    test('existing 缺省：active=false，activeAt 取当前时间（避免刚加载即被 expireInactive 驱逐）', () => {
        const before = Date.now()
        const session = projectSession(makeStored())
        const after = Date.now()

        expect(session.active).toBe(false)
        expect(session.activeAt).toBeGreaterThanOrEqual(before)
        expect(session.activeAt).toBeLessThanOrEqual(after)
    })

    test('DB 标量字段如实投影（pinned/workspaceId/tag/seq 等漏投影前科的守卫）', () => {
        const session = projectSession(makeStored())

        expect(session.id).toBe('s1')
        expect(session.tag).toBe('tag-1')
        expect(session.workspaceId).toBe('ws-1')
        expect(session.pinned).toBe(true)
        expect(session.seq).toBe(7)
        expect(session.createdAt).toBe(1000)
        expect(session.updatedAt).toBe(2000)
    })
})

describe('applySessionEnd — 终结快照内存增量写/清', () => {
    test('写入：三字段与落库同值同步', () => {
        const session = projectSession(makeStored())

        applySessionEnd(session, { reason: 'pause', trigger: 'idle_timeout', at: 999 })

        expect(session.endReason).toBe('pause')
        expect(session.pauseTrigger).toBe('idle_timeout')
        expect(session.endedAt).toBe(999)
    })

    test('清空（唤醒收口）：三字段归 null', () => {
        const session = projectSession(makeStored({
            endReason: 'pause',
            pauseTrigger: 'idle_timeout',
            endedAt: 999,
        }))

        applySessionEnd(session, null)

        expect(session.endReason).toBeNull()
        expect(session.pauseTrigger).toBeNull()
        expect(session.endedAt).toBeNull()
    })

    test('无 trigger 的终结（stop）把 trigger 置 null 而非保留旧值', () => {
        const session = projectSession(makeStored({
            endReason: 'pause',
            pauseTrigger: 'manual',
            endedAt: 999,
        }))

        applySessionEnd(session, { reason: 'stop', trigger: null, at: 1000 })

        expect(session.endReason).toBe('stop')
        expect(session.pauseTrigger).toBeNull()
        expect(session.endedAt).toBe(1000)
    })
})
