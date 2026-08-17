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
import { DecryptedMessageSchema } from '../src/schemas'

describe('DecryptedMessageSchema nativeId', () => {
    it('解析带 nativeId 的消息', () => {
        const parsed = DecryptedMessageSchema.safeParse({
            id: 'm1',
            seq: 1,
            localId: 'local-abc',
            nativeId: '550e8400-e29b-41d4-a716-446655440000',
            content: {},
            createdAt: 1,
        })
        expect(parsed.success).toBe(true)
        if (parsed.success) {
            expect(parsed.data.nativeId).toBe('550e8400-e29b-41d4-a716-446655440000')
        }
    })

    it('nativeId 可缺省（旧行/未绑定消息）', () => {
        const parsed = DecryptedMessageSchema.safeParse({
            id: 'm1',
            seq: 1,
            localId: null,
            content: {},
            createdAt: 1,
        })
        expect(parsed.success).toBe(true)
    })

    it('nativeId 可为 null', () => {
        const parsed = DecryptedMessageSchema.safeParse({
            id: 'm1',
            seq: 1,
            localId: null,
            nativeId: null,
            content: {},
            createdAt: 1,
        })
        expect(parsed.success).toBe(true)
    })
})
