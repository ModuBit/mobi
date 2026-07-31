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
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import '@testing-library/jest-dom/vitest'
import type { GoalStatus } from '@mobi/shared'

afterEach(cleanup)

// mock antd Popover：click 时渲染 content（统一 click 触发，桌面/移动端一致），
// 同时保留 trigger(children) 始终渲染，便于断言收起态
vi.mock('antd', async orig => {
    const actual = await orig() as Record<string, unknown>
    const React = await import('react')
    const Popover = ({ content, children }: { content?: ReactNode; children?: ReactNode }) => {
        const [open, setOpen] = React.useState(false)
        return (
            <>
                <span
                    data-testid="popover-trigger"
                    onClick={() => setOpen(o => !o)}
                >
                    {children}
                </span>
                {open ? <div data-testid="popover-content">{content}</div> : null}
            </>
        )
    }
    return { ...actual, Popover }
})

// ClearStateButton 走 Popconfirm/Drawer + theme token，mock 成占位按钮聚焦 GoalBadge 行为
vi.mock('@/components/composer/ClearStateButton', () => ({
    ClearStateButton: ({ sessionId, clearField }: { sessionId: string; clearField: string }) => (
        <button type="button" data-testid="clear-goal-btn" data-session={sessionId} data-field={clearField} />
    ),
}))

import { GoalBadge } from '@/components/chat/GoalBadge'

describe('GoalBadge', () => {
    it('收起简要：徽标只显示 ◎ active（condition 不在收起态，移到 click 详情）', () => {
        const goal: GoalStatus = { met: false, condition: '所有测试通过' }
        render(<GoalBadge goal={goal} />)
        expect(screen.getByText('◎ active')).toBeTruthy()
        // condition 在 click 详情里，收起态不显示
        expect(screen.queryByText('所有测试通过')).toBeNull()
    })

    it('收起态默认不弹出详情（click 前 popover-content 不在）', () => {
        const goal: GoalStatus = { met: false, condition: '所有测试通过', reason: '隐藏理由' }
        render(<GoalBadge goal={goal} />)
        expect(screen.queryByTestId('popover-content')).toBeNull()
    })

    it('click：弹出详情（condition 全文 + reason + 统计）', () => {
        const goal: GoalStatus = {
            met: false,
            condition: '重构 composer 模块',
            reason: '覆盖率达标',
            iterations: 3,
            durationMs: 1234,
            tokens: 9999,
        }
        render(<GoalBadge goal={goal} />)
        fireEvent.click(screen.getByTestId('popover-trigger'))
        const content = screen.getByTestId('popover-content')
        // condition 全文
        expect(content).toHaveTextContent('重构 composer 模块')
        // reason 带 evaluator 前缀
        expect(content).toHaveTextContent('evaluator · 覆盖率达标')
        // 统计
        expect(content).toHaveTextContent('iter 3')
        expect(content).toHaveTextContent('1234ms')
        expect(content).toHaveTextContent('9999 tok')
    })

    it('无 reason/stats 时详情只含 condition', () => {
        const goal: GoalStatus = { met: false, condition: '所有测试通过' }
        render(<GoalBadge goal={goal} />)
        fireEvent.click(screen.getByTestId('popover-trigger'))
        const content = screen.getByTestId('popover-content')
        expect(content).toHaveTextContent('所有测试通过')
        expect(content.textContent).not.toContain('evaluator')
        expect(content.textContent).not.toContain('iter')
    })

    it('不传 sessionId/onClear：click 详情内不渲染清理按钮', () => {
        const goal: GoalStatus = { met: false, condition: '所有测试通过' }
        render(<GoalBadge goal={goal} />)
        fireEvent.click(screen.getByTestId('popover-trigger'))
        expect(screen.queryByTestId('clear-goal-btn')).toBeNull()
    })

    it('传 sessionId + onClear：click 详情内渲染清理按钮并透传 sessionId / clearField=goalStatus', () => {
        const goal: GoalStatus = { met: false, condition: '所有测试通过' }
        render(
            <GoalBadge
                goal={goal}
                sessionId="s-xyz"
                onClear={vi.fn()}
            />,
        )
        fireEvent.click(screen.getByTestId('popover-trigger'))
        const clearBtn = screen.getByTestId('clear-goal-btn')
        expect(clearBtn).toHaveAttribute('data-session', 's-xyz')
        expect(clearBtn).toHaveAttribute('data-field', 'goalStatus')
    })

    it('只传 sessionId 不传 onClear 时不渲染清理按钮', () => {
        const goal: GoalStatus = { met: false, condition: '所有测试通过' }
        // @ts-expect-error 故意只传 sessionId 测试守卫
        render(<GoalBadge goal={goal} sessionId="s1" />)
        fireEvent.click(screen.getByTestId('popover-trigger'))
        expect(screen.queryByTestId('clear-goal-btn')).toBeNull()
    })
})
