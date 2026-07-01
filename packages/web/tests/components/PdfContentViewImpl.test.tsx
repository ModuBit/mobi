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
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { afterEach, beforeEach } from 'vitest'
import PdfContentViewImpl from '@/components/files/PdfContentViewImpl'

// react-pdf 在 jsdom 下无法真正渲染，mock 成受控占位：
// - Document 透传 file prop（data-file）+ 把 onLoadSuccess 暴露出来供测试触发
// - Page 渲染当前 pageNumber/scale（data-* 便于断言）

/** mock pdf 对象（onLoadSuccess 回调入参；结构对齐 pdfjs PDFDocumentProxy 的 numPages + getPage） */
interface MockPdf {
    numPages: number
    getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number } }>
}

let onLoadSuccessCb: ((pdf: MockPdf) => void) | null = null
vi.mock('react-pdf', () => ({
    pdfjs: { GlobalWorkerOptions: { workerSrc: '' }, version: '5.4.296' },
    // 暴露 file / options / loading prop 到 data-*，断言 withCredentials 与 loading={null}
    Document: ({ children, file, options, loading, onLoadSuccess }: {
        children: React.ReactNode
        file?: unknown
        options?: { withCredentials?: boolean }
        loading?: unknown
        onLoadSuccess?: (pdf: MockPdf) => void
    }) => {
        onLoadSuccessCb = onLoadSuccess ?? null
        return (
            <div
                data-testid="pdf-document"
                data-file={String(file ?? '')}
                data-wc={String(options?.withCredentials ?? '')}
                data-loading={loading === null ? 'null' : 'set'}
            >
                {children}
            </div>
        )
    },
    Page: ({ pageNumber, scale }: { pageNumber: number; scale: number }) => (
        <div data-testid={`pdf-page-${pageNumber}`} data-page={pageNumber} data-scale={scale} />
    ),
}))
vi.mock('react-pdf/dist/Page/AnnotationLayer.css', () => ({}))
vi.mock('react-pdf/dist/Page/TextLayer.css', () => ({}))

// PdfToolbar 调 useTranslation，mock 掉避免 i18n 初始化报错（与 Task 1 测试一致）
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}))

beforeEach(() => {
    onLoadSuccessCb = null
    // PdfContinuousView 用 IntersectionObserver、PdfContentViewImpl 用 ResizeObserver
    vi.stubGlobal('IntersectionObserver', class {
        constructor() {} observe() {} unobserve() {} disconnect() {}
    })
    vi.stubGlobal('ResizeObserver', class {
        observe() {} unobserve() {} disconnect() {}
    })
})

afterEach(() => {
    cleanup()
    onLoadSuccessCb = null
})

/** 触发 onLoadSuccess：注入 numPages + getPage(1).getViewport({scale:1}) */
function fireLoad(numPages: number, w = 595, h = 842) {
    onLoadSuccessCb?.({
        numPages,
        getPage: () => Promise.resolve({
            getViewport: ({ scale }: { scale: number }) => ({ width: w * scale, height: h * scale }),
        }),
    })
}

describe('PdfContentViewImpl', () => {
    it('file={url}：data-file 含 read-file 端点 + encodeURIComponent(filePath)', () => {
        render(<PdfContentViewImpl sessionId="s1" filePath="a/b.pdf" />)
        const doc = screen.getByTestId('pdf-document')
        // url 形式：/api/sessions/s1/read-file?path=a%2Fb.pdf
        expect(doc).toHaveAttribute('data-file')
        const file = doc.getAttribute('data-file')!
        expect(file).toContain('/api/sessions/s1/read-file')
        expect(file).toContain(encodeURIComponent('a/b.pdf'))
    })

    it('onLoadSuccess 后工具栏出现（百分比 / 适应宽度 / 100% 按钮可见）', async () => {
        render(<PdfContentViewImpl sessionId="s1" filePath="a.pdf" />)
        // Document 初始渲染（numPages=0 → Spin，但 Document 仍挂载以触发 onLoadSuccess）
        expect(screen.getByTestId('pdf-document')).toBeInTheDocument()

        // 触发 onLoadSuccess（2 页）
        await act(async () => { fireLoad(2) })

        // 工具栏：比例（默认 100%）、适应宽度、100% 按钮可见
        expect(screen.getByText('100%')).toBeInTheDocument()
        expect(screen.getByText('files.fitWidth')).toBeInTheDocument()
        expect(screen.getByText('files.actualSize')).toBeInTheDocument()
    })

    it('100% 预设重置 scale（放大后点 100% 回到 100%）', async () => {
        render(<PdfContentViewImpl sessionId="s1" filePath="a.pdf" />)
        await act(async () => { fireLoad(2) })

        // 默认 100%
        expect(screen.getByText('100%')).toBeInTheDocument()

        // 放大 → 120%
        fireEvent.click(screen.getByText('+'))
        expect(screen.getByText('120%')).toBeInTheDocument()

        // 点 100%（actualSize）→ 回 100%
        fireEvent.click(screen.getByText('files.actualSize'))
        expect(screen.getByText('100%')).toBeInTheDocument()
    })

    it('不崩溃（基线）', () => {
        render(<PdfContentViewImpl sessionId="s1" filePath="doc.pdf" />)
        expect(screen.getByTestId('pdf-document')).toBeInTheDocument()
    })

    it('I4: Document 收到 options.withCredentials=true（read-file 端点依赖 cookie）', () => {
        render(<PdfContentViewImpl sessionId="s1" filePath="a.pdf" />)
        const doc = screen.getByTestId('pdf-document')
        expect(doc.getAttribute('data-wc')).toBe('true')
    })

    it('I2: Document 收到 loading={null}（外层 Spin 独占加载态，避免双提示）', () => {
        render(<PdfContentViewImpl sessionId="s1" filePath="a.pdf" />)
        const doc = screen.getByTestId('pdf-document')
        expect(doc.getAttribute('data-loading')).toBe('null')
    })

    it('I3: handleLoadSuccess 同步读 DOM 宽度算 fit scale（绕过 ResizeObserver 竞态）', async () => {
        // mock containerRef.current.getBoundingClientRect 返回 1000，pageWidth=200
        // → fit = 1000/200 = 5 → clamp 到 MAX_SCALE=3 → 工具栏显示 300%
        // （PdfContinuousView 的 IntersectionObserver 在测试 mock 下不触发回调，
        //   Page 不渲染，故通过 PdfToolbar 百分比断言 scale 而非 data-scale）
        const orig = HTMLElement.prototype.getBoundingClientRect
        HTMLElement.prototype.getBoundingClientRect = function () {
            return this.style.flex ? { width: 1000, height: 800 } as DOMRect : orig.call(this)
        }
        render(<PdfContentViewImpl sessionId="s1" filePath="a.pdf" />)
        await act(async () => { fireLoad(1, 200, 200) })
        // 初始 scale=3（MAX_SCALE）→ 工具栏 300%
        expect(screen.getByText('300%')).toBeInTheDocument()
        HTMLElement.prototype.getBoundingClientRect = orig
    })
})
