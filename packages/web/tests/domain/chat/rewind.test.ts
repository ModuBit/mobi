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
import { canRewindMessage } from '@/domain/chat/rewind'

/** 判据入参的最小消息形状（结构化类型，与 DecryptedMessage.metadata 同构） */
const base = { localId: 'local-1', metadata: { nativeId: 'u1', nativeSessionId: 'ns-1' } }
const idle = { running: false, backgroundTasks: 0 }

describe('canRewindMessage', () => {
    it('session 与消息 nativeSessionId 一致 → 可 rewind', () => {
        expect(canRewindMessage(base, 'ns-1', idle)).toBe(true)
    })

    it('不一致（/clear 前旧行）→ 不可', () => {
        expect(canRewindMessage(base, 'ns-2', idle)).toBe(false)
    })

    it('缺 nativeId（!bash 本地执行 / 绑定丢失）→ 不可', () => {
        expect(canRewindMessage({ localId: 'l', metadata: null }, 'ns-1', idle)).toBe(false)
        expect(canRewindMessage({ localId: 'l', metadata: {} }, 'ns-1', idle)).toBe(false)
        expect(canRewindMessage({ localId: 'l', metadata: { nativeSessionId: 'ns-1' } }, 'ns-1', idle)).toBe(false)
    })

    it('消息缺 nativeSessionId（新会话首批未 attach）→ 不可（保守）', () => {
        expect(canRewindMessage({ localId: 'l', metadata: { nativeId: 'u1' } }, 'ns-1', idle)).toBe(false)
    })

    it('running 或后台任务在途 → 不可（体验层置灰）', () => {
        expect(canRewindMessage(base, 'ns-1', { running: true, backgroundTasks: 0 })).toBe(false)
        expect(canRewindMessage(base, 'ns-1', { running: false, backgroundTasks: 2 })).toBe(false)
    })

    it('会话无 nativeSessionId（未知态）→ 保守不可', () => {
        expect(canRewindMessage(base, undefined, idle)).toBe(false)
        expect(canRewindMessage(base, null, idle)).toBe(false)
    })
})
