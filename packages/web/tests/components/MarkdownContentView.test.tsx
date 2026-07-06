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

import { describe, it, expect, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'

// XMarkdown / Shiki 真实渲染过重，mock 掉只验证外壳容器（padding 由 CSS class 承载）
vi.mock('@/components/ui/Markdown', () => ({
    Markdown: ({ content }: { content: string }) => <div data-testid="md-render">{content}</div>,
}))
vi.mock('@/components/files/CodeHighlight', () => ({
    default: ({ code }: { code: string }) => <div data-testid="md-source">{code}</div>,
}))

const MarkdownContentView = (await import('@/components/files/MarkdownContentView')).default

describe('MarkdownContentView', () => {
    it('render 模式：外层包 .markdown-content-view 容器（承载 padding，避免贴边）', () => {
        const { container, getByTestId } = render(
            <MarkdownContentView text="# hi" filePath="a.md" view="render" />,
        )
        expect(container.querySelector('.markdown-content-view')).toBeInTheDocument()
        expect(getByTestId('md-render')).toBeInTheDocument()
    })

    it('source 模式：同样包 .markdown-content-view 容器', () => {
        const { container, getByTestId } = render(
            <MarkdownContentView text="# hi" filePath="a.md" view="source" />,
        )
        expect(container.querySelector('.markdown-content-view')).toBeInTheDocument()
        expect(getByTestId('md-source')).toBeInTheDocument()
    })
})
