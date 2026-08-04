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
import { getSessionAvatarStatus, compareSessionsForList } from '@/core/utils/sessionStatus'

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

describe('compareSessionsForList', () => {
    // 构造最小输入：只含 active + updatedAt
    const s = (active: boolean, updatedAt: number) => ({ active, updatedAt }) as never

    it('活跃会话排在退出会话之前（a active, b inactive → 负）', () => {
        expect(compareSessionsForList(s(true, 100), s(false, 200))).toBeLessThan(0)
    })

    it('退出会话排在活跃会话之后（a inactive, b active → 正）', () => {
        expect(compareSessionsForList(s(false, 200), s(true, 100))).toBeGreaterThan(0)
    })

    it('不变性：刚退出的会话 updatedAt 更新，也压不过活跃会话', () => {
        // 退出会话 updatedAt=1000（刚退出），活跃会话 updatedAt=100（早），活跃仍在前
        expect(compareSessionsForList(s(false, 1000), s(true, 100))).toBeGreaterThan(0)
    })

    it('同活跃组内按 updatedAt 倒序（更新的在前）', () => {
        expect(compareSessionsForList(s(true, 100), s(true, 200))).toBeGreaterThan(0)
        expect(compareSessionsForList(s(true, 200), s(true, 100))).toBeLessThan(0)
    })

    it('同退出组内按 updatedAt 倒序', () => {
        expect(compareSessionsForList(s(false, 100), s(false, 200))).toBeGreaterThan(0)
    })

    it('同 active 且 updatedAt 相同 → 0', () => {
        expect(compareSessionsForList(s(true, 100), s(true, 100))).toBe(0)
        expect(compareSessionsForList(s(false, 100), s(false, 100))).toBe(0)
    })

    it('各活跃状态（执行中/等待输入/等待审批）都同属 active，彼此只按 updatedAt 排序', () => {
        // outputting / idle / awaiting_auth 都是 active=true，排序只看 updatedAt
        const outputting = s(true, 50)
        const idle = s(true, 300)
        const awaiting = s(true, 150)
        const sorted = [outputting, idle, awaiting].sort(compareSessionsForList)
        // 倒序：idle(300) → awaiting(150) → outputting(50)
        expect(sorted).toEqual([idle, awaiting, outputting])
    })
})
