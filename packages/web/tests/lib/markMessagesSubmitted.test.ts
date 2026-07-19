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

/** 创建 mock DecryptedMessage。submittedAt 非空 ⇒ 已 consumed（queueState='consumed'） */
function m(
    localId: string | null,
    submittedAt: number | null | undefined,
    overrides: Partial<DecryptedMessage> = {},
): DecryptedMessage {
    return {
        id: localId ?? 'x',
        seq: 1,
        localId,
        createdAt: 0,
        content: { role: 'user', content: 'hello' },
        submittedAt,
        queueState: submittedAt != null ? 'consumed' : 'pending',
        status: submittedAt != null ? 'sent' : 'queued',
        ...overrides,
    }
}

describe('markMessagesSubmitted', () => {
    it('翻转命中 localId 的 submittedAt 并更新 status', () => {
        const out = markMessagesSubmitted(
            [m('a', null), m('b', null)],
            ['a'],
            999,
        )
        expect(out[0].submittedAt).toBe(999)
        expect(out[0].status).toBe('sent')
        expect(out[1].submittedAt).toBeNull()
        expect(out[1].status).toBe('queued')
    })

    it('已 invoke 的不动（first-write-wins）', () => {
        const out = markMessagesSubmitted([m('a', 100)], ['a'], 999)
        expect(out[0].submittedAt).toBe(100)
        expect(out[0].queueState).toBe('consumed')
        expect(out[0].status).toBe('sent')
    })

    it('localId 为 null 的消息不受影响', () => {
        const out = markMessagesSubmitted([m(null, null)], ['x'], 999)
        expect(out[0].submittedAt).toBeNull()
    })

    it('未命中的 localId 不影响其他消息', () => {
        const out = markMessagesSubmitted(
            [m('a', null), m('b', null)],
            ['c'],
            999,
        )
        expect(out[0].submittedAt).toBeNull()
        expect(out[1].submittedAt).toBeNull()
    })

    it('空数组安全返回', () => {
        const out = markMessagesSubmitted([], ['a'], 999)
        expect(out).toEqual([])
    })

    it('不修改原数组（返回新数组）', () => {
        const original = [m('a', null)]
        const out = markMessagesSubmitted(original, ['a'], 999)
        expect(original[0].submittedAt).toBeNull()
        expect(out[0].submittedAt).toBe(999)
        expect(out).not.toBe(original)
    })
})
