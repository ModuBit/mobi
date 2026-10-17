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

// StatusBar 的职责只有一条：「有 goal 渲染目标行，否则不渲染」。
// loading 指示与缓存提示已回归聊天流（AgentLoadingBubble / CacheExpiredRow），
// mock GoalRow 以聚焦 StatusBar 自身的渲染门控与透传。
vi.mock('@/ui/shared/GoalRow', () => ({
    GoalRow: ({ goal, sessionId }: { goal: GoalStatus; sessionId?: string }) => (
        <div data-testid="goal-row" data-met={String(goal.met)} data-session={sessionId ?? ''} />
    ),
}))

import { StatusBar } from '@/ui/shared/StatusBar'

const activeGoal: GoalStatus = { met: false, condition: '所有测试通过' }

describe('StatusBar', () => {
    it('goal 缺省 / null 时不渲染（不占布局高度）', () => {
        const { container: empty } = render(<StatusBar />)
        expect(empty.firstChild).toBeNull()

        const { container: nullGoal } = render(<StatusBar goal={null} />)
        expect(nullGoal.firstChild).toBeNull()
    })

    it('goal!=null 时渲染目标行并透传 sessionId', () => {
        render(<StatusBar goal={activeGoal} sessionId="s-1" onClearGoal={vi.fn()} />)
        const row = screen.getByTestId('goal-row')
        expect(row.getAttribute('data-met')).toBe('false')
        expect(row.getAttribute('data-session')).toBe('s-1')
    })
})
