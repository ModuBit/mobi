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
import { getSessionAvatarStatus } from '@/core/utils/sessionStatus'

describe('getSessionAvatarStatus', () => {
    it('未激活 → inactive', () => {
        expect(getSessionAvatarStatus({ active: false, running: false } as never)).toBe('inactive')
    })

    it('详情项：有 agentState.requests → awaiting_auth', () => {
        const session = {
            active: true,
            running: true,
            agentState: { requests: { 'req-1': {} } },
        }
        expect(getSessionAvatarStatus(session as never)).toBe('awaiting_auth')
    })

    it('列表项：只有 pendingRequestsCount（SessionSummary），无 agentState → awaiting_auth', () => {
        // useSessions 把 SessionSummary as Session[]，SessionSummary 无 agentState、
        // 只带 pendingRequestsCount。若函数只读 agentState.requests，列表项会漏判待审批
        const summary = {
            active: true,
            running: true,
            pendingRequestsCount: 2,
        }
        expect(getSessionAvatarStatus(summary as never)).toBe('awaiting_auth')
    })

    it('列表项：pendingRequestsCount 为 0 且 running → outputting', () => {
        const summary = { active: true, running: true, pendingRequestsCount: 0 }
        expect(getSessionAvatarStatus(summary as never)).toBe('outputting')
    })

    it('激活且 running 且无待审批 → outputting', () => {
        expect(getSessionAvatarStatus({ active: true, running: true } as never)).toBe('outputting')
    })

    it('激活且不 running 且无待审批 → idle', () => {
        expect(getSessionAvatarStatus({ active: true, running: false } as never)).toBe('idle')
    })

    it('pendingRequestsCount 与 agentState.requests 同时存在时，任一 > 0 即 awaiting_auth', () => {
        expect(
            getSessionAvatarStatus({
                active: true,
                running: true,
                pendingRequestsCount: 0,
                agentState: { requests: { 'req-1': {} } },
            } as never)
        ).toBe('awaiting_auth')
    })
})
