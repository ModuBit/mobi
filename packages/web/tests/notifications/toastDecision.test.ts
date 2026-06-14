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
import { decideToastAction } from '@/core/notifications/toastDecision'
import { parseActiveSessionId } from '@/core/notifications/parseActiveSessionId'

describe('decideToastAction', () => {
    it('① 正盯着该 session(visible 且路由匹配)→ ignore', () => {
        expect(decideToastAction('s1', { activeSessionId: 's1', isHidden: false })).toBe('ignore')
    })

    it('② 前台但不在该 session → page-toast', () => {
        expect(decideToastAction('s1', { activeSessionId: 's2', isHidden: false })).toBe('page-toast')
        expect(decideToastAction('s1', { activeSessionId: null, isHidden: false })).toBe('page-toast')
    })

    it('③ 后台(hidden)→ system-notification,即使路由在该 session', () => {
        expect(decideToastAction('s1', { activeSessionId: 's1', isHidden: true })).toBe('system-notification')
        expect(decideToastAction('s1', { activeSessionId: 's2', isHidden: true })).toBe('system-notification')
    })
})

describe('parseActiveSessionId', () => {
    it('从 /sessions/:id 解析出 sessionId', () => {
        expect(parseActiveSessionId('/sessions/abc-123')).toBe('abc-123')
    })

    it('非 session 详情页返回 null', () => {
        expect(parseActiveSessionId('/')).toBe(null)
        expect(parseActiveSessionId('/settings')).toBe(null)
        expect(parseActiveSessionId('/sessions/')).toBe(null)
    })

    it('带 query/hash 不影响解析', () => {
        expect(parseActiveSessionId('/sessions/abc?foo=bar')).toBe('abc')
        expect(parseActiveSessionId('/sessions/abc#chat')).toBe('abc')
    })
})
