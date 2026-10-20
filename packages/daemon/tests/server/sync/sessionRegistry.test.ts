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

import { describe, test, expect, beforeEach } from 'bun:test'
import { SessionRegistry } from '../../../src/sync/sessionRegistry'
import type { SessionGovernanceSnapshot } from '@mobi/shared/types'

/**
 * 票 1.2：治理登记簿的登记/查询/离场语义——纯内存，Governor（迭代二）的数据面。
 * 边界断言：registry 不做任何决策，只登记（blockers 快照原样存取）。
 */

const snap = (over: Partial<SessionGovernanceSnapshot> = {}): SessionGovernanceSnapshot => ({
    state: 'idle',
    lastActivityAt: 1000,
    gateBlockers: [],
    ...over,
})

describe('SessionRegistry', () => {
    let now: number
    let registry: SessionRegistry

    beforeEach(() => {
        now = 10_000
        registry = new SessionRegistry(() => now)
    })

    test('upsert → get 原样返回快照', () => {
        registry.upsert('s1', snap({ state: 'active', lastActivityAt: 9000, gateBlockers: ['turn_running'], rss: 12345 }))

        const got = registry.get('s1')
        expect(got?.state).toBe('active')
        expect(got?.lastActivityAt).toBe(9000)
        expect(got?.gateBlockers).toEqual(['turn_running'])
        expect(got?.rss).toBe(12345)
    })

    test('remove 即离场；未登记 get 返回 null', () => {
        registry.upsert('s1', snap())
        registry.remove('s1')
        expect(registry.get('s1')).toBeNull()
        expect(registry.get('unknown')).toBeNull()
    })

    test('心跳停止超 30s 视为离场（live/get 均剔除）', () => {
        registry.upsert('s1', snap())
        registry.upsert('s2', snap())

        now += 31_000
        registry.upsert('s3', snap()) // 触发清扫

        expect(registry.get('s1')).toBeNull()
        expect(registry.live().map(e => e.sessionId)).toEqual(['s3'])
    })

    test('live 返回全部存活条目，rss 缺省拍不携带字段', () => {
        registry.upsert('with-rss', snap({ rss: 100 }))
        registry.upsert('no-rss', snap())

        const live = registry.live()
        expect(live).toHaveLength(2)
        expect(live.find(e => e.sessionId === 'no-rss')?.rss).toBeUndefined()
        expect(live.find(e => e.sessionId === 'with-rss')?.rss).toBe(100)
    })
})
