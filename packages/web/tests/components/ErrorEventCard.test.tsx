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
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import type { ReactNode } from 'react'
import type { ErrorContext, ErrorCategory, NormalizedErrorEvent } from '@mobi/shared'
import { ErrorEventCard } from '@/features/chat/blocks/ErrorEventCard'

vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string, params?: Record<string, unknown>) => params ? `${key}|${JSON.stringify(params)}` : key,
    }),
}))

const wrapper = ({ children }: { children: ReactNode }) => <ConfigProvider>{children}</ConfigProvider>

const OPEN: ErrorContext = {
    canRewind: true,
    canSend: true,
    sessionState: 'active',
    hasFallbackModel: true,
    hasWorkspace: true,
    turnHasAssistantOutput: false,
}

function makeEvent(category: ErrorCategory, overrides: Partial<NormalizedErrorEvent> = {}): NormalizedErrorEvent {
    return {
        attempt: 0,
        maxRetries: 0,
        message: 'raw message',
        isNetworkDown: false,
        category,
        evidence: { matchedBy: 'text', value: 'x' },
        raw: { message: 'raw message', status: 500 },
        ...overrides,
    }
}

afterEach(cleanup)

describe('ErrorEventCard', () => {
    it('上下文满（可回退）：压缩为主按钮，点按派发动作', () => {
        const onAction = vi.fn()
        render(<ErrorEventCard event={makeEvent('context_length')} context={OPEN} onAction={onAction} />, { wrapper })
        expect(screen.getByText('chat.error.title.context_length')).toBeInTheDocument()
        expect(screen.getByText('chat.error.body.context_length')).toBeInTheDocument()
        fireEvent.click(screen.getByText('chat.error.action.compact'))
        expect(onAction).toHaveBeenCalledWith('compact')
    })

    it('压缩进行中：退化为进行态占位', () => {
        render(
            <ErrorEventCard
                event={makeEvent('context_length')}
                context={{ ...OPEN, compact: { pending: true, tried: false } }}
                onAction={() => {}}
            />,
            { wrapper },
        )
        expect(screen.getByText('chat.error.compacting')).toBeInTheDocument()
        expect(screen.queryByText('chat.error.title.context_length')).toBeNull()
        expect(screen.queryByText('chat.error.action.compact')).toBeNull()
    })

    it('不可回退：去掉回退按钮并展示附加说明', () => {
        render(<ErrorEventCard event={makeEvent('context_length')} context={{ ...OPEN, canRewind: false }} onAction={() => {}} />, { wrapper })
        expect(screen.queryByText('chat.error.action.rewind')).toBeNull()
        expect(screen.getByText('chat.error.note.rewindUnavailable')).toBeInTheDocument()
    })

    it('额度耗尽：展示重置时间与尝试次数', () => {
        const event = makeEvent('quota_exhausted', {
            attempt: 2,
            maxRetries: 5,
            message: 'Usage limit reached. Your limit will reset at 2026-10-21T00:00:00Z.',
        })
        render(<ErrorEventCard event={event} context={OPEN} onAction={() => {}} />, { wrapper })
        expect(screen.getByText('chat.error.attempt|{"attempt":2,"maxRetries":5}')).toBeInTheDocument()
        expect(screen.getByText(/chat\.error\.resetAt/)).toBeInTheDocument()
        // keep 策略：原文直接可见
        expect(screen.getAllByText(/Usage limit reached/).length).toBeGreaterThan(0)
    })

    it('详情展开：显示原始错误与请求 ID', () => {
        const event = makeEvent('invalid_request', {
            message: 'bad request',
            raw: { message: 'bad request', requestId: 'req_011CUxAbCdEf123456' },
        })
        render(<ErrorEventCard event={event} context={OPEN} onAction={() => {}} />, { wrapper })
        expect(screen.queryByText(/req_011CUxAbCdEf123456/)).toBeNull()
        fireEvent.click(screen.getByText('chat.error.details'))
        expect(screen.getAllByText(/req_011CUxAbCdEf123456/).length).toBeGreaterThan(0)
        expect(screen.getAllByText(/bad request/).length).toBeGreaterThan(0)
        expect(screen.getByText('chat.error.copyRaw')).toBeInTheDocument()
    })

    it('重试倒计时：未到点显示，已成历史则隐藏', () => {
        const event = makeEvent('rate_limit', { retryInMs: 38000 })
        const { unmount } = render(
            <ErrorEventCard event={event} context={OPEN} createdAt={Date.now()} />,
            { wrapper },
        )
        expect(screen.getByText(/chat\.error\.retryIn/)).toBeInTheDocument()
        unmount()

        render(
            <ErrorEventCard event={event} context={OPEN} createdAt={Date.now() - 60000} />,
            { wrapper },
        )
        expect(screen.queryByText(/chat\.error\.retryIn/)).toBeNull()
    })

    it('已存在助手产出的轮次不给重试（重发会重跑整轮）', () => {
        render(
            <ErrorEventCard
                event={makeEvent('rate_limit')}
                context={{ ...OPEN, turnHasAssistantOutput: true }}
                onAction={() => {}}
            />,
            { wrapper },
        )
        expect(screen.queryByText('chat.error.action.retry')).toBeNull()
    })

    it('压缩状态翻转（占位 ↔ 卡片）不改变 hook 数量', () => {
        const event = makeEvent('context_length')
        const { rerender } = render(
            <ErrorEventCard event={event} context={{ ...OPEN, compact: { pending: true, tried: false } }} onAction={() => {}} />,
            { wrapper },
        )
        expect(screen.getByText('chat.error.compacting')).toBeInTheDocument()
        rerender(
            <ErrorEventCard event={event} context={{ ...OPEN, compact: { pending: false, tried: true } }} onAction={() => {}} />,
        )
        expect(screen.getByText('chat.error.title.context_length')).toBeInTheDocument()
    })

    it('鉴权类：展示重新登录指引', () => {
        render(<ErrorEventCard event={makeEvent('auth')} context={OPEN} onAction={() => {}} />, { wrapper })
        expect(screen.getByText('chat.error.reauthHint')).toBeInTheDocument()
    })

    it('每个动作按钮都派发对应的 action', () => {
        const cases: Array<{ event: NormalizedErrorEvent; context?: Partial<ErrorContext>; label: string; action: string }> = [
            { event: makeEvent('rate_limit'), label: 'chat.error.action.retry', action: 'retry' },
            { event: makeEvent('context_length'), label: 'chat.error.action.rewind', action: 'rewind' },
            { event: makeEvent('context_length'), label: 'chat.error.action.newSession', action: 'newSession' },
            { event: makeEvent('model_not_found'), label: 'chat.error.action.switchModel', action: 'switchModel' },
            { event: makeEvent('auth'), label: 'chat.error.action.reauth', action: 'reauth' },
            { event: makeEvent('quota_exhausted'), context: { sessionState: 'dormant' }, label: 'chat.error.action.resume', action: 'resume' },
        ]
        for (const c of cases) {
            const onAction = vi.fn()
            const { unmount } = render(
                <ErrorEventCard event={c.event} context={{ ...OPEN, ...c.context }} onAction={onAction} />,
                { wrapper },
            )
            fireEvent.click(screen.getByText(c.label))
            expect(onAction).toHaveBeenCalledWith(c.action)
            unmount()
        }
    })

    it('只读渲染（无上下文）不出现动作按钮', () => {
        render(<ErrorEventCard event={makeEvent('server_error')} />, { wrapper })
        expect(screen.getByText('chat.error.title.server_error')).toBeInTheDocument()
        expect(screen.queryByText('chat.error.action.retry')).toBeNull()
        expect(screen.getByText('chat.error.details')).toBeInTheDocument()
    })
})
