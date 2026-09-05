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
import type { ClientToServerEvents, NativeMessageMetadata } from '../src/socket'

describe('rewind 协议事件类型', () => {
    it('messages-bound bindings 携带 metadata', () => {
        const payload: Parameters<ClientToServerEvents['messages-bound']>[0] = {
            sid: 's1',
            bindings: [{ localId: 'local-1', metadata: { nativeId: 'u1', nativeSessionId: 'sess-1' } }]
        }
        expect(payload.bindings[0].metadata.nativeId).toBe('u1')
    })

    it('native 绑定缺 session 时 nativeSessionId 可省略（新会话首批 push）', () => {
        const payload: Parameters<ClientToServerEvents['messages-bound']>[0] = {
            sid: 's1',
            bindings: [{ localId: 'local-1', metadata: { nativeId: 'u1' } }]
        }
        expect(payload.bindings[0].metadata.nativeSessionId).toBeUndefined()
    })

    it('message 事件 metadata 为可选 NativeMessageMetadata', () => {
        const metadata: NativeMessageMetadata | undefined = { nativeId: 'u1', nativeSessionId: 'sess-1' }
        expect(metadata?.nativeId).toBe('u1')
    })

    it('messages-native-attached / 两段回报事件载荷形态', () => {
        const attached: Parameters<ClientToServerEvents['messages-native-attached']>[0] = { sid: 's1', nativeSessionId: 'ns-1' }
        const truncated: Parameters<ClientToServerEvents['rewind-truncated']>[0] = { sid: 's1', nativeId: 'u1', deleteFromSeq: 3 }
        const completed: Parameters<ClientToServerEvents['rewind-completed']>[0] = { sid: 's1', filesRestored: false, error: 'boom' }
        expect(attached.nativeSessionId).toBe('ns-1')
        expect(truncated.deleteFromSeq).toBe(3)
        expect(completed.filesRestored).toBe(false)
    })
})
