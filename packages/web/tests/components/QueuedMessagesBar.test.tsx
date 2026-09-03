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
 * QueuedMessagesBar 组件测试
 * 验证排队消息悬浮条的渲染过滤、取消按钮、编辑回填逻辑
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import type { DecryptedMessage } from '@/core/data/api/types'

// mock useCancelQueuedMessage —— 隔离 mutation，仅验证组件交互
const cancelMock = vi.hoisted(() => ({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined as string | undefined,
}))
vi.mock('@/core/data/hooks/mutations/useCancelQueuedMessage', () => ({
    useCancelQueuedMessage: () => cancelMock,
}))

// mock useSteerQueuedMessage —— 隔离 steer mutation
const steerMock = vi.hoisted(() => ({
    mutate: vi.fn(),
    isPending: false,
    variables: undefined as string | undefined,
}))
vi.mock('@/core/data/hooks/mutations/useSteerQueuedMessage', () => ({
    useSteerQueuedMessage: () => steerMock,
}))

// mock i18n —— key 直接透传，便于按 key 断言
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}))

import { QueuedMessagesBar } from '@/components/chat/QueuedMessagesBar'

/** 构建排队中的 user 消息（lifecycle='queued'） */
function queuedMsg(id: string, text: string, createdAt = 1000): DecryptedMessage {
    return {
        id,
        seq: null,
        localId: id,
        lifecycleAt: null,
        lifecycle: 'queued',
        createdAt,
        content: { role: 'user', content: { type: 'text', text }, meta: { sentFrom: 'webapp' } },
        status: 'queued',
    }
}

/** 构建已被 agent 处理的 user 消息（lifecycleAt!=null） */
function submittedMsg(id: string, text: string): DecryptedMessage {
    return {
        id,
        seq: 1,
        localId: null,
        lifecycleAt: 2000,
        createdAt: 1000,
        content: { role: 'user', content: { type: 'text', text } },
    }
}

/** 构建 user 消息，lifecycle 可指定（cancelled/discarded/done/processing 等终态/中态） */
function lifecycleMsg(id: string, text: string, lifecycle: 'cancelled' | 'discarded' | 'done' | 'processing'): DecryptedMessage {
    return {
        id,
        seq: null,
        localId: id,
        lifecycleAt: 3000,
        lifecycle,
        createdAt: 1000,
        content: { role: 'user', content: { type: 'text', text }, meta: { sentFrom: 'webapp' } },
        status: 'sent',
    }
}

/** 构建 agent 消息 */
function agentMsg(id: string, text: string): DecryptedMessage {
    return {
        id,
        seq: 2,
        localId: null,
        lifecycleAt: 2000,
        createdAt: 1000,
        content: { role: 'agent', content: { type: 'text', text } },
    }
}

/** 包裹 ConfigProvider 渲染 */
function renderBar(messages: DecryptedMessage[]) {
    return render(
        <ConfigProvider>
            <QueuedMessagesBar sessionId="s1" messages={messages} />
        </ConfigProvider>,
    )
}

describe('QueuedMessagesBar', () => {
    beforeAll(() => {
        // antd Tooltip/Button 在 jsdom 中需要 ResizeObserver
        vi.stubGlobal('ResizeObserver', class {
            observe() {}
            unobserve() {}
            disconnect() {}
        })
    })

    beforeEach(() => {
        cancelMock.mutate.mockReset()
        cancelMock.isPending = false
        cancelMock.variables = undefined
        steerMock.mutate.mockReset()
        steerMock.isPending = false
        steerMock.variables = undefined
    })

    afterEach(() => cleanup())

    it('无排队消息时渲染 null', () => {
        const { container } = renderBar([])
        expect(container.textContent).toBe('')
    })

    it('仅有已 invoke 的 user 消息时也渲染 null', () => {
        const { container } = renderBar([submittedMsg('m1', '已处理')])
        expect(container.textContent).toBe('')
    })

    it('仅有 agent 消息时也渲染 null', () => {
        const { container } = renderBar([agentMsg('a1', 'agent 回复')])
        expect(container.textContent).toBe('')
    })

    it('有排队消息时渲染标题与每条预览文本', () => {
        const { getByText } = renderBar([
            queuedMsg('q1', '第一条排队'),
            queuedMsg('q2', '第二条排队'),
        ])

        // 标题（i18n key 透传）
        expect(getByText('chat.queued.title')).toBeInTheDocument()
        // 每条预览文本
        expect(getByText('第一条排队')).toBeInTheDocument()
        expect(getByText('第二条排队')).toBeInTheDocument()
    })

    it('带附件的排队消息预览显示占位标签（summarizeBlocks 单源；i18n mock 透传 key）', () => {
        const withAttachment: DecryptedMessage = {
            ...queuedMsg('q1', ''),
            content: {
                role: 'user',
                content: {
                    type: 'text',
                    text: '看这个',
                    attachments: [{ id: 'a1', filename: 'a.pdf', mimeType: 'application/pdf', size: 1, path: '/up/a.pdf' }],
                },
                meta: { sentFrom: 'webapp' },
            },
        }
        const { getByText } = renderBar([withAttachment])

        // text 原文 + document 占位（t mock 返回 key 本身）
        expect(getByText('看这个 chat.summary.file')).toBeInTheDocument()
    })

    it('排队消息与已 invoke 消息混合时只展示排队项', () => {
        const { getByText, queryByText } = renderBar([
            queuedMsg('q1', '排队中'),
            submittedMsg('i1', '已处理'),
            agentMsg('a1', 'agent 回复'),
        ])

        expect(getByText('排队中')).toBeInTheDocument()
        // 已 invoke / agent 的文本不出现
        expect(queryByText('已处理')).toBeNull()
        expect(queryByText('agent 回复')).toBeNull()
    })

    it('点击取消按钮 → cancelMutation.mutate({ localId })（纯取消无回填载荷）', () => {
        const { container } = renderBar([queuedMsg('q1', '要取消')])

        // cancel 按钮（DeleteOutlined → .anticon-delete）
        const cancelBtn = container.querySelector('.anticon-delete')!.closest('button')!
        fireEvent.click(cancelBtn)

        expect(cancelMock.mutate).toHaveBeenCalledTimes(1)
        expect(cancelMock.mutate).toHaveBeenCalledWith({ localId: 'q1' })
    })

    it('点击编辑 → mutate 携带回填载荷（纯文本消息还原为仅 text 段）', () => {
        const { container } = renderBar([queuedMsg('q1', '编辑我')])

        // edit 按钮（EditOutlined → .anticon-edit）
        const editBtn = container.querySelector('.anticon-edit')!.closest('button')!
        fireEvent.click(editBtn)

        // 回填载荷随 variables 进 hook，由钩子级回调写信箱（卸载竞态安全，见 hook 测试）
        expect(cancelMock.mutate).toHaveBeenCalledTimes(1)
        expect(cancelMock.mutate).toHaveBeenCalledWith({
            localId: 'q1',
            backfill: { segments: { text: '编辑我', files: [], images: [], quotes: [] }, originalText: null },
        })
    })

    it('带附件/引用的排队消息编辑 → backfill 载荷含 files/images/quotes 完整分段（回填往返集成）', () => {
        const structured: DecryptedMessage = {
            ...queuedMsg('q1', ''),
            content: {
                role: 'user',
                content: [
                    { type: 'quote', messageId: 'm9', role: 'agent', excerpt: '被引用的消息' },
                    {
                        type: 'document',
                        source: { type: 'url', value: '/up/report.pdf', mimeType: 'application/pdf' },
                        id: 'd1', filename: 'report.pdf', size: 123,
                    },
                    {
                        type: 'image',
                        source: { type: 'url', value: '/up/pic.png', mimeType: 'image/png' },
                        id: 'g1', filename: 'pic.png', size: 456,
                    },
                    { type: 'text', text: '看这两份材料' },
                ],
                meta: { sentFrom: 'webapp' },
            },
        } as unknown as DecryptedMessage
        const { container } = renderBar([structured])

        fireEvent.click(container.querySelector('.anticon-edit')!.closest('button')!)

        expect(cancelMock.mutate).toHaveBeenCalledWith({
            localId: 'q1',
            backfill: {
                segments: {
                    text: '看这两份材料',
                    files: [{ id: 'd1', filename: 'report.pdf', path: '/up/report.pdf', mimeType: 'application/pdf', size: 123 }],
                    images: [{ id: 'g1', filename: 'pic.png', path: '/up/pic.png', mimeType: 'image/png', size: 456 }],
                    quotes: [{ messageId: 'm9', role: 'agent', excerpt: '被引用的消息' }],
                },
                originalText: null,
            },
        })
    })

    it('cancelled/discarded 终态消息不渲染（丢弃分区已移除，终态可见性由聊天流内标注承担）', () => {
        const { container, getByText, queryByText } = renderBar([
            queuedMsg('q1', '还在排队'),
            lifecycleMsg('c1', '被连坐取消', 'cancelled'),
            lifecycleMsg('d1', '被显式丢弃', 'discarded'),
        ])

        // 排队分区原样保留（含 3 个操作按钮）
        expect(getByText('chat.queued.title')).toBeInTheDocument()
        expect(getByText('还在排队')).toBeInTheDocument()
        expect(container.querySelectorAll('button').length).toBe(3)
        // 终态消息不出现：无文本、无丢弃分区标题
        expect(queryByText('被连坐取消')).toBeNull()
        expect(queryByText('被显式丢弃')).toBeNull()
        expect(container.textContent).not.toContain('chat.queued.discardedTitle')
    })

    it('queued 空而只有终态消息 → Bar 渲染 null', () => {
        const { container } = renderBar([lifecycleMsg('d1', '唯一丢弃', 'discarded')])
        expect(container.textContent).toBe('')
    })

    it('done/processing 不进悬浮条也不进丢弃分区', () => {
        const { container } = renderBar([
            lifecycleMsg('p1', '处理中消息', 'processing'),
            lifecycleMsg('f1', '已完成消息', 'done'),
        ])

        expect(container.textContent).toBe('')
    })

    it('点击 steer 按钮 → steerMutation.mutate(localId)', () => {
        const { container } = renderBar([queuedMsg('q1', '要 steer')])

        // steer 按钮（ThunderboltOutlined → .anticon-thunderbolt）
        const steerBtn = container.querySelector('.anticon-thunderbolt')!.closest('button')!
        fireEvent.click(steerBtn)

        expect(steerMock.mutate).toHaveBeenCalledTimes(1)
        expect(steerMock.mutate).toHaveBeenCalledWith('q1', expect.objectContaining({ onError: expect.any(Function) }))
        // steer 不触发取消
        expect(cancelMock.mutate).not.toHaveBeenCalled()
    })
})
