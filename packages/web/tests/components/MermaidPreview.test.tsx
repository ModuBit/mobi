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

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { MermaidCodeBlock, MermaidPreview } from '@/components/files/MermaidPreview'
import { common, createLowlight } from 'lowlight'
import { resetMermaidCache } from '@/components/files/mermaidRender'
import { resetMermaidZoomCache } from '@/components/files/mermaidWidget'

// mock mermaid：render 返回固定 svg，验证 decoration 注入即可（不跑真 dagre）
const renderMock = vi.fn(async (_id: string, _code: string) => ({ svg: '<svg class="mock-svg"/>' }))
vi.mock('mermaid', () => ({
    default: {
        initialize: vi.fn(),
        render: renderMock,
    },
}))

beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

const lowlight = createLowlight(common)

/** 用 MermaidPreview 装一个编辑器，渲染给定 doc JSON */
function Editor({ doc }: { doc: { type: string; content?: unknown[] } }) {
    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({ codeBlock: false }),
            MermaidCodeBlock.configure({ lowlight }),
            MermaidPreview,
        ],
        content: doc,
    }) as unknown as ReturnType<typeof useEditor>
    return <EditorContent editor={editor} />
}

const docMermaid = (text: string, collapsed = true) => ({
    type: 'doc',
    content: [{ type: 'codeBlock', attrs: { language: 'mermaid', collapsed }, content: [{ type: 'text', text }] }],
})
const docCode = (lang: string, text: string) => ({
    type: 'doc',
    content: [{ type: 'codeBlock', attrs: { language: lang }, content: [{ type: 'text', text }] }],
})

describe('MermaidPreview decoration', () => {
    beforeEach(() => { renderMock.mockClear(); resetMermaidCache(); resetMermaidZoomCache() })
    afterEach(cleanup)

    it('mermaid codeBlock 前插入预览 widget（contenteditable=false + 缩放控件）', async () => {
        render(<Editor doc={docMermaid('graph TD; A-->B')} />)
        await waitFor(() => {
            const widget = document.querySelector('.mermaid-preview-widget')
            expect(widget).not.toBeNull()
            // widget 不可编辑（ProseMirror 不在其内管文本 → 不触发 handleDOMChange）
            expect(widget?.getAttribute('contenteditable')).toBe('false')
        })
        // 缩放控件 + 展开按钮存在
        expect(document.querySelectorAll('.mermaid-btn').length).toBeGreaterThanOrEqual(2)
        await waitFor(() => expect(renderMock).toHaveBeenCalledWith(expect.any(String), 'graph TD; A-->B'))
    })

    it('collapsed=true 时给 codeBlock 加折叠 class（源码隐藏）', async () => {
        render(<Editor doc={docMermaid('graph TD; A-->B', true)} />)
        await waitFor(() => expect(document.querySelector('.mermaid-preview-widget')).not.toBeNull())
        // 原生 codeBlock（pre）带折叠 class
        const pre = document.querySelector('.ProseMirror pre.mermaid-source-collapsed')
        expect(pre).not.toBeNull()
    })

    it('collapsed=false 时源码展开（无折叠 class）', async () => {
        render(<Editor doc={docMermaid('graph TD; A-->B', false)} />)
        await waitFor(() => expect(document.querySelector('.mermaid-preview-widget')).not.toBeNull())
        expect(document.querySelector('.ProseMirror pre.mermaid-source-collapsed')).toBeNull()
        // 源码 pre 存在且可见
        expect(document.querySelector('.ProseMirror pre')).not.toBeNull()
    })

    it('非 mermaid codeBlock 不插 widget、不折叠', async () => {
        render(<Editor doc={docCode('ts', 'const x = 1')} />)
        await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeInTheDocument())
        expect(document.querySelector('.mermaid-preview-widget')).toBeNull()
        expect(document.querySelector('.mermaid-source-collapsed')).toBeNull()
        expect(renderMock).not.toHaveBeenCalled()
    })

    it('空 mermaid 块不渲染（textContent.trim() 为空）', async () => {
        render(<Editor doc={{ type: 'doc', content: [{ type: 'codeBlock', attrs: { language: 'mermaid' } }] }} />)
        await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeInTheDocument())
        expect(document.querySelector('.mermaid-preview-widget')).toBeNull()
    })
}, 30000)
