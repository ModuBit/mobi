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

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { SendMessageView, SendMessageFullView } from '@/components/tool-card/views/SendMessageView'
import { getToolFullViewComponent } from '@/components/tool-card/views/_all'
import type { ToolViewProps } from '@/components/tool-card/views/_all'
import type { ToolInfo } from '@/domain/tool/types'

// mock i18next：t 直接返回 key 本身，断言文案用 key 值
vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({
            t: (key: string) => key,
        }),
    }
})

// jsdom 没有 ResizeObserver（测量不触发时组件保留首帧估值，测试可据此断言展开入口显隐）
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

afterEach(cleanup)

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

function makeProps(input: unknown, result: unknown): ToolViewProps {
    const tool: ToolInfo = {
        name: 'SendMessage',
        input,
        result,
        state: 'completed',
        description: null,
        startedAt: null,
        createdAt: Date.now(),
        permission: null,
    }
    return { block: { id: 'block-1', type: 'tool_use', tool } } as unknown as ToolViewProps
}

describe('SendMessageView（SendMessage 工具视图）', () => {
    it('正文优先取完整的 input.message，而不是截断投影 input.content', () => {
        const fullText = '用户想了解一下你那边的状态：你现在在做什么任务？简要回一下当前进展即可。'
        const truncated = '用户想了解一下你那边的状态：你现在在做什么任务？…'
        render(
            <SendMessageView
                {...makeProps(
                    { to: 'mobi-ab', recipient: 'mobi-ab', type: 'message', summary: '询问当前任务进展', message: fullText, content: truncated },
                    JSON.stringify({ success: true, msgId: 'm-1' }),
                )}
            />,
            { wrapper },
        )
        // 完整正文可见，截断投影不再展示
        expect(screen.getByText(fullText)).toBeInTheDocument()
        expect(screen.queryByText(truncated)).not.toBeInTheDocument()
    })

    it('无 input.message 时降级用截断的 input.content', () => {
        const truncated = '只有 content 字段的情形…'
        render(
            <SendMessageView
                {...makeProps(
                    { to: 'mobi-ab', content: truncated },
                    JSON.stringify({ success: true }),
                )}
            />,
            { wrapper },
        )
        expect(screen.getByText(truncated)).toBeInTheDocument()
    })

    it('长正文（单行超阈值）显示展开入口，点击原位展开/收起', () => {
        // 单行长文本触发首帧估值（RTL 对多行文本的 exact 匹配不可靠，断言统一用单行）
        const fullText = '这是一条很长的单行消息，'.repeat(30)
        render(
            <SendMessageView
                {...makeProps(
                    { to: 'mobi-ab', summary: '询问当前任务进展', message: fullText },
                    JSON.stringify({ success: true }),
                )}
            />,
            { wrapper },
        )
        expect(screen.getByRole('button', { name: 'chat.expand' })).toHaveAttribute('aria-expanded', 'false')
        fireEvent.click(screen.getByRole('button', { name: 'chat.expand' }))
        expect(screen.getByRole('button', { name: 'chat.collapse' })).toHaveAttribute('aria-expanded', 'true')
        fireEvent.click(screen.getByRole('button', { name: 'chat.collapse' }))
        expect(screen.getByRole('button', { name: 'chat.expand' })).toBeInTheDocument()
    })

    it('短正文不显示展开入口', () => {
        render(
            <SendMessageView
                {...makeProps(
                    { to: 'mobi-ab', message: '短消息' },
                    JSON.stringify({ success: true }),
                )}
            />,
            { wrapper },
        )
        expect(screen.queryByRole('button', { name: 'chat.expand' })).not.toBeInTheDocument()
    })
})

describe('SendMessageFullView（Drawer 完整视图）', () => {
    it('注册为 Drawer 的 FullView，且展示完整正文（不折叠）', () => {
        // Drawer 详情必须拿到完整视图组件（预览视图会把正文钳在 5 行内）
        expect(getToolFullViewComponent('SendMessage')).toBe(SendMessageFullView)

        const fullText = 'Drawer 内不折叠的完整消息，'.repeat(30)
        render(
            <SendMessageFullView
                {...makeProps(
                    { to: 'mobi-ab', summary: '询问当前任务进展', message: fullText },
                    JSON.stringify({ success: true }),
                )}
            />,
            { wrapper },
        )
        expect(screen.getByText(fullText)).toBeInTheDocument()
        // 完整视图没有展开/收起入口
        expect(screen.queryByRole('button', { name: 'chat.expand' })).not.toBeInTheDocument()
    })
})
