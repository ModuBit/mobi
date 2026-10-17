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

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import type { GoalStatus } from '@mobi/shared'
import i18n from '@/core/config/i18n'

afterEach(cleanup)

// GoalRow：goal 独占一行的渲染（行内可见摘要 + click 详情 + 行尾清理动作）。
// mock 掉 GoalRow 依赖的 ClearStateButton / Popover 之外的东西没有——这两个是核心断言对象，
// 这里只 mock ClearStateButton（它自带 Popconfirm/Drawer 流程，与行的布局无关）。
vi.mock('@/ui/base/interactive/ClearStateButton', () => ({
    ClearStateButton: ({ sessionId, clearFields }: { sessionId: string; clearFields: string[] }) => (
        <button type="button" data-testid="clear-goal-btn" data-session={sessionId} data-fields={clearFields.join(',')} />
    ),
}))

import { GoalRow } from '@/ui/shared/GoalRow'

const activeGoal: GoalStatus = { met: false, condition: '所有测试通过' }

beforeAll(async () => {
    await i18n.changeLanguage('zh')
})

describe('GoalRow', () => {
    it('行内显示标签与 condition；耗时只在有值时出现', () => {
        render(<GoalRow goal={activeGoal} />)
        expect(screen.getByText('进行中的目标')).toBeTruthy()
        expect(screen.getByText('所有测试通过')).toBeTruthy()
        expect(screen.getByTestId('goal-row').textContent).not.toContain('·')
    })

    it('durationMs 有值时在 condition 后显示格式化耗时', () => {
        render(<GoalRow goal={{ ...activeGoal, durationMs: 638_000 }} />)
        expect(screen.getByTestId('goal-row').textContent).toContain('10m 38s')
    })

    it('详情默认收起；点击后展示 condition 全文 + evaluator reason + 统计', async () => {
        const goal: GoalStatus = {
            met: false,
            condition: '重构 composer 模块',
            reason: '覆盖率达标',
            iterations: 3,
            tokens: 9999,
        }
        render(<GoalRow goal={goal} />)
        expect(screen.queryByText('evaluator · 覆盖率达标')).toBeNull()
        screen.getByRole('button', { name: '目标详情' }).click()
        expect(await screen.findByText('evaluator · 覆盖率达标')).toBeTruthy()
        expect(screen.getByText('iter 3')).toBeTruthy()
        expect(screen.getByText('10.0k tokens')).toBeTruthy()
    })

    it('无 reason/stats 时详情只含 condition', async () => {
        render(<GoalRow goal={activeGoal} />)
        screen.getByRole('button', { name: '目标详情' }).click()
        const detail = await screen.findByText('所有测试通过', { selector: 'div' })
        expect(detail.closest('div')).toBeTruthy()
        expect(document.body.textContent).not.toContain('evaluator')
    })

    it('不传 sessionId/onClear 时不渲染清理动作', () => {
        render(<GoalRow goal={activeGoal} />)
        expect(screen.queryByTestId('clear-goal-btn')).toBeNull()
    })

    it('传 sessionId + onClear 时渲染清理动作并透传 sessionId / clearField=goalStatus', () => {
        render(<GoalRow goal={activeGoal} sessionId="s-xyz" onClear={vi.fn()} />)
        const btn = screen.getByTestId('clear-goal-btn')
        expect(btn.getAttribute('data-session')).toBe('s-xyz')
        expect(btn.getAttribute('data-fields')).toBe('goalStatus')
    })

    it('只传 sessionId 不传 onClear 时不渲染清理动作', () => {
        // @ts-expect-error 故意只传 sessionId 测试守卫
        render(<GoalRow goal={activeGoal} sessionId="s1" />)
        expect(screen.queryByTestId('clear-goal-btn')).toBeNull()
    })
})
