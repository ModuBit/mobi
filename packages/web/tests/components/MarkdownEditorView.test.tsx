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
import '@testing-library/jest-dom/vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import { MarkdownEditorView } from '@/components/files/MarkdownEditorView'

// jsdom 没有 ResizeObserver（MarkdownToolbar 工具栏横向滚动依赖）
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

// vitest 未开 globals：渲染型测试需显式 cleanup，否则 DOM 累积致 getBy*/querySelector 命中前一个用例的节点
afterEach(cleanup)

describe('MarkdownEditorView', () => {
    it('渲染 ProseMirror 编辑器', async () => {
        const onChange = vi.fn()
        render(<MarkdownEditorView text="# Hello" onChange={onChange} />)
        // useEditor(immediatelyRender:false) 异步挂载
        await waitFor(() => {
            expect(document.querySelector('.ProseMirror')).toBeInTheDocument()
        })
    })

    it('filePath/text 变化不崩', async () => {
        const { rerender } = render(<MarkdownEditorView text="# A" onChange={() => {}} />)
        await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeInTheDocument())
        rerender(<MarkdownEditorView text="# B" onChange={() => {}} />)
        await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeInTheDocument())
    })

    it('富 markdown（表格/链接/图片/代码块）渲染不崩', async () => {
        const md = [
            '# 标题',
            '',
            '| a | b |',
            '| --- | --- |',
            '| 1 | 2 |',
            '',
            '[link](http://example.com)',
            '',
            '![img](http://example.com/x.png)',
            '',
            '```ts',
            'const x = 1',
            '```',
        ].join('\n')
        render(<MarkdownEditorView text={md} onChange={() => {}} />)
        await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeInTheDocument())
        // 表格渲染（GFM 解析）
        await waitFor(() => expect(document.querySelector('.ProseMirror table')).toBeInTheDocument(), { timeout: 3000 })
        // 代码块高亮（lowlight 输出 .hljs 类）
        await waitFor(() => expect(document.querySelector('.ProseMirror pre.hljs, .ProseMirror pre code.hljs, .ProseMirror pre code span')).toBeInTheDocument(), { timeout: 3000 })
    })

    it('外部 text 变化走 setContent 且不回灌 onChange（防 edit→md→text→setContent 死循环）', async () => {
        const onChange = vi.fn()
        const { rerender } = render(<MarkdownEditorView text="# A" onChange={onChange} />)
        await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeInTheDocument())
        onChange.mockClear()
        // 外部变更（OCC reload / 文件切换后内容回填）→ 走 setContent 重解析
        rerender(<MarkdownEditorView text="# B 新内容" onChange={onChange} />)
        await waitFor(() => expect(document.querySelector('.ProseMirror')).toHaveTextContent('新内容'))
        // setContent 期间 syncingRef + lastEmitted 双守卫 → 不回灌 onChange，
        // 否则 onUpdate→onChange→text→setContent 会与 DOM↔model 抖动互激形成死循环（mermaid NodeView 下复现）
        expect(onChange).not.toHaveBeenCalled()
    })
})
