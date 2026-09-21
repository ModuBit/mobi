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
 * Markdown 流式未完成语法占位规格：
 * x-markdown 的流式缓存（hasNextChunk=true）会把未闭合 token 扣在 pending 里
 * 隐身到闭合为止（emphasis/link/inline-code 整段不可见，见 dist useStreaming 源码）。
 * mobi 注册 incomplete-emphasis / incomplete-link / incomplete-inline-code 三个占位
 * 组件，把「隐身」变「渐进可见」（渲染已打出的部分内容）；table/fenced code 官方
 * 本身渐进渲染、image 未闭合窗口极短，不加 skeleton（闪现即负优化）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// 受控 display：直接驱动「揭示进度」（与 MarkdownStreaming.test 同模式）
const displayState = vi.hoisted(() => ({ current: '' }))
vi.mock('@/components/ui/useStreamingContent', () => ({
    useStreamingContent: () => displayState.current,
    STREAM_BASE_RATE: 0.1,
    computeRevealRate: vi.fn(() => 0.1),
    revealIntervalFor: vi.fn(() => 0),
}))

// XMarkdown mock：记录传入的 components，验证占位组件已注册
const xmdProps = vi.hoisted(() => ({ last: null as null | { content: string; components?: Record<string, unknown> } }))
vi.mock('@ant-design/x-markdown', () => ({
    XMarkdown: ({ content, components }: { content: string; components?: Record<string, unknown> }) => {
        xmdProps.last = { content, components }
        return <div data-testid="xmd">{content}</div>
    },
}))

const { Markdown } = await import('@/components/ui/Markdown')
const { IncompleteEmphasis, IncompleteLink, IncompleteInlineCode } = await import(
    '@/components/ui/MarkdownIncomplete'
)

describe('未完成语法占位组件', () => {
    afterEach(() => cleanup())

    it('IncompleteEmphasis：data-raw 按定界符层级渲染 em / strong / em>strong', () => {
        const { container, rerender } = render(<IncompleteEmphasis data-raw="**加粗中" />)
        expect(container.querySelector('strong')?.textContent).toBe('加粗中')

        rerender(<IncompleteEmphasis data-raw="*斜体中" />)
        expect(container.querySelector('em')?.textContent).toBe('斜体中')

        rerender(<IncompleteEmphasis data-raw="***都要" />)
        expect(container.querySelector('em strong')?.textContent).toBe('都要')

        // 定界符刚打出、还没内容：不渲染（空 strong 无意义）
        rerender(<IncompleteEmphasis data-raw="**" />)
        expect(container.querySelector('strong')).toBeNull()
    })

    it('IncompleteLink：提取 [text]( 中已打出的链接文字渲染', () => {
        const { container } = render(<IncompleteLink data-raw={encodeURIComponent('[链接文字](ht')} />)
        const anchor = container.querySelector('a')
        expect(anchor?.textContent).toBe('链接文字')
        // 过渡态不可交互
        expect(anchor).toHaveStyle({ pointerEvents: 'none' })
    })

    it('IncompleteInlineCode：渲染去掉反引号的半截代码文本', () => {
        const { container } = render(<IncompleteInlineCode data-raw={encodeURIComponent('`npm ins')} />)
        expect(container.querySelector('code')?.textContent).toBe('npm ins')
    })
})

describe('Markdown 注册占位组件', () => {
    beforeEach(() => {
        displayState.current = ''
        xmdProps.last = null
    })
    afterEach(() => cleanup())

    it('流式渲染时 components 带 incomplete-emphasis / incomplete-link / incomplete-inline-code', () => {
        displayState.current = '**加粗'
        render(<Markdown content="**加粗中**" streaming />)
        const names = Object.keys(xmdProps.last?.components ?? {})
        expect(names).toEqual(expect.arrayContaining(['incomplete-emphasis', 'incomplete-link', 'incomplete-inline-code']))
    })

    it('非流式渲染同样带占位组件（占位仅在流式缓存下触发，常驻注册无害）', () => {
        displayState.current = '全文'
        render(<Markdown content="全文" />)
        expect(Object.keys(xmdProps.last?.components ?? {})).toContain('incomplete-emphasis')
    })
})
