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
function renderBar(messages: DecryptedMessage[], onEdit = vi.fn()) {
    return render(
        <ConfigProvider>
            <QueuedMessagesBar sessionId="s1" messages={messages} onEdit={onEdit} />
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

    it('点击取消按钮 → cancelMutation.mutate(localId)', () => {
        const onEdit = vi.fn()
        const { container } = renderBar([queuedMsg('q1', '要取消')], onEdit)

        // cancel 按钮（DeleteOutlined → .anticon-delete）
        const cancelBtn = container.querySelector('.anticon-delete')!.closest('button')!
        fireEvent.click(cancelBtn)

        expect(cancelMock.mutate).toHaveBeenCalledTimes(1)
        expect(cancelMock.mutate).toHaveBeenCalledWith('q1')
        // 取消不触发编辑
        expect(onEdit).not.toHaveBeenCalled()
    })

    it('点击编辑 + cancel 返回 cancelled → onEdit(previewText)', () => {
        const onEdit = vi.fn()
        const { container } = renderBar([queuedMsg('q1', '编辑我')], onEdit)

        // edit 按钮（EditOutlined → .anticon-edit）
        const editBtn = container.querySelector('.anticon-edit')!.closest('button')!
        fireEvent.click(editBtn)

        // handleEdit 传 { onSuccess } 给 mutate，提取并手动触发
        expect(cancelMock.mutate).toHaveBeenCalledTimes(1)
        const callArgs = cancelMock.mutate.mock.calls[0]
        expect(callArgs[0]).toBe('q1')
        const opts = callArgs[1] as { onSuccess: (res: { data: { status: string } }) => void }

        // cancel 成功 → 回填文本
        opts.onSuccess({ data: { status: 'cancelled' } })
        expect(onEdit).toHaveBeenCalledWith('编辑我')
    })

    it('点击编辑 + cancel 返回 submitted → 不调 onEdit', () => {
        const onEdit = vi.fn()
        const { container } = renderBar([queuedMsg('q1', '编辑我')], onEdit)

        const editBtn = container.querySelector('.anticon-edit')!.closest('button')!
        fireEvent.click(editBtn)

        const opts = cancelMock.mutate.mock.calls[0][1] as {
            onSuccess: (res: { data: { status: string } }) => void
        }

        // 已被 agent 抢先处理 → 不回填
        opts.onSuccess({ data: { status: 'submitted' } })
        expect(onEdit).not.toHaveBeenCalled()
    })

    it('点击 steer 按钮 → steerMutation.mutate(localId)', () => {
        const onEdit = vi.fn()
        const { container } = renderBar([queuedMsg('q1', '要 steer')], onEdit)

        // steer 按钮（ThunderboltOutlined → .anticon-thunderbolt）
        const steerBtn = container.querySelector('.anticon-thunderbolt')!.closest('button')!
        fireEvent.click(steerBtn)

        expect(steerMock.mutate).toHaveBeenCalledTimes(1)
        expect(steerMock.mutate).toHaveBeenCalledWith('q1', expect.objectContaining({ onError: expect.any(Function) }))
        // steer 不触发取消/编辑
        expect(cancelMock.mutate).not.toHaveBeenCalled()
        expect(onEdit).not.toHaveBeenCalled()
    })
})
