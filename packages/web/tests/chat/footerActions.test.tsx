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
import { UserMessageFooter } from '@/components/chat/UserMessageFooter'

// mock i18next：提供 footer 操作组文案映射（initReactI18next 必须 noop 导出，避免 i18n 顶层 init 报错）
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string) => {
            const map: Record<string, string> = {
                'chat.rewind.title': '回退并编辑',
                'chat.copy': '复制',
                'chat.rewind.restoreAndRewind': '恢复代码并回退',
                'chat.rewind.rewindOnly': '仅回退对话',
                'chat.rewind.filesUnavailable': '文件快照已超出保留窗口，将仅回退对话',
                'chat.rewind.notice': '此消息之后的所有对话将被移除',
                'chat.rewind.targetLabel': '回退至此',
                'chat.rewind.restoreDesc': '将工作目录文件回滚到此刻的快照',
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

/** 当前渲染中 button 数量（复制按钮无稳定 accessible name，按数量断言操作组成员） */
function buttonCount(): number {
    return screen.queryAllByRole('button').length
}

describe('UserMessageFooter（用户消息 footer 操作组）', () => {
    it('可 rewind 时：复制 + rewind 入口 + 时间戳', () => {
        const onRewind = vi.fn()
        const { container } = render(
            <UserMessageFooter text="hello" createdAt={Date.now()} canRewind onRewind={onRewind} />,
        )
        // 操作组两项都挂 msg-copy-btn（hover 显示模式）
        const actionSlots = container.querySelectorAll('.msg-copy-btn')
        expect(actionSlots.length).toBe(2)
        // rewind 入口可点击
        fireEvent.click(screen.getByRole('button', { name: '回退并编辑' }))
        expect(onRewind).toHaveBeenCalledTimes(1)
    })

    it('不可 rewind → 只有复制 + 时间戳，无禁用态 rewind 入口', () => {
        render(<UserMessageFooter text="hello" createdAt={Date.now()} canRewind={false} onRewind={vi.fn()} />)
        expect(screen.queryByRole('button', { name: '回退并编辑' })).toBeNull()
        // 复制按钮仍在（操作组仅剩复制）
        expect(buttonCount()).toBe(1)
    })

    it('时间戳常驻最右：DOM 顺序为 操作组在前、时间戳最后', () => {
        const { container } = render(
            <UserMessageFooter text="hello" createdAt={new Date(2026, 0, 1, 12, 34).getTime()} canRewind onRewind={vi.fn()} />,
        )
        const root = container.firstElementChild as HTMLElement
        const children = Array.from(root.children) as HTMLElement[]
        expect(children.length).toBe(3)
        // 前两个是操作组（msg-copy-btn），最后是时间戳（marginLeft:auto 推到最右）
        expect(children[0].className).toContain('msg-copy-btn')
        expect(children[1].className).toContain('msg-copy-btn')
        // 非当天显示 MM/DD HH:mm（formatMessageTime 既有格式）
        expect(children[2].textContent).toBe('01/01 12:34')
        expect(children[2].style.marginLeft).toBe('auto')
    })
})

describe('UserMessageFooter rewind Popover（PC 锚定确认，替代居中 Modal）', () => {
    it('rewindOpen → ⏪ 外包 Popover 渲染确认视图（两选项）', () => {
        render(
            <UserMessageFooter
                text="hello" createdAt={Date.now()} canRewind
                onRewind={vi.fn()}
                rewindOpen
                rewindDryRun={{ canRewind: true, canRestoreFiles: true }}
                rewindLoading={false}
                onRewindConfirm={vi.fn()} onRewindCancel={vi.fn()}
            />,
        )
        expect(screen.getByRole('button', { name: '恢复代码并回退' })).toBeTruthy()
        expect(screen.getByRole('button', { name: '仅回退对话' })).toBeTruthy()
    })

    it('rewindOpen 确认 → onRewindConfirm 携带 restoreFiles', () => {
        const onRewindConfirm = vi.fn()
        render(
            <UserMessageFooter
                text="hello" createdAt={Date.now()} canRewind
                onRewind={vi.fn()}
                rewindOpen
                rewindDryRun={{ canRewind: true, canRestoreFiles: true }}
                rewindLoading={false}
                onRewindConfirm={onRewindConfirm} onRewindCancel={vi.fn()}
            />,
        )
        fireEvent.click(screen.getByRole('button', { name: '恢复代码并回退' }))
        expect(onRewindConfirm).toHaveBeenCalledWith(true)
    })

    it('rewindOpen=false → 不渲染 Popover 确认内容', () => {
        render(<UserMessageFooter text="hello" createdAt={Date.now()} canRewind onRewind={vi.fn()} />)
        expect(screen.queryByRole('button', { name: '恢复代码并回退' })).toBeNull()
    })

    it('rewindOpen 时点击 ⏪ 不再触发 onRewind（避免重复 dry-run）', () => {
        const onRewind = vi.fn()
        render(
            <UserMessageFooter
                text="hello" createdAt={Date.now()} canRewind
                onRewind={onRewind}
                rewindOpen
                rewindDryRun={{ canRewind: true, canRestoreFiles: true }}
                rewindLoading={false}
                onRewindConfirm={vi.fn()} onRewindCancel={vi.fn()}
            />,
        )
        fireEvent.click(screen.getByRole('button', { name: '回退并编辑' }))
        expect(onRewind).not.toHaveBeenCalled()
    })
})
