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
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { UserContentBlock } from '@mobi/shared'

// 轻量 mock Markdown：UserBlocksView 的测试关注「block 分发」而非 markdown 渲染管线，
// XMarkdown 全链路由 ui/MarkdownStreaming.test.tsx 与 E2E 覆盖
vi.mock('@/components/ui/Markdown', () => ({
    Markdown: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}))

const { UserBlocksView, USER_BLOCK_RENDERERS } = await import('@/components/chat/userBlocks/UserBlocksView')

afterEach(cleanup)

/** 文件卡 / 列表根元素（antd 默认前缀 ant-*；子元素类名含 -list/-file 等后缀，须精确匹配） */
const CARD_ROOT = '.ant-file-card'
const LIST_ROOT = '.ant-file-card-list'

describe('UserBlocksView 按 block 分发渲染', () => {
    it('quote 条 / 文件卡 / 内联图 / 文本各走各的视图', () => {
        const blocks: UserContentBlock[] = [
            { type: 'quote', messageId: 'm1', role: 'agent', excerpt: 'CCR backend…' },
            {
                type: 'document',
                source: { type: 'url', value: '/u/r.pdf', mimeType: 'application/pdf' },
                id: 'd1', filename: 'report.pdf', size: 12345,
            },
            {
                type: 'image',
                source: { type: 'url', value: '/u/p.png', mimeType: 'image/png' },
                id: 'g1', filename: 'pic.png', size: 2048,
            },
            { type: 'text', text: '帮我看看' },
        ]
        render(<UserBlocksView blocks={blocks} env={{ sessionId: 's1' }} />)

        // quote：data-testid 定位 + excerpt 全文 + hover title 兜底展示全文
        expect(screen.getByTestId('user-quote-m1')).toHaveTextContent('CCR backend…')
        expect(screen.getByTestId('user-quote-m1')).toHaveAttribute('title', 'CCR backend…')

        // document 卡：文件名渲染（FileCard 把 name 拆成 prefix/suffix 两个 span，
        // 单元素 getByText 拿不到完整名，用卡片级 textContent 断言）
        const pdfPrefix = screen.getByText('report')
        const pdfCard = pdfPrefix.closest(CARD_ROOT) as HTMLElement
        expect(pdfCard).not.toBeNull()
        expect(pdfCard).toHaveTextContent('report.pdf')

        // image 卡：alt 取 filename 的真实 <img>，src 走 read-file 端点（服务端路径语义）
        const img = screen.getByRole('img', { name: /pic\.png|pic/ })
        expect(img).toHaveAttribute(
            'src',
            expect.stringContaining('/api/sessions/s1/read-file'),
        )
        expect(img).toHaveAttribute(
            'src',
            expect.stringContaining(encodeURIComponent('/u/p.png')),
        )

        // 文本：原 Markdown 通道照常渲染
        expect(screen.getByText('帮我看看')).toBeInTheDocument()
    })

    it('连续 document 合并为 FileCard.List；被其他 block 打断则分段', () => {
        const blocks: UserContentBlock[] = [
            {
                type: 'document',
                source: { type: 'url', value: '/u/a.zip', mimeType: 'application/zip' },
                id: 'd1', filename: 'a.zip', size: 1,
            },
            {
                type: 'document',
                source: { type: 'url', value: '/u/b.pdf', mimeType: 'application/pdf' },
                id: 'd2', filename: 'b.pdf', size: 2,
            },
            { type: 'text', text: '中间夹一段' },
            {
                type: 'document',
                source: { type: 'url', value: '/u/c.md', mimeType: 'text/markdown' },
                id: 'd3', filename: 'c.md', size: 3,
            },
        ]
        const { container } = render(<UserBlocksView blocks={blocks} />)

        // 前 2 个 doc 进同一个 List，第 3 个独立成 List/List 之外单卡——共 2 个 List 容器
        const lists = Array.from(container.querySelectorAll<HTMLElement>(LIST_ROOT))
        expect(lists).toHaveLength(2)
        expect(lists[0]).toHaveTextContent('a.zip')
        expect(lists[0]).toHaveTextContent('b.pdf')
        expect(lists[1]).toHaveTextContent('c.md')

        expect(screen.getByText('中间夹一段')).toBeInTheDocument()
    })

    it('纯单 text blocks 与旧渲染等价（回归）', () => {
        render(<UserBlocksView blocks={[{ type: 'text', text: '你好' }]} />)
        expect(screen.getByText('你好')).toBeInTheDocument()
    })

    it('image 走 previewUrl 自足 URL 直通，不走 read-file 拼接', () => {
        render(
            <UserBlocksView
                blocks={[{
                    type: 'image',
                    source: { type: 'url', value: '/u/p.png', mimeType: 'image/png' },
                    id: 'g1', filename: 'p.png', size: 1,
                    previewUrl: 'blob:http://localhost/abc',
                }]}
                env={{ sessionId: 's1' }}
            />,
        )
        expect(screen.getByRole('img', { name: /p\.png|p/ })).toHaveAttribute('src', 'blob:http://localhost/abc')
    })
})

describe('USER_BLOCK_RENDERERS 注册表完整性', () => {
    it('四种 block 类型全部注册视图', () => {
        expect(Object.keys(USER_BLOCK_RENDERERS).sort()).toEqual(['document', 'image', 'quote', 'text'])
    })
})

describe('合成消息文本样式', () => {
    it('env.isSynthetic 时文本走弱化 span，不进 Markdown', () => {
        render(
            <UserBlocksView
                blocks={[{ type: 'text', text: '/rewind 标记' }]}
                env={{ isSynthetic: true }}
            />,
        )
        expect(document.querySelector('[data-testid=md]')).toBeNull()
        expect(screen.getByText('/rewind 标记').tagName).toBe('SPAN')
    })
})
