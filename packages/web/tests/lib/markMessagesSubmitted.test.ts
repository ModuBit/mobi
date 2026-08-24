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

import { describe, it, expect } from 'vitest'
import { markMessagesSubmitted } from '@/core/lib/markMessagesSubmitted'
import type { DecryptedMessage } from '@/core/data/api/types'

/** 创建 mock DecryptedMessage。lifecycleAt 非空 ⇒ 已 pushed（lifecycle='pushed'） */
function m(
    localId: string | null,
    lifecycleAt: number | null | undefined,
    overrides: Partial<DecryptedMessage> = {},
): DecryptedMessage {
    return {
        id: localId ?? 'x',
        seq: 1,
        localId,
        createdAt: 0,
        content: { role: 'user', content: 'hello' },
        lifecycleAt,
        lifecycle: lifecycleAt != null ? 'pushed' : 'queued',
        status: lifecycleAt != null ? 'sent' : 'queued',
        ...overrides,
    }
}

describe('markMessagesSubmitted', () => {
    it('翻转命中 localId 的 lifecycleAt 并更新 status', () => {
        const out = markMessagesSubmitted(
            [m('a', null), m('b', null)],
            ['a'],
            999,
        )
        expect(out[0].lifecycleAt).toBe(999)
        expect(out[0].status).toBe('sent')
        expect(out[1].lifecycleAt).toBeNull()
        expect(out[1].status).toBe('queued')
    })

    it('已 pushed 的不动（first-write-wins）', () => {
        const out = markMessagesSubmitted([m('a', 100)], ['a'], 999)
        expect(out[0].lifecycleAt).toBe(100)
        expect(out[0].lifecycle).toBe('pushed')
        expect(out[0].status).toBe('sent')
    })

    it('localId 为 null 的消息不受影响', () => {
        const out = markMessagesSubmitted([m(null, null)], ['x'], 999)
        expect(out[0].lifecycleAt).toBeNull()
    })

    it('未命中的 localId 不影响其他消息', () => {
        const out = markMessagesSubmitted(
            [m('a', null), m('b', null)],
            ['c'],
            999,
        )
        expect(out[0].lifecycleAt).toBeNull()
        expect(out[1].lifecycleAt).toBeNull()
    })

    it('空数组安全返回', () => {
        const out = markMessagesSubmitted([], ['a'], 999)
        expect(out).toEqual([])
    })

    it('不修改原数组（返回新数组）', () => {
        const original = [m('a', null)]
        const out = markMessagesSubmitted(original, ['a'], 999)
        expect(original[0].lifecycleAt).toBeNull()
        expect(out[0].lifecycleAt).toBe(999)
        expect(out).not.toBe(original)
    })

    it('消费时 positionAt 跳到 lifecycleAt（对齐 hub 跳变语义）', () => {
        const out = markMessagesSubmitted([m('a', null)], ['a'], 999)
        expect(out[0].positionAt).toBe(999)
    })

    it('消费后按 positionAt 重排：排队消息跳到 turn 消息之后', () => {
        const assistant = (id: string, positionAt: number): DecryptedMessage => ({
            id,
            seq: 1,
            localId: null,
            createdAt: positionAt,
            content: { role: 'agent', content: { type: 'text', text: id } },
            lifecycleAt: null,
            lifecycle: null,
            status: 'sent',
            positionAt,
        })
        // 运行中发消息：assistant A(100) → 排队用户消息 q(150, 发送时刻) → assistant B(200)
        const queued: DecryptedMessage = {
            id: 'q',
            seq: 2,
            localId: 'loc-q',
            createdAt: 150,
            content: { role: 'user', content: 'hello' },
            lifecycleAt: null,
            lifecycle: 'queued',
            status: 'queued',
            positionAt: 150,
        }

        const out = markMessagesSubmitted(
            [assistant('a', 100), queued, assistant('b', 200)],
            ['loc-q'],
            999,
        )

        // q 消费后 positionAt 跳到 999 → 排在 turn 消息之后，而非卡在 A/B 中间
        expect(out.map(x => x.id)).toEqual(['a', 'b', 'q'])
        expect(out.find(x => x.id === 'q')?.positionAt).toBe(999)
    })
})
