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

/**
 * `mobi sessions stop` 的目标解析契约（发现 C）。
 * sessions list 已换 SQLite 投影（打印 8 位短 id、含 dormant 行），stop 必须经
 * 同一套解析把用户输入折算回完整 mobi id；休眠行无进程可停，单独分类给明确文案。
 */

import { describe, expect, it } from 'vitest'
import type { ForkableSession } from '@mobi/shared'
import { planStop } from '@/commands/stopPlan'

function session(overrides: Partial<ForkableSession> & { id: string }): ForkableSession {
    return {
        title: null,
        path: `/work/${overrides.id}`,
        nativeSessionId: `native-${overrides.id}`,
        updatedAt: 1000,
        status: 'online',
        ...overrides
    }
}

describe('planStop', () => {
    it('完整 mobi id 命中 → stop', () => {
        const target = session({ id: 'full-id-1' })
        const plan = planStop([session({ id: 'other' }), target], 'full-id-1')

        expect(plan).toEqual({ kind: 'stop', session: target })
    })

    it('列表抄的 8 位短 id 前缀命中 → stop 且折算回完整 mobi id', () => {
        const target = session({ id: '12345678-aaaa-bbbb' })
        const plan = planStop([target], '12345678')

        expect(plan.kind).toBe('stop')
        if (plan.kind === 'stop') expect(plan.session.id).toBe('12345678-aaaa-bbbb')
    })

    it('休眠行命中 → dormant（无进程可停，不再打 executor）', () => {
        const target = session({ id: 'dormant-1', status: 'dormant' })
        const plan = planStop([target], 'dormant-1')

        expect(plan).toEqual({ kind: 'dormant', session: target })
    })

    it('前缀多命中 → ambiguous 且带候选', () => {
        const plan = planStop(
            [session({ id: 'abcd1111-x', updatedAt: 10 }), session({ id: 'abcd2222-y', updatedAt: 20 })],
            'abcd'
        )

        expect(plan.kind).toBe('ambiguous')
        if (plan.kind === 'ambiguous') expect(plan.matches).toHaveLength(2)
    })

    it('未命中 → not-found 并回带 query', () => {
        expect(planStop([session({ id: 'a' })], '不存在')).toEqual({ kind: 'not-found', query: '不存在' })
    })

    it('空列表 → empty', () => {
        expect(planStop([], 'a')).toEqual({ kind: 'empty' })
    })
})
