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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { Session } from '@/core/data/api/types'

// ---- 受控 useRecentSessions 状态（可变对象便于单测切换场景） ----

const recentState = vi.hoisted(() => ({
    current: {} as Record<string, unknown>,
}))

vi.mock('@/core/data/hooks/queries/useRecentSessions', () => ({
    useRecentSessions: () => recentState.current,
}))

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
}))

import { MobileRecentGroup } from '@/components/layout/MobileRecentGroup'

function makeSession(id: string, overrides: Partial<Session> = {}): Session {
    return {
        id,
        namespace: 'ns',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: false,
        activeAt: 1,
        metadata: null,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        running: false,
        runningAt: 1,
        ...overrides,
    } as Session
}

/** 生成完整 hook 返回值（缺字段会解构出 undefined 影响行为） */
function makeHookState(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        sessions: [] as Session[],
        visibleSessions: [] as Session[],
        expanded: false,
        toggleExpanded: vi.fn(),
        isLoadingInitial: false,
        isLoadingMore: false,
        showCollapse: false,
        canShowMore: false,
        remainingCount: 0,
        showMore: vi.fn(),
        collapse: vi.fn(),
        ...overrides,
    }
}

// vitest 未开 globals：渲染型测试必须显式 cleanup，否则 DOM 累积致 getBy* 多元素报错——项目已知坑
afterEach(cleanup)

describe('MobileRecentGroup（平级「最近」分区）', () => {
    beforeEach(() => {
        recentState.current = makeHookState()
    })

    it('有会话时渲染分区标题与会话行，默认展开', () => {
        const s1 = makeSession('r1')
        recentState.current = makeHookState({
            sessions: [s1], visibleSessions: [s1], expanded: true,
        })

        render(
            <MobileRecentGroup
                activeSessionId={undefined}
                onSessionAction={vi.fn()}
                onCloseMenu={vi.fn()}
            />
        )

        expect(screen.getByText('nav.recent')).toBeInTheDocument()
        expect(screen.getByText('r1')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /nav.recent/ })).toHaveAttribute('aria-expanded', 'true')
    })

    it('空分区 → 分区头仍渲染，默认收起（aria-expanded=false）', () => {
        render(
            <MobileRecentGroup
                activeSessionId={undefined}
                onSessionAction={vi.fn()}
                onCloseMenu={vi.fn()}
            />
        )
        expect(screen.getByText('nav.recent')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /nav.recent/ })).toHaveAttribute('aria-expanded', 'false')
    })

    it('加载中 → 不隐藏（避免闪烁），跟随空分区默认收起', () => {
        recentState.current = makeHookState({ isLoadingInitial: true })

        render(
            <MobileRecentGroup
                activeSessionId={undefined}
                onSessionAction={vi.fn()}
                onCloseMenu={vi.fn()}
            />
        )
        expect(screen.getByText('nav.recent')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /nav.recent/ })).toHaveAttribute('aria-expanded', 'false')
    })

    it('点击分区标题行 → toggleExpanded', () => {
        const toggleExpanded = vi.fn()
        const s1 = makeSession('r1')
        recentState.current = makeHookState({
            sessions: [s1], visibleSessions: [s1], toggleExpanded,
        })

        render(
            <MobileRecentGroup
                activeSessionId={undefined}
                onSessionAction={vi.fn()}
                onCloseMenu={vi.fn()}
            />
        )

        fireEvent.click(screen.getByText('nav.recent'))
        expect(toggleExpanded).toHaveBeenCalledTimes(1)
    })

    it('新建会话按钮点击不冒泡触发折叠', () => {
        const toggleExpanded = vi.fn()
        const s1 = makeSession('r1')
        recentState.current = makeHookState({
            sessions: [s1], visibleSessions: [s1], toggleExpanded,
        })

        render(
            <MobileRecentGroup
                activeSessionId={undefined}
                onSessionAction={vi.fn()}
                onCloseMenu={vi.fn()}
            />
        )

        fireEvent.click(screen.getByLabelText('nav.newSessionUnassigned'))
        expect(toggleExpanded).not.toHaveBeenCalled()
    })
})
