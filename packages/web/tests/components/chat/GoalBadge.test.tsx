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
import '@testing-library/jest-dom/vitest'
import type { GoalStatus } from '@mobi/shared'

afterEach(cleanup)

// ClearStateButton 走 Popconfirm/Drawer + theme token，mock 成占位按钮聚焦 GoalBadge 行为
vi.mock('@/components/composer/ClearStateButton', () => ({
    ClearStateButton: ({ sessionId, clearField }: { sessionId: string; clearField: string }) => (
        <button type="button" data-testid="clear-goal-btn" data-session={sessionId} data-field={clearField} />
    ),
}))

import { GoalBadge } from '@/components/chat/GoalBadge'

describe('GoalBadge', () => {
    it('met=false 时渲染 active 状态', () => {
        const goal: GoalStatus = { met: false, condition: '所有测试通过' }
        render(<GoalBadge goal={goal} />)
        expect(screen.getByText('◎ active')).toBeTruthy()
        expect(screen.getByText('所有测试通过')).toBeTruthy()
    })

    it('met=true 时渲染达成状态', () => {
        const goal: GoalStatus = { met: true, condition: '所有测试通过' }
        render(<GoalBadge goal={goal} />)
        expect(screen.getByText('✓ 达成')).toBeTruthy()
    })

    it('condition 文本正确显示', () => {
        const goal: GoalStatus = { met: false, condition: '重构 composer 模块' }
        render(<GoalBadge goal={goal} />)
        expect(screen.getByText('重构 composer 模块')).toBeTruthy()
    })

    it('condition 超长时仍渲染（ellipsis 由 CSS 处理）', () => {
        const longCondition = '这是一个非常非常非常非常非常非常非常非常非常长的 goal condition 文本'
        const goal: GoalStatus = { met: true, condition: longCondition }
        render(<GoalBadge goal={goal} />)
        expect(screen.getByText(longCondition)).toBeTruthy()
    })

    it('不传 sessionId/onClear 时纯展示，不渲染清理按钮', () => {
        const goal: GoalStatus = { met: false, condition: '所有测试通过' }
        render(<GoalBadge goal={goal} />)
        expect(screen.queryByTestId('clear-goal-btn')).toBeNull()
    })

    it('传 sessionId + onClear 时渲染清理按钮并透传 sessionId / clearField=goalStatus', () => {
        const goal: GoalStatus = { met: false, condition: '所有测试通过' }
        render(
            <GoalBadge
                goal={goal}
                sessionId="s-xyz"
                onClear={vi.fn()}
            />,
        )
        const clearBtn = screen.getByTestId('clear-goal-btn')
        expect(clearBtn).toHaveAttribute('data-session', 's-xyz')
        expect(clearBtn).toHaveAttribute('data-field', 'goalStatus')
    })

    it('只传 sessionId 不传 onClear 时不渲染清理按钮', () => {
        const goal: GoalStatus = { met: true, condition: '所有测试通过' }
        // @ts-expect-error 故意只传 sessionId 测试守卫
        render(<GoalBadge goal={goal} sessionId="s1" />)
        expect(screen.queryByTestId('clear-goal-btn')).toBeNull()
    })
})
