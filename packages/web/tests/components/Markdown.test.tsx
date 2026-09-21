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
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { Markdown } from '@/components/ui/Markdown'

// 高亮器与 mermaid 是重依赖，只验证门控路由：loading → 裸降级，done → 真组件
vi.mock('@/components/ui/AutoDetectCodeBlock', () => ({
    default: vi.fn(({ code }: { code: string }) => <div data-testid="highlighted">{code}</div>),
    StreamingCodeFallback: ({ code }: { code: string }) => <pre data-testid="plain-code">{code}</pre>,
}))
vi.mock('@/components/ui/MermaidDiagram', () => ({
    MermaidDiagram: vi.fn(({ code }: { code: string }) => <div data-testid="mermaid">{code}</div>),
}))

import { MermaidDiagram } from '@/components/ui/MermaidDiagram'
import { setMarkdownRenderer } from '@/core/lib/markdownRenderer'

// 新栈视图 mock 成 marker：分发 seam 测试只验证「flag → 哪个栈」，不真渲染 Streamdown。
// 容器结构与真实 StreamdownView 对齐（.streamdown-md 容器类 + maxWidth 内联样式）
vi.mock('@/components/ui/StreamdownView', () => ({
    default: vi.fn(({ content, className, style }: {
        content: string; className?: string; style?: React.CSSProperties
    }) => (
        <div
            data-testid="streamdown-view"
            className={['streamdown-md', className].filter(Boolean).join(' ')}
            style={{ maxWidth: '100%', ...style }}
        >
            {content}
        </div>
    )),
}))

import StreamdownView from '@/components/ui/StreamdownView'

describe('Markdown 代码块流式降级', () => {
    afterEach(cleanup)

    // 注：「流式中围栏未闭合渲染裸 pre/code、闭合后降级/升级」的降级渲染属 ticket 07
    // （Streamdown 侧 useIsCodeFenceIncomplete 接入），旧栈无此行为，此处不断言

    it('围栏闭合（done）后挂载高亮器', () => {
        render(<Markdown content={'```js\nconst a = 1\n```\n'} streaming typing={false} />)
        expect(screen.getByTestId('highlighted')).toHaveTextContent('const a = 1')
    })

    it('非流式渲染（历史消息）走高亮器，行为不变', () => {
        render(<Markdown content={'```js\nconst a = 1\n```\n'} />)
        expect(screen.getByTestId('highlighted')).toBeInTheDocument()
    })

    it('闭合后的 mermaid 代码块渲染 MermaidDiagram', () => {
        render(<Markdown content={'```mermaid\ngraph TD\nA-->B\n```\n'} streaming typing={false} />)
        expect(screen.getByTestId('mermaid')).toBeInTheDocument()
    })
})

describe('Markdown 双栈分发（渲染器 flag）', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        localStorage.clear()
        // 默认旧栈：显式清 key，隔离其他用例的残留
        setMarkdownRenderer('x-markdown')
    })

    afterEach(cleanup)

    it('flag 关闭（默认）走旧栈：.x-markdown 容器，不挂新栈视图', () => {
        render(<Markdown content={'**bold**'} />)
        expect(document.querySelector('.x-markdown')).toBeInTheDocument()
        expect(screen.queryByTestId('streamdown-view')).not.toBeInTheDocument()
        expect(StreamdownView).not.toHaveBeenCalled()
    })

    it('flag 开启走新栈：.streamdown-md 容器，内容经 StreamdownView 渲染', async () => {
        setMarkdownRenderer('streamdown')
        render(<Markdown content={'**bold**'} />)
        // lazy chunk 异步解析，用 findBy 等待挂载
        expect(await screen.findByTestId('streamdown-view')).toHaveTextContent('**bold**')
        expect(document.querySelector('.streamdown-md')).toBeInTheDocument()
    })

    it('className / style 透传新栈容器', async () => {
        setMarkdownRenderer('streamdown')
        render(<Markdown content={'hi'} className="custom-md" style={{ padding: 4 }} />)
        await screen.findByTestId('streamdown-view')
        const container = document.querySelector('.streamdown-md')!
        expect(container).toHaveClass('custom-md')
        expect(container).toHaveStyle({ padding: '4px' })
    })

    it('flag 重载生效：挂载后翻转 localStorage 不改变当前栈', () => {
        const { rerender } = render(<Markdown content={'hi'} />)
        setMarkdownRenderer('streamdown')
        // 同实例重渲染仍保持 mount 时读取的旧栈；真实场景靠重载页面切换
        rerender(<Markdown content={'hi'} />)
        expect(document.querySelector('.x-markdown')).toBeInTheDocument()
        expect(screen.queryByTestId('streamdown-view')).not.toBeInTheDocument()
    })
})
