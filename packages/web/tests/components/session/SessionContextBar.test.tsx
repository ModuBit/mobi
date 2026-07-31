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
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import type { ReactNode } from 'react'
import type { GoalStatus } from '@mobi/shared'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import { SessionContextBar } from '@/components/session/SessionContextBar'

// ClearStateButton 走 Popconfirm/Drawer + theme token，这里聚焦 SessionContextBar 行为，mock 成占位按钮
vi.mock('@/components/composer/ClearStateButton', () => ({
    ClearStateButton: ({ sessionId, clearField }: { sessionId: string; clearField: string }) => (
        <button type="button" data-testid="clear-goal-btn" data-session={sessionId} data-field={clearField} />
    ),
}))

// mock i18next（ClearStateButton 内部 useTranslation，mock 后不影响断言）
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({ t: (key: string) => key }),
}))

const wrapper = ({ children }: { children: ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

const metadata: SessionMetadataSummary = {
    path: '/home/user/project',
    gitBranch: 'main',
    worktree: null,
} as SessionMetadataSummary

const activeGoal: GoalStatus = {
    met: false,
    condition: '所有测试通过',
    reason: '尚有 2 个用例失败',
    iterations: 3,
    durationMs: 45000,
    tokens: 1234,
}

const metGoal: GoalStatus = {
    met: true,
    condition: 'lint 零警告',
    reason: 'eslint 输出为空',
}

describe('SessionContextBar', () => {
    // vitest 未开 globals，需显式 cleanup（见 project_web-test-cleanup-explicit）
    afterEach(cleanup)

    it('goal 为 null 时不渲染 chip / 详情', () => {
        render(
            <SessionContextBar
                metadata={metadata}
                goal={null}
                sessionId="s1"
                onClearGoal={vi.fn()}
            />,
            { wrapper },
        )
        expect(screen.queryByText('◎ active')).not.toBeInTheDocument()
        expect(screen.queryByText('✓ 达成')).not.toBeInTheDocument()
        // 吊顶本体仍渲染（path 信息）
        expect(screen.getByText('/home/user/project')).toBeInTheDocument()
    })

    it('active goal（met=false）展示 ◎ active 状态', () => {
        render(
            <SessionContextBar
                metadata={metadata}
                goal={activeGoal}
                sessionId="s1"
                onClearGoal={vi.fn()}
            />,
            { wrapper },
        )
        // 初始 expanded=true → GoalDetail 渲染（含 ◎ active 徽标）
        expect(screen.getByText('◎ active')).toBeInTheDocument()
        expect(screen.getByText('所有测试通过')).toBeInTheDocument()
    })

    it('met goal（met=true）展示 ✓ 达成 状态', () => {
        render(
            <SessionContextBar
                metadata={metadata}
                goal={metGoal}
                sessionId="s1"
                onClearGoal={vi.fn()}
            />,
            { wrapper },
        )
        expect(screen.getByText('✓ 达成')).toBeInTheDocument()
        expect(screen.getByText('lint 零警告')).toBeInTheDocument()
    })

    it('展开态渲染 GoalDetail（evaluator 理由 + 统计），点击吊顶切换收起', () => {
        render(
            <SessionContextBar
                metadata={metadata}
                goal={activeGoal}
                sessionId="s1"
                onClearGoal={vi.fn()}
            />,
            { wrapper },
        )
        // 初始 expanded=true：reason（evaluator 理由）仅 GoalDetail 才有
        expect(screen.getByText(/尚有 2 个用例失败/)).toBeInTheDocument()
        // 统计：轮次 / 耗时 / tokens
        expect(screen.getByText('3')).toBeInTheDocument()
        expect(screen.getByText('45s')).toBeInTheDocument()
        expect(screen.getByText('1234')).toBeInTheDocument()

        // 点击吊顶 → 收起
        fireEvent.click(screen.getByTestId('session-context-bar'))
        // 收起态：reason 与统计不再渲染
        expect(screen.queryByText(/尚有 2 个用例失败/)).not.toBeInTheDocument()
        expect(screen.queryByText('45s')).not.toBeInTheDocument()
        // 但 chip 中的 condition 仍在
        expect(screen.getByText('所有测试通过')).toBeInTheDocument()
    })

    it('收起态再点击恢复展开（DetailPopover 重新出现）', () => {
        render(
            <SessionContextBar
                metadata={metadata}
                goal={activeGoal}
                sessionId="s1"
                onClearGoal={vi.fn()}
            />,
            { wrapper },
        )
        const bar = screen.getByTestId('session-context-bar')
        // 收起
        fireEvent.click(bar)
        expect(screen.queryByText(/尚有 2 个用例失败/)).not.toBeInTheDocument()
        // 重新展开
        fireEvent.click(bar)
        expect(screen.getByText(/尚有 2 个用例失败/)).toBeInTheDocument()
    })

    it('清理按钮透传 sessionId + clearField=goalStatus', () => {
        render(
            <SessionContextBar
                metadata={metadata}
                goal={activeGoal}
                sessionId="s-xyz"
                onClearGoal={vi.fn()}
            />,
            { wrapper },
        )
        const clearBtn = screen.getByTestId('clear-goal-btn')
        expect(clearBtn).toHaveAttribute('data-session', 's-xyz')
        expect(clearBtn).toHaveAttribute('data-field', 'goalStatus')
    })
})
