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
import { AgentTurnActions } from '@/components/chat/AgentTurnActions'
import { ForkConfirmView } from '@/components/chat/ForkConfirmView'
import { MessageActionsDrawer } from '@/components/chat/MessageActionsDrawer'

// mock i18next：提供 fork 相关文案映射（initReactI18next 必须 noop 导出，避免 i18n 顶层 init 报错）
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string) => {
            const map: Record<string, string> = {
                'chat.fork.title': '从此分叉',
                'chat.fork.notice': '分叉将创建一个新会话，当前会话保持不变',
                'chat.fork.targetLabel': '分叉自这条回复',
                'chat.fork.create': '创建分叉会话',
                'chat.fork.createDesc': '复制此前的对话历史，可立即输入新方向',
                'chat.copy': '复制',
                'chat.rewind.title': '回退并编辑',
                'chat.rewind.notice': '此消息之后的所有对话将被移除',
                'chat.rewind.targetLabel': '回退至此',
                'chat.rewind.restoreAndRewind': '恢复代码并回退',
                'chat.rewind.restoreDesc': '将工作目录文件回滚到此刻的快照',
                'chat.rewind.rewindOnly': '仅回退对话',
                'chat.rewind.rewindOnlyDesc': '代码保持现状，仅重写后续对话',
                'common.cancel': '取消',
            }
            return map[key] ?? key
        },
    }),
}))

// jsdom 无 ResizeObserver，antd Popover（rc-resize-observer）依赖它测量触发元素
const origRO = globalThis.ResizeObserver
class FakeRO {
    observe() {}
    unobserve() {}
    disconnect() {}
}
beforeEach(() => {
    globalThis.ResizeObserver = FakeRO as unknown as typeof ResizeObserver
})

// 渲染型测试显式 cleanup（vitest 未开 globals，DOM 累积会炸）
afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    globalThis.ResizeObserver = origRO
})

describe('AgentTurnActions（turn-result 概要行操作组：[复制][⑂]）', () => {
    it('操作组两项都挂 msg-copy-btn（hover 显示模式）；无时间戳（时间以概要行为唯一来源）', () => {
        const { container } = render(
            <AgentTurnActions text="reply" onFork={vi.fn()} />,
        )
        const root = container.firstElementChild as HTMLElement
        const children = Array.from(root.children) as HTMLElement[]
        expect(children.length).toBe(2)
        expect(children[0].className).toContain('msg-copy-btn')
        expect(children[1].className).toContain('msg-copy-btn')
        expect(root.textContent).not.toMatch(/\d{2}:\d{2}/)
    })

    it('点 ⑂ → 触发 onFork（父组件置 forkOpen 打开 Popover）', () => {
        const onFork = vi.fn()
        render(<AgentTurnActions text="reply" onFork={onFork} />)
        fireEvent.click(screen.getByRole('button', { name: '从此分叉' }))
        expect(onFork).toHaveBeenCalledTimes(1)
    })

    it('forkOpen → Popover 渲染确认视图（警示条 + 目标预览 + 创建选项 + 取消）', () => {
        const onForkConfirm = vi.fn()
        render(
            <AgentTurnActions
                text="reply" onFork={vi.fn()}
                forkOpen forkTargetText="已完成重构" forkLoading={false}
                onForkConfirm={onForkConfirm} onForkCancel={vi.fn()}
            />,
        )
        expect(screen.getByText('分叉自这条回复')).toBeTruthy()
        expect(screen.getByText('已完成重构')).toBeTruthy()
        expect(screen.getByRole('button', { name: '创建分叉会话' })).toBeTruthy()
        expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
    })

    it('forkOpen 确认 → onForkConfirm；forkOpen 时点 ⑂ 不再触发 onFork', () => {
        const onFork = vi.fn()
        const onForkConfirm = vi.fn()
        render(
            <AgentTurnActions
                text="reply" onFork={onFork}
                forkOpen forkTargetText="done" forkLoading={false}
                onForkConfirm={onForkConfirm} onForkCancel={vi.fn()}
            />,
        )
        fireEvent.click(screen.getByRole('button', { name: '创建分叉会话' }))
        expect(onForkConfirm).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByRole('button', { name: '从此分叉' }))
        expect(onFork).toHaveBeenCalledTimes(0)
    })

    it('forkOpen=false → 不渲染确认内容', () => {
        render(<AgentTurnActions text="reply" onFork={vi.fn()} />)
        expect(screen.queryByRole('button', { name: '创建分叉会话' })).toBeNull()
    })

    it('showFork=false（turn 不可 fork）→ 隐藏 ⑂ 但保留复制', () => {
        const onFork = vi.fn()
        const { container } = render(
            <AgentTurnActions text="reply" showFork={false} onFork={onFork} />,
        )
        expect(screen.queryByRole('button', { name: '从此分叉' })).toBeNull()
        // 复制按钮仍在（操作组只剩 copy 一项）
        const children = Array.from((container.firstElementChild as HTMLElement).children) as HTMLElement[]
        expect(children.length).toBe(1)
        expect(children[0].className).toContain('msg-copy-btn')
        expect(onFork).not.toHaveBeenCalled()
    })
})

describe('ForkConfirmView（共用确认视图，PC Popover 与移动 Drawer）', () => {
    it('警示条 + 目标预览卡（截断）+ 创建选项卡 + 取消', () => {
        const onConfirm = vi.fn()
        const onCancel = vi.fn()
        render(<ForkConfirmView targetText={'x'.repeat(200)} loading={false} onConfirm={onConfirm} onCancel={onCancel} />)
        // 截断预览：80 字符 + 省略号（复用 truncateRewindPreview 口径）
        expect(screen.getByText(`${'x'.repeat(80)}…`)).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: '创建分叉会话' }))
        expect(onConfirm).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByRole('button', { name: '取消' }))
        expect(onCancel).toHaveBeenCalledTimes(1)
    })

    it('loading（POST 在途）→ 选项禁用，防重复提交', () => {
        const onConfirm = vi.fn()
        render(<ForkConfirmView targetText="done" loading onConfirm={onConfirm} onCancel={vi.fn()} />)
        const btn = screen.getByRole('button', { name: '创建分叉会话' }) as HTMLButtonElement
        expect(btn.disabled).toBe(true)
        fireEvent.click(btn)
        expect(onConfirm).not.toHaveBeenCalled()
    })

    it('targetText null → 不渲染预览卡，其余照常', () => {
        render(<ForkConfirmView targetText={null} loading={false} onConfirm={vi.fn()} onCancel={vi.fn()} />)
        expect(screen.queryByText('分叉自这条回复')).toBeNull()
        expect(screen.getByRole('button', { name: '创建分叉会话' })).toBeTruthy()
    })
})

// ── MessageActionsDrawer fork 扩展（移动端长按 agent 回复）──

const forkableTarget = {
    key: 'agent-1',
    text: 'agent reply',
    nativeId: null,
    canRewind: false,
    forkAnchorId: 'a1',
    canFork: true,
}

function renderDrawer(overrides: Partial<Parameters<typeof MessageActionsDrawer>[0]> = {}) {
    const props = {
        open: true,
        target: forkableTarget,
        rewindActive: false,
        forkActive: false,
        dryRun: null,
        loading: false,
        onClose: vi.fn(),
        onRewind: vi.fn(),
        onConfirmRewind: vi.fn(),
        onCancelRewind: vi.fn(),
        onFork: vi.fn(),
        onConfirmFork: vi.fn(),
        onCancelFork: vi.fn(),
        ...overrides,
    }
    render(<MessageActionsDrawer {...props} />)
    return props
}

describe('MessageActionsDrawer fork 行（移动端长按 agent 回复）', () => {
    it('可 fork 目标 → 菜单列出 复制 / 从此分叉', () => {
        renderDrawer()
        expect(screen.getByText('复制')).toBeTruthy()
        expect(screen.getByRole('button', { name: '从此分叉' })).toBeTruthy()
    })

    it('点「从此分叉」→ onFork(forkAnchorId)', () => {
        const props = renderDrawer()
        fireEvent.click(screen.getByRole('button', { name: '从此分叉' }))
        expect(props.onFork).toHaveBeenCalledWith('a1')
    })

    it('不可 fork 目标（canFork=false）→ 无分叉行', () => {
        renderDrawer({ target: { ...forkableTarget, canFork: false } })
        expect(screen.getByText('复制')).toBeTruthy()
        expect(screen.queryByRole('button', { name: '从此分叉' })).toBeNull()
    })

    it('forkActive → 分叉行隐藏 + 确认视图就地展开；确认 → onConfirmFork', () => {
        const props = renderDrawer({ forkActive: true })
        expect(screen.queryByRole('button', { name: '从此分叉' })).toBeNull()
        expect(screen.getByRole('button', { name: '创建分叉会话' })).toBeTruthy()
        fireEvent.click(screen.getByRole('button', { name: '创建分叉会话' }))
        expect(props.onConfirmFork).toHaveBeenCalledTimes(1)
    })

    it('forkActive + 取消 → onCancelFork（不误触 rewind 取消）', () => {
        const props = renderDrawer({ forkActive: true })
        fireEvent.click(screen.getByRole('button', { name: '取消' }))
        expect(props.onCancelFork).toHaveBeenCalledTimes(1)
        expect(props.onCancelRewind).not.toHaveBeenCalled()
    })

    it('rewind 菜单行为不回归：可 rewind 目标仍列出「回退并编辑」', () => {
        renderDrawer({
            target: { key: 'u1', text: 'hello', nativeId: 'u1', canRewind: true, forkAnchorId: null, canFork: false },
            rewindActive: true,
            dryRun: { canRewind: true, canRestoreFiles: true },
        })
        expect(screen.getByText('恢复代码并回退')).toBeTruthy()
        expect(screen.queryByRole('button', { name: '从此分叉' })).toBeNull()
    })
})
