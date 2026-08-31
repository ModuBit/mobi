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
    _resetForTest,
} from '@/core/data/stores/withdrawStore'

describe('withdrawStore（撤回请求一次性信箱，spec §7.5）', () => {
    beforeEach(() => _resetForTest())

    it('consume 返回后即清除（一次性）', () => {
        requestWithdraw('s1', { localId: 'l1', segments: null, originalText: 'hi' })
        expect(consumeWithdraw('s1')).toMatchObject({ localId: 'l1', originalText: 'hi' })
        expect(consumeWithdraw('s1')).toBeNull()
    })

    it('同会话后到请求覆盖旧请求（覆盖制单值）', () => {
        requestWithdraw('s1', { localId: 'l1', segments: null, originalText: 'a' })
        requestWithdraw('s1', { localId: 'l2', segments: null, originalText: 'b' })
        expect(consumeWithdraw('s1')).toMatchObject({ localId: 'l2', originalText: 'b' })
    })

    it('多 session 独立（s1 的请求不影响 s2）', () => {
        requestWithdraw('s1', { localId: 'l1', segments: null, originalText: null })
        expect(consumeWithdraw('s2')).toBeNull()
        expect(consumeWithdraw('s1')).not.toBeNull()
    })

    it('clearSession 清除滞留请求（会话打开前的陈旧请求由挂载方丢弃）', () => {
        requestWithdraw('s1', { localId: 'l1', segments: null, originalText: 'stale' })
        clearSession('s1')
        expect(consumeWithdraw('s1')).toBeNull()
    })

    it('requestWithdraw 由 store 盖 createdAt 时间戳（挂载基线甄别陈旧的数据源）', () => {
        const before = Date.now()
        requestWithdraw('s1', { localId: 'l1', segments: null, originalText: 'hi' })
        const req = consumeWithdraw('s1')
        expect(req).not.toBeNull()
        expect(req!.createdAt).toBeGreaterThanOrEqual(before)
        expect(req!.createdAt).toBeLessThanOrEqual(Date.now())
    })
})
