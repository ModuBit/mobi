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
import { DecryptedMessageSchema, SyncEventSchema } from '../src/schemas'

describe('DecryptedMessageSchema metadata（rewind 锚点）', () => {
    it('解析带 metadata 的消息（nativeId + nativeSessionId）', () => {
        const parsed = DecryptedMessageSchema.safeParse({
            id: 'm1',
            seq: 1,
            localId: 'local-abc',
            metadata: { nativeId: '550e8400-e29b-41d4-a716-446655440000', nativeSessionId: 'sess-1' },
            content: {},
            createdAt: 1,
        })
        expect(parsed.success).toBe(true)
        if (parsed.success) {
            expect(parsed.data.metadata?.nativeId).toBe('550e8400-e29b-41d4-a716-446655440000')
            expect(parsed.data.metadata?.nativeSessionId).toBe('sess-1')
        }
    })

    it('metadata 可缺省（旧行/未绑定消息）', () => {
        const parsed = DecryptedMessageSchema.safeParse({
            id: 'm1',
            seq: 1,
            localId: null,
            content: {},
            createdAt: 1,
        })
        expect(parsed.success).toBe(true)
    })

    it('metadata 可为 null，nativeSessionId 可省略（新会话首批 push，待 attach 补写）', () => {
        const withNull = DecryptedMessageSchema.safeParse({
            id: 'm1', seq: 1, localId: null, metadata: null, content: {}, createdAt: 1,
        })
        expect(withNull.success).toBe(true)

        const noSession = DecryptedMessageSchema.safeParse({
            id: 'm2', seq: 2, localId: 'l2', metadata: { nativeId: 'u2' }, content: {}, createdAt: 2,
        })
        expect(noSession.success).toBe(true)
    })
})

describe('SyncEventSchema rewind 两段回报事件', () => {
    it('rewound-truncated 载荷含 sessionId 与 deleteFromSeq', () => {
        const parsed = SyncEventSchema.safeParse({
            type: 'rewound-truncated', sessionId: 's1', deleteFromSeq: 3,
        })
        expect(parsed.success).toBe(true)
    })

    it('rewind-completed 载荷含 sessionId 与 filesRestored（error 可选）', () => {
        const ok = SyncEventSchema.safeParse({ type: 'rewind-completed', sessionId: 's1', filesRestored: true })
        const withErr = SyncEventSchema.safeParse({
            type: 'rewind-completed', sessionId: 's1', filesRestored: false, error: 'boom',
        })
        expect(ok.success).toBe(true)
        expect(withErr.success).toBe(true)
    })
})
