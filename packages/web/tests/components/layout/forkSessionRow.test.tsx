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

/**
 * fork 会话行测试（fork-session spec §4.3）：
 * 待激活/错误态徽标、自动命名「〈parent 标题〉 · 分叉」（parent 实时取，已删降级）、
 * 待激活行可删除（deleteSession active 守卫的 web 侧呈现：fork 行未激活不算 active）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Session } from '@/core/data/api/types'

// i18n mock：fork 相关 key 做真实插值，其余透传 key（对齐既有测试惯例）
vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string) => {
                if (key === 'session.fork.forkName') return '父会话 · 分叉'
                if (key === 'session.fork.pendingFallback') return '分叉会话'
                if (key === 'session.fork.errorReason.anchorInvalidated') return '父会话已回退，分叉点失效'
                if (key === 'session.fork.errorReason.unknown') return '分叉激活失败'
                return key
            },
        }),
    }
})

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    useParams: () => ({}),
}))

// ============ useMobiApi mock（必须返回稳定引用，否则 effect 无限循环 OOM——项目已知坑） ============

const sessionsGet = vi.hoisted(() => vi.fn())
const mockApi = {
    sessions: { get: sessionsGet },
    visibility: { report: vi.fn().mockResolvedValue(undefined) },
}
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => mockApi,
}))

import { resolveForkSessionState, resolveForkErrorText } from '@/components/layout/forkSessionLabel'
import { SessionRow } from '@/components/layout/SessionRow'
import { MobileSessionItem } from '@/components/layout/MobileSessionItem'

afterEach(cleanup)

beforeEach(() => {
    // mock 调用历史跨用例共享（模块级 vi.fn），逐用例清空保证「未发起查询」断言干净
    sessionsGet.mockClear()
})

const tStub = (key: string) =>
    key === 'session.fork.errorReason.anchorInvalidated' ? '父会话已回退，分叉点失效' : key

function makeSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'fork-1',
        namespace: 'ns',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: false,
        activeAt: 1,
        metadata: {
            path: '/tmp/p',
            host: 'h',
            forkFrom: { parentSessionId: 'parent-1', parentNativeId: 'pn-1', anchorNativeId: 'an-1' },
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        running: false,
        runningAt: 1,
        ...overrides,
    } as Session
}

function renderRow(ui: React.ReactElement): ReturnType<typeof render> {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('resolveForkSessionState（纯函数）', () => {
    it('非 fork 行：无徽标状态', () => {
        const state = resolveForkSessionState(makeSession({ metadata: { path: '/p', host: 'h' } }), tStub)
        expect(state.isForkRow).toBe(false)
        expect(state.isPendingActivation).toBe(false)
    })

    it('forkFrom 在场 → 待激活；forkError 在场 → 错误态并映射文案', () => {
        const pending = resolveForkSessionState(makeSession(), tStub)
        expect(pending).toMatchObject({ isForkRow: true, isPendingActivation: true, isActivationFailed: false, errorText: null })

        const failed = resolveForkSessionState(makeSession({
            metadata: {
                path: '/p', host: 'h',
                forkFrom: { parentSessionId: 'parent-1', parentNativeId: 'pn', anchorNativeId: 'an' },
                forkError: { code: 'anchor-invalidated', at: 1 },
            },
        }) as Session, tStub)
        expect(failed).toMatchObject({ isForkRow: true, isPendingActivation: false, isActivationFailed: true })
        expect(failed.errorText).toBe('父会话已回退，分叉点失效')

        // 未知 code 回退通用文案
        const text = resolveForkErrorText({ code: 'some-future-code', at: 1 }, tStub)
        expect(text).toBe('session.fork.errorReason.unknown')
    })
})

describe('SessionRow fork 行', () => {
    const baseProps = {
        active: false,
        isRenaming: false,
        renameValue: '',
        onRenameValueChange: vi.fn(),
        onRenameConfirm: vi.fn(),
        onRenameCancel: vi.fn(),
        onRenameLoading: false,
        onClick: vi.fn(),
        onRename: vi.fn(),
        onArchive: vi.fn(),
        onResume: vi.fn(),
        onTogglePin: vi.fn(),
        pinLoading: false,
    }

    it('待激活行：显示「〈parent 标题〉 · 分叉」+ 待激活徽标，删除按钮可用（未激活不算 active）', async () => {
        sessionsGet.mockResolvedValue({
            data: { session: { id: 'parent-1', metadata: { path: '/p', host: 'h', name: '父会话' } } },
        })
        const onDelete = vi.fn()
        renderRow(
            <SessionRow {...baseProps} session={makeSession()} onDelete={onDelete} />,
        )

        expect(await screen.findByText('父会话 · 分叉')).toBeInTheDocument()
        expect(screen.getByTestId('fork-state-badge-pending')).toBeInTheDocument()
        expect(screen.queryByTestId('fork-state-badge-error')).toBeNull()

        // 删除守卫的 web 侧呈现：待激活 fork 行删除按钮不 disabled，点击触发 onDelete
        const deleteBtn = screen.getByTitle('session.actions.delete')
        expect(deleteBtn).not.toBeDisabled()
        fireEvent.click(deleteBtn)
        expect(onDelete).toHaveBeenCalledTimes(1)
    })

    it('parent 已删（404）→ 标题降级「分叉会话」', async () => {
        sessionsGet.mockRejectedValue(new Error('Session not found'))
        renderRow(<SessionRow {...baseProps} session={makeSession()} onDelete={vi.fn()} />)
        expect(await screen.findByText('分叉会话')).toBeInTheDocument()
    })

    it('激活失败行：错误徽标（tooltip 映射文案），无待激活徽标', async () => {
        sessionsGet.mockResolvedValue({
            data: { session: { id: 'parent-1', metadata: { path: '/p', host: 'h', name: '父会话' } } },
        })
        renderRow(
            <SessionRow
                {...baseProps}
                session={makeSession({
                    metadata: {
                        path: '/p', host: 'h',
                        forkFrom: { parentSessionId: 'parent-1', parentNativeId: 'pn', anchorNativeId: 'an' },
                        forkError: { code: 'anchor-invalidated', at: 1 },
                    },
                }) as Session}
                onDelete={vi.fn()}
            />,
        )
        expect(await screen.findByTestId('fork-state-badge-error')).toBeInTheDocument()
        expect(screen.queryByTestId('fork-state-badge-pending')).toBeNull()
    })

    it('非 fork 行：常规命名，无徽标', () => {
        sessionsGet.mockResolvedValue({ data: { session: null } })
        renderRow(
            <SessionRow
                {...baseProps}
                session={makeSession({ id: 'normal-1', metadata: { path: '/p', host: 'h', name: '普通会话' } })}
                onDelete={vi.fn()}
            />,
        )
        expect(screen.getByText('普通会话')).toBeInTheDocument()
        expect(screen.queryByTestId(/^fork-state-badge/)).toBeNull()
        // 非 fork 行不发起 parent 查询
        expect(sessionsGet).not.toHaveBeenCalled()
    })
})

describe('MobileSessionItem fork 行', () => {
    it('待激活行：命名 + 待激活徽标', async () => {
        sessionsGet.mockResolvedValue({
            data: { session: { id: 'parent-1', metadata: { path: '/p', host: 'h', name: '父会话' } } },
        })
        renderRow(
            <MobileSessionItem session={makeSession()} active={false} onClick={vi.fn()} onLongPress={vi.fn()} />,
        )
        expect(await screen.findByText('父会话 · 分叉')).toBeInTheDocument()
        expect(screen.getByTestId('fork-state-badge-pending')).toBeInTheDocument()
    })
})
