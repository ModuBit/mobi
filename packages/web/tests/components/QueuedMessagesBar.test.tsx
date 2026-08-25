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
import { useDiscardedDismissStore, __resetDiscardedDismissStoreForTest } from '@/core/data/stores/discardedDismissStore'

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
        // 清除记录 store 用例间隔离
        __resetDiscardedDismissStoreForTest()
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

    it('cancelled/discarded 消息渲染灰色丢弃分区：删除线 + 状态词，无操作按钮', () => {
        const { container, getByText } = renderBar([
            queuedMsg('q1', '还在排队'),
            lifecycleMsg('c1', '被连坐取消', 'cancelled'),
            lifecycleMsg('d1', '被显式丢弃', 'discarded'),
        ])

        // 排队分区标题仍在
        expect(getByText('chat.queued.title')).toBeInTheDocument()
        // 丢弃分区标题出现
        expect(getByText('chat.queued.discardedTitle')).toBeInTheDocument()
        // 两条丢弃消息文本带删除线
        const cancelledText = getByText('被连坐取消')
        expect(cancelledText.style.textDecoration).toContain('line-through')
        const discardedText = getByText('被显式丢弃')
        expect(discardedText.style.textDecoration).toContain('line-through')
        // 状态词
        expect(getByText('chat.queued.stateCancelled')).toBeInTheDocument()
        expect(getByText('chat.queued.stateDiscarded')).toBeInTheDocument()
        // 排队条目操作按钮（steer/edit/cancel）3 个 + 丢弃分区标题行的清除按钮 1 个——共 4
        expect(container.querySelectorAll('button').length).toBe(4)
        expect(container.querySelectorAll('.anticon-thunderbolt').length).toBe(1)
        expect(container.querySelectorAll('.anticon-close').length).toBe(1)
    })

    it('点击丢弃分区清除按钮 → 分区消失（UI 态记录），排队分区不受影响', () => {
        const { container, getByText } = renderBar([
            queuedMsg('q1', '还在排队'),
            lifecycleMsg('d1', '被显式丢弃', 'discarded'),
        ])

        // 清除前：丢弃消息可见
        expect(getByText('被显式丢弃')).toBeInTheDocument()

        const dismissBtn = container.querySelector('.anticon-close')!.closest('button')!
        fireEvent.click(dismissBtn)

        // 清除后：丢弃分区整体消失（标题 + 条目），排队分区原样保留
        expect(container.textContent).not.toContain('chat.queued.discardedTitle')
        expect(container.textContent).not.toContain('被显式丢弃')
        expect(getByText('chat.queued.title')).toBeInTheDocument()
        expect(getByText('还在排队')).toBeInTheDocument()
    })

    it('清除后新到达的丢弃消息仍展示（id 粒度，不因「全部清除」错过新终态）', () => {
        const { container, rerender } = renderBar([lifecycleMsg('d1', '旧的丢弃', 'discarded')])
        fireEvent.click(container.querySelector('.anticon-close')!.closest('button')!)
        expect(container.textContent).not.toContain('旧的丢弃')

        // 新 turn 死亡连坐的新丢弃消息（id 不在清除集合）照常展示
        rerender(
            <ConfigProvider>
                <QueuedMessagesBar sessionId="s1" messages={[
                    lifecycleMsg('d1', '旧的丢弃', 'discarded'),
                    lifecycleMsg('c2', '新的连坐', 'cancelled'),
                ]} onEdit={vi.fn()} />
            </ConfigProvider>,
        )
        expect(container.textContent).not.toContain('旧的丢弃')
        expect(container.textContent).toContain('新的连坐')
    })

    it('清除记录 per-session 隔离：另一会话的丢弃消息不受影响', () => {
        const { container } = render(
            <ConfigProvider>
                <QueuedMessagesBar sessionId="other-session" messages={[lifecycleMsg('d1', '会话B的丢弃', 'discarded')]} onEdit={vi.fn()} />
            </ConfigProvider>,
        )
        // 先在 s1 会话清除同一 id
        useDiscardedDismissStore.getState().dismiss('s1', ['d1'])

        expect(container.textContent).toContain('会话B的丢弃')
    })

    it('queued 空而 discarded 有 → Bar 仍渲染（不返回 null）', () => {
        const { container, getByText } = renderBar([lifecycleMsg('d1', '唯一丢弃', 'discarded')])

        // 排队分区标题不出现，丢弃分区标题在，Bar 非 null
        expect(container.textContent).not.toBe('')
        expect(container.querySelector('span')?.textContent).not.toContain('chat.queued.title')
        expect(getByText('chat.queued.discardedTitle')).toBeInTheDocument()
        expect(getByText('唯一丢弃')).toBeInTheDocument()
    })

    it('done/processing 不进悬浮条也不进丢弃分区', () => {
        const { container } = renderBar([
            lifecycleMsg('p1', '处理中消息', 'processing'),
            lifecycleMsg('f1', '已完成消息', 'done'),
        ])

        expect(container.textContent).toBe('')
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
