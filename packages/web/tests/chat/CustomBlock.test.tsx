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
 * CustomBlockView 渲染测试（ADR 0003：custom text 走 Markdown，动作链接由拦截层分发）：
 * 纯文本渲染不变、text 含 mobi:// 动作链接点击分发（session/open → navigate）、
 * 未注册 URI toast 降级、image/document/quote 分支与未知 block 类型跳过。
 * XMarkdown mock 为极简 md 链接渲染器（[label](href) → 注入的 a 渲染器），
 * 走真实 Markdown 组件的链接拦截分支；真实解析链路由 E2E 覆盖。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ComponentType, ReactNode } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { message } from 'antd'

// ============ mock（hook/函数均返回稳定引用，避免 effect 死循环——项目已知坑） ============

const navigateSpy = vi.hoisted(() => vi.fn())
// 会话激活态与恢复动作 mock（ActionLink 的会话恢复守卫消费；默认激活=不拦截）
vi.mock('@/core/data/hooks/queries/useSession', () => ({
    useSession: () => ({ data: { active: true } }),
}))
vi.mock('@/core/data/hooks/mutations/useSessionActions', () => ({
    useSessionActions: () => ({ resumeSession: vi.fn(async () => ''), isPending: false }),
}))

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigateSpy,
    // 动作分发 hook（useActionDispatcher）读当前会话上下文
    useParams: () => ({ sessionId: 'sess-1' }),
}))

vi.mock('react-i18next', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        useTranslation: () => ({ t: (k: string) => k }),
    }
})

// antd message 静态 API spy（不整包 mock，theme 等走真实实现）
const messageInfoSpy = vi.spyOn(message, 'info').mockImplementation(() => undefined as never)

beforeEach(() => {
    navigateSpy.mockClear()
    messageInfoSpy.mockClear()
})

// XMarkdown mock：极简 md 链接解析——[label](href) 经注入的 a 渲染器出真实 <a>，其余文本原样
vi.mock('@ant-design/x-markdown', () => ({
    XMarkdown: ({ content, components }: {
        content: string
        components?: { a?: ComponentType<{ href?: string; children?: ReactNode }> }
    }) => {
        const A = components?.a
        // split 带两个捕获组：普通段下标 %3==0，label 段 %3==1，href 段 %3==2
        const parts = content.split(/\[([^\]]*)\]\(([^)]*)\)/)
        return (
            <div data-testid="xmd">
                {parts.map((part, i) => {
                    if (i % 3 === 1) return A ? <A key={i} href={parts[i + 1]}>{part}</A> : <span key={i}>{part}</span>
                    if (i % 3 === 2) return null
                    return <span key={i}>{part}</span>
                })}
            </div>
        )
    },
}))

import { CustomBlockView } from '@/components/chat/blocks/CustomBlock'
import type { CustomBlock } from '@/domain/chat/types'

afterEach(cleanup)

function makeBlock(blocks: CustomBlock['blocks']): CustomBlock {
    return { kind: 'custom', id: 'custom-1', localId: null, createdAt: 1000, blocks }
}

function renderView(block: CustomBlock): ReturnType<typeof render> {
    return render(<CustomBlockView block={block} />)
}

describe('CustomBlockView', () => {
    it('纯文本 text 经 Markdown 渲染，内容不变、无链接行为', () => {
        renderView(makeBlock([{ type: 'text', text: 'fork 自会话 ' }]))
        expect(screen.getByText('fork 自会话')).toBeTruthy()
        expect(screen.queryByRole('link')).toBeNull()
        expect(navigateSpy).not.toHaveBeenCalled()
    })

    it('text 含已注册动作链接：点击 navigate 到目标会话', () => {
        renderView(makeBlock([
            { type: 'text', text: 'fork 自会话 [父会话](mobi://session/open?id=parent-1)' },
        ]))
        const link = screen.getByRole('link', { name: '父会话' })
        fireEvent.click(link)
        expect(navigateSpy).toHaveBeenCalledTimes(1)
        expect(navigateSpy).toHaveBeenCalledWith(
            expect.objectContaining({ params: { sessionId: 'parent-1' } }),
        )
        expect(messageInfoSpy).not.toHaveBeenCalled()
    })

    it('text 含未注册 mobi URI：点击 toast 不跳转', () => {
        renderView(makeBlock([
            { type: 'text', text: '看看 [文件](mobi://file/download?path=x)' },
        ]))
        fireEvent.click(screen.getByRole('link', { name: '文件' }))
        expect(messageInfoSpy).toHaveBeenCalledWith('chat.action.unsupported')
        expect(navigateSpy).not.toHaveBeenCalled()
    })

    it('image/document/quote 分支维持跳过不渲染', () => {
        renderView(makeBlock([
            { type: 'quote', role: 'user', messageId: 'm-1', excerpt: '被引用内容' },
        ]))
        expect(screen.queryByText('被引用内容')).toBeNull()
        expect(screen.queryByRole('link')).toBeNull()
    })

    it('未知 block 类型跳过（向前兼容）', () => {
        const { container } = renderView(makeBlock([
            { type: 'mystery' } as unknown as CustomBlock['blocks'][number],
        ]))
        expect(container.querySelector('a')).toBeNull()
    })
})
