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
 * Markdown mobi:// 链接拦截（ADR 0003）：
 * - mobi:// 链接渲染为 ActionLink（不外跳），已注册动作点击分发执行器（session/open → navigate）
 * - 未注册 / 畸形 URI 点击 toast「不支持的操作」，不跳转、不抛错
 * - 普通 http 链接仍 target="_blank"
 * XMarkdown mock 把 content 当作 href 复用注入的 a 渲染器，聚焦链接分支契约；
 * 真实 Markdown 解析链路由 E2E 覆盖。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ComponentType, ReactNode } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
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

// XMarkdown mock：content 即 href，复用注入的 a 渲染器渲染链接（ExternalLink 分支由此驱动）
vi.mock('@ant-design/x-markdown', () => ({
    XMarkdown: ({ content, components }: {
        content: string
        components?: { a?: ComponentType<{ href?: string; children?: ReactNode }> }
    }) => {
        const A = components?.a
        return (
            <div data-testid="xmd">
                {A ? <A href={content}>{content}</A> : content}
            </div>
        )
    },
}))

import { Markdown } from '@/components/ui/Markdown'

afterEach(cleanup)

function renderLink(content: string) {
    return render(<Markdown content={content} />)
}

describe('Markdown mobi:// 链接拦截', () => {
    it('已注册动作（session/open）：点击 preventDefault 并 navigate 到目标会话', () => {
        renderLink('mobi://session/open?id=s1')
        const link = screen.getByRole('link', { name: 'mobi://session/open?id=s1' })
        fireEvent.click(link)
        expect(navigateSpy).toHaveBeenCalledTimes(1)
        expect(navigateSpy).toHaveBeenCalledWith(
            expect.objectContaining({ params: { sessionId: 's1' } }),
        )
        expect(messageInfoSpy).not.toHaveBeenCalled()
    })

    it('scheme 大小写不敏感（MOBI://）同样识别并分发', () => {
        renderLink('MOBI://session/open?id=s2')
        fireEvent.click(screen.getByRole('link'))
        expect(navigateSpy).toHaveBeenCalledWith(
            expect.objectContaining({ params: { sessionId: 's2' } }),
        )
    })

    it('未注册动作（file/download）：正常链接样式，点击 toast 不跳转', () => {
        renderLink('mobi://file/download?path=x')
        fireEvent.click(screen.getByRole('link'))
        expect(messageInfoSpy).toHaveBeenCalledWith('chat.action.unsupported')
        expect(navigateSpy).not.toHaveBeenCalled()
    })

    it('畸形 URI（mobi://session）：点击 toast 不抛错', () => {
        renderLink('mobi://session')
        fireEvent.click(screen.getByRole('link'))
        expect(messageInfoSpy).toHaveBeenCalledWith('chat.action.unsupported')
        expect(navigateSpy).not.toHaveBeenCalled()
    })

    it('普通 http 链接仍新标签页打开，不走动作分发', () => {
        renderLink('https://example.com')
        const link = screen.getByRole('link') as HTMLAnchorElement
        expect(link.getAttribute('target')).toBe('_blank')
        expect(link.getAttribute('rel')).toBe('noopener noreferrer')
        fireEvent.click(link)
        expect(navigateSpy).not.toHaveBeenCalled()
        expect(messageInfoSpy).not.toHaveBeenCalled()
    })
})
