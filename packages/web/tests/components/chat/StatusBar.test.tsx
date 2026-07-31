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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { GoalStatus } from '@mobi/shared'

afterEach(cleanup)

// StatusBar 的职责：「有 goal 或 running（含 status）时渲染对应内容，否则不渲染」。
// mock 掉 AgentLoadingBubble 与 GoalBadge，隔离各自内部依赖，
// 让测试聚焦 StatusBar 自身的渲染门控与并列逻辑。
vi.mock('@/components/chat/AgentLoadingBubble', () => ({
    AgentLoadingBubble: ({ agentId, status }: { agentId: string; status: string }) => (
        <div data-testid="loading-bubble" data-agent={agentId} data-status={status} />
    ),
}))

vi.mock('@/components/chat/GoalBadge', () => ({
    GoalBadge: ({ goal, sessionId }: { goal: GoalStatus; sessionId?: string }) => (
        <div data-testid="goal-badge" data-met={String(goal.met)} data-session={sessionId ?? ''} />
    ),
}))

import { StatusBar } from '@/components/chat/StatusBar'

const activeGoal: GoalStatus = { met: false, condition: '所有测试通过' }

describe('StatusBar', () => {
    it('goal=null 且 running=false 时不渲染任何内容', () => {
        const { container } = render(
            <StatusBar agentId="session-1" status="idle" running={false} />
        )
        expect(screen.queryByTestId('loading-bubble')).toBeNull()
        expect(screen.queryByTestId('goal-badge')).toBeNull()
        expect(container.firstChild).toBeNull()
    })

    it('running=true（含 status）时渲染 loading 内容并透传 agentId / status', () => {
        render(
            <StatusBar agentId="session-1" status="outputting" running={true} />
        )
        const bubble = screen.getByTestId('loading-bubble')
        expect(bubble.getAttribute('data-agent')).toBe('session-1')
        expect(bubble.getAttribute('data-status')).toBe('outputting')
    })

    it('running=true 但 status 缺省且无 goal 时不渲染', () => {
        const { container } = render(
            <StatusBar agentId="session-1" running={true} />
        )
        expect(screen.queryByTestId('loading-bubble')).toBeNull()
        expect(container.firstChild).toBeNull()
    })

    it('goal!=null 时渲染 GoalBadge 并透传 sessionId', () => {
        render(
            <StatusBar
                agentId="session-1"
                running={false}
                goal={activeGoal}
                sessionId="s-1"
            />,
        )
        const badge = screen.getByTestId('goal-badge')
        expect(badge.getAttribute('data-met')).toBe('false')
        expect(badge.getAttribute('data-session')).toBe('s-1')
    })

    it('goal + running 都有时：loading 靠左、goal 靠右（DOM 顺序 loading 在前）', () => {
        render(
            <StatusBar
                agentId="session-1"
                status="outputting"
                running={true}
                goal={activeGoal}
                sessionId="s-1"
            />,
        )
        const bubble = screen.getByTestId('loading-bubble')
        const badge = screen.getByTestId('goal-badge')
        // loading 在前（靠左），goal 在后（靠右，marginLeft:auto）
        expect(badge.compareDocumentPosition(bubble)).toBe(Node.DOCUMENT_POSITION_PRECEDING)
    })

    it('goal=null 且 running=false（即使有 sessionId/onClearGoal）不渲染', () => {
        const { container } = render(
            <StatusBar
                agentId="session-1"
                running={false}
                sessionId="s-1"
                onClearGoal={vi.fn()}
            />,
        )
        expect(container.firstChild).toBeNull()
    })
})
