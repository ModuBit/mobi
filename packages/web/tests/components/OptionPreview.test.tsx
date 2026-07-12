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
 * OptionPreview 单元测试
 * 锁定：preview 按「整段是否为 HTML」分流——真 HTML 片段走 dangerouslySetInnerHTML，
 * 其余（含 markdown 源码、以 < 开头但非 HTML 的文本）一律走 Markdown 组件。
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { OptionPreview } from '@/components/tool-card/OptionPreview'

// mock Markdown：回显内容，便于区分「走 Markdown」vs「走 dangerouslySetInnerHTML 注入」
vi.mock('@/components/ui/Markdown', () => ({
    Markdown: ({ content }: { content: string }) => (
        <div data-testid="markdown-render">{content}</div>
    ),
}))

// jsdom 没有 ResizeObserver（Ant Design 需要）
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

// Popover 浮层挂到 body portal，跨测试需清理避免重复命中
afterEach(() => {
    cleanup()
})

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

async function openPopover(container: HTMLElement) {
    // lucide Eye 渲染为 svg（aria-hidden，无 role/label），直接定位触发器点击展开浮层
    const trigger = container.querySelector('svg')!
    fireEvent.click(trigger)
    // 等待浮层渲染完成（HTML 分支无 testid，用 popover 内容容器的出现来同步）
    await new Promise(resolve => setTimeout(resolve, 0))
}

describe('OptionPreview', () => {
    it('渲染 children（选项标签）', () => {
        render(
            <OptionPreview preview="some preview">
                <span>选项 A</span>
            </OptionPreview>,
            { wrapper },
        )
        expect(screen.getByText('选项 A')).toBeInTheDocument()
    })

    it('markdown preview 经 Markdown 组件渲染', async () => {
        const { container } = render(
            <OptionPreview preview="# 标题">
                <span>opt</span>
            </OptionPreview>,
            { wrapper },
        )
        await openPopover(container)
        await waitFor(() => expect(screen.getByTestId('markdown-render')).toBeInTheDocument())
        expect(screen.getByTestId('markdown-render')).toHaveTextContent('# 标题')
    })

    it('以 < 开头但本质是 markdown 的内容（如 <details> 后跟裸文本）走 Markdown，不误注入', async () => {
        // < 之后紧跟非字母，DOMParser 不识别为标签 → body 有裸文本 → 判 markdown
        const { container } = render(
            <OptionPreview preview="< 不是标签开头，< 5 大于 3">
                <span>opt</span>
            </OptionPreview>,
            { wrapper },
        )
        await openPopover(container)
        await waitFor(() => expect(screen.getByTestId('markdown-render')).toBeInTheDocument())
    })

    it('纯 HTML 片段走 dangerouslySetInnerHTML（渲染为真实 DOM 元素）', async () => {
        const { container } = render(
            <OptionPreview preview="<div>hello-html</div>">
                <span>opt</span>
            </OptionPreview>,
            { wrapper },
        )
        await openPopover(container)
        // 浮层挂到 body portal；HTML 注入后应出现真实 div>hello-html，且不出现 markdown mock
        await waitFor(() => expect(screen.queryByTestId('markdown-render')).not.toBeInTheDocument())
        expect(document.body.textContent).toContain('hello-html')
    })

    it('多段 HTML 元素片段仍判定为 HTML', async () => {
        const { container } = render(
            <OptionPreview preview="<h1>t</h1><p>body</p>">
                <span>opt</span>
            </OptionPreview>,
            { wrapper },
        )
        await openPopover(container)
        await waitFor(() => expect(screen.queryByTestId('markdown-render')).not.toBeInTheDocument())
        expect(document.body.textContent).toContain('body')
    })

    it('HTML 元素后跟裸文本判定为 markdown（混杂非标签文本）', async () => {
        const { container } = render(
            <OptionPreview preview="<div>x</div> 裸文本">
                <span>opt</span>
            </OptionPreview>,
            { wrapper },
        )
        await openPopover(container)
        await waitFor(() => expect(screen.getByTestId('markdown-render')).toBeInTheDocument())
    })

    it('markdown preview 容器使用等宽字体（不强制 white-space，ASCII 图靠代码块自带 pre）', async () => {
        const { container } = render(
            <OptionPreview preview="# 标题">
                <span>opt</span>
            </OptionPreview>,
            { wrapper },
        )
        await openPopover(container)
        const rendered = await waitFor(() => screen.getByTestId('markdown-render'))
        const markdownBox = rendered.parentElement!
        expect(markdownBox.style.fontFamily).toBe('var(--font-mono)')
        // 不在容器层强制 white-space: pre（否则与 Markdown breaks:true 冲突产生双倍行距）
        expect(markdownBox.style.whiteSpace).toBe('')
    })

    it('markdown 被 HTML 元素包裹（如 <div>\\n# 标题\\n</div>）仍走 Markdown，不显示裸源码', async () => {
        const { container } = render(
            <OptionPreview preview={'<div>\n# 标题\n- 项\n</div>'}>
                <span>opt</span>
            </OptionPreview>,
            { wrapper },
        )
        await openPopover(container)
        await waitFor(() => expect(screen.getByTestId('markdown-render')).toBeInTheDocument())
    })

    it('HTML 分支经过 DOMPurify 清洗，拦截 <img onerror> 等事件处理器', async () => {
        const { container } = render(
            <OptionPreview preview="<div>x</div><img src=x onerror=alert(1)>">
                <span>opt</span>
            </OptionPreview>,
            { wrapper },
        )
        await openPopover(container)
        await waitFor(() => expect(screen.queryByTestId('markdown-render')).not.toBeInTheDocument())
        // 走 HTML 注入，但 onerror 被剥离
        const img = document.querySelector('img')
        expect(img).not.toBeNull()
        expect(img?.getAttribute('onerror')).toBeNull()
    })
})
