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
import { UserMessageFooter } from '@/components/chat/UserMessageFooter'

// mock i18next：提供 footer 操作组文案映射（initReactI18next 必须 noop 导出，避免 i18n 顶层 init 报错）
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string) => {
            const map: Record<string, string> = {
                'chat.rewind.title': '回退并编辑',
                'chat.copy': '复制',
            }
            return map[key] ?? key
        },
    }),
}))

// 渲染型测试显式 cleanup（vitest 未开 globals，DOM 累积会炸）
afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
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
