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

import { describe, it, expect, beforeEach } from 'vitest'
import {
    requestWithdraw,
    consumeWithdraw,
    clearSession,
    nextWithdrawNonce,
    _resetForTest,
} from '@/core/data/stores/withdrawStore'

describe('withdrawStore（撤回请求一次性信箱，spec §7.5）', () => {
    beforeEach(() => _resetForTest())

    it('consume 返回后即清除（一次性）', () => {
        requestWithdraw('s1', { localId: 'l1', segments: null, originalText: 'hi', nonce: nextWithdrawNonce() })
        expect(consumeWithdraw('s1')).toMatchObject({ localId: 'l1', originalText: 'hi' })
        expect(consumeWithdraw('s1')).toBeNull()
    })

    it('并发 nonce 递增，旧请求被覆盖', () => {
        const n1 = nextWithdrawNonce()
        requestWithdraw('s1', { localId: 'l1', segments: null, originalText: 'a', nonce: n1 })
        const n2 = nextWithdrawNonce()
        expect(n2).toBeGreaterThan(n1)
        requestWithdraw('s1', { localId: 'l2', segments: null, originalText: 'b', nonce: n2 })
        expect(consumeWithdraw('s1')).toMatchObject({ localId: 'l2', nonce: n2 })
    })

    it('多 session 独立（s1 的请求不影响 s2）', () => {
        requestWithdraw('s1', { localId: 'l1', segments: null, originalText: null, nonce: nextWithdrawNonce() })
        expect(consumeWithdraw('s2')).toBeNull()
        expect(consumeWithdraw('s1')).not.toBeNull()
    })

    it('clearSession 清除滞留请求（会话打开前的陈旧请求由挂载方丢弃）', () => {
        requestWithdraw('s1', { localId: 'l1', segments: null, originalText: 'stale', nonce: nextWithdrawNonce() })
        clearSession('s1')
        expect(consumeWithdraw('s1')).toBeNull()
    })

    it('requestWithdraw 由 store 盖 createdAt 时间戳（挂载基线甄别陈旧的数据源）', () => {
        const before = Date.now()
        requestWithdraw('s1', { localId: 'l1', segments: null, originalText: 'hi', nonce: nextWithdrawNonce() })
        const req = consumeWithdraw('s1')
        expect(req).not.toBeNull()
        expect(req!.createdAt).toBeGreaterThanOrEqual(before)
        expect(req!.createdAt).toBeLessThanOrEqual(Date.now())
    })
})
