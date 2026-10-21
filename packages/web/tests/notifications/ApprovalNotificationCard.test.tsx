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
import { render, cleanup, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// 会话数据：测试可切换 requests / 错误态（hoisted，避免异步渲染读到旧值）
const sessionState = vi.hoisted(() => ({
    data: null as unknown,
    isError: false,
}))

vi.mock('@/core/data/hooks/queries/useSession', () => ({
    useSession: () => ({ data: sessionState.data, isError: sessionState.isError }),
}))
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({}),
}))
// 审批面板是既有组件，本测试只验证卡片的路由与生命周期编排
vi.mock('@/features/chat/tool-card/PermissionFooter', () => ({
    PermissionFooter: () => <div data-testid="permission-footer" />,
}))
vi.mock('@/features/chat/tool-card/AskUserQuestionFooter', () => ({
    AskUserQuestionFooter: () => <div data-testid="ask-footer" />,
}))
vi.mock('@/features/chat/tool-card/RequestUserInputFooter', () => ({
    RequestUserInputFooter: () => <div data-testid="request-input-footer" />,
}))
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}))

import { ApprovalNotificationCard } from '@/features/chat/notificationApproval/ApprovalNotificationCard'

const ITEM = {
    key: 'permission-s1-1',
    sessionId: 's1',
    requestId: 'r1',
    title: 'Permission Request',
    body: 'Demo (Bash)',
    url: '/sessions/s1',
}

/** 构造带指定请求的 session 桩 */
function sessionWith(requests: Record<string, unknown> | null) {
    return { id: 's1', agentState: { requests } }
}

describe('ApprovalNotificationCard', () => {
    beforeEach(() => {
        sessionState.data = null
        sessionState.isError = false
    })
    afterEach(() => cleanup())

    it('普通工具审批 → 渲染 PermissionFooter（与聊天流同一套审批面板）', () => {
        sessionState.data = sessionWith({ r1: { tool: 'Bash', arguments: { command: 'ls' } } })
        render(<ApprovalNotificationCard item={ITEM} onResolved={vi.fn()} onOpen={vi.fn()} />)

        expect(screen.getByTestId('permission-footer')).toBeInTheDocument()
        expect(screen.getByText('Bash: ls')).toBeInTheDocument()
    })

    it('AskUserQuestion → 渲染问答面板', () => {
        sessionState.data = sessionWith({ r1: { tool: 'AskUserQuestion', arguments: { questions: [] } } })
        render(<ApprovalNotificationCard item={ITEM} onResolved={vi.fn()} onOpen={vi.fn()} />)

        expect(screen.getByTestId('ask-footer')).toBeInTheDocument()
    })

    it('未带 requestId（老 daemon）→ 回退到首条待审批', () => {
        sessionState.data = sessionWith({ r9: { tool: 'Write', arguments: { file_path: '/a.txt' } } })
        render(<ApprovalNotificationCard item={{ ...ITEM, requestId: null }} onResolved={vi.fn()} onOpen={vi.fn()} />)

        expect(screen.getByTestId('permission-footer')).toBeInTheDocument()
    })

    it('请求已在别处处理（session 已加载但请求不在）→ 自动收起通知', () => {
        sessionState.data = sessionWith({})
        const onResolved = vi.fn()
        render(<ApprovalNotificationCard item={ITEM} onResolved={onResolved} onOpen={vi.fn()} />)

        expect(onResolved).toHaveBeenCalled()
    })

    it('elicitation（与会话上下文强绑定）→ 不在通知里重造表单，指引进会话', () => {
        sessionState.data = sessionWith({ r1: { tool: 'mcp_elicitation', arguments: {} } })
        const onOpen = vi.fn()
        render(<ApprovalNotificationCard item={ITEM} onResolved={vi.fn()} onOpen={onOpen} />)

        expect(screen.getByText('notification.openSessionToHandle')).toBeInTheDocument()
        screen.getByText('notification.openSession').click()
        expect(onOpen).toHaveBeenCalled()
    })
})
