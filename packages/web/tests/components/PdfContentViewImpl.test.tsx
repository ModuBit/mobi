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
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import PdfContentViewImpl from '@/components/files/PdfContentViewImpl'

// react-pdf 在 jsdom 下无法真正渲染，mock 成受控占位：
// - Document 把 onLoadSuccess 暴露出来，测试调用注入 numPages
// - Page 渲染当前 pageNumber/scale（data-* 便于断言）
let onLoadSuccessCb: ((pdf: { numPages: number }) => void) | null = null
vi.mock('react-pdf', () => ({
    pdfjs: { GlobalWorkerOptions: { workerSrc: '' }, version: '0.0.0' },
    Document: ({ children, onLoadSuccess }: {
        children: React.ReactNode
        onLoadSuccess?: (pdf: { numPages: number }) => void
    }) => {
        // 暴露回调供测试触发（注入 numPages=3）
        onLoadSuccessCb = onLoadSuccess ?? null
        return <div data-testid="pdf-document">{children}</div>
    },
    Page: ({ pageNumber, scale }: { pageNumber: number; scale: number }) => (
        <div data-testid="pdf-page" data-page={pageNumber} data-scale={scale} />
    ),
}))
vi.mock('react-pdf/dist/Page/AnnotationLayer.css', () => ({}))
vi.mock('react-pdf/dist/Page/TextLayer.css', () => ({}))

afterEach(() => {
    cleanup()
    onLoadSuccessCb = null
})

describe('PdfContentViewImpl', () => {
    it('blob 转 Uint8Array 后渲染 Document/Page 默认第 1 页 scale=1', async () => {
        render(<PdfContentViewImpl blob={new Blob(['%PDF-1.4'], { type: 'application/pdf' })} filePath="doc.pdf" />)
        // blob.arrayBuffer() 异步：await Document 渲染
        expect(await screen.findByTestId('pdf-document')).toBeInTheDocument()
        // 触发 onLoadSuccess 注入 numPages=3
        onLoadSuccessCb?.({ numPages: 3 })
        // 页码显示 1 / 3
        expect(await screen.findByText('1 / 3')).toBeInTheDocument()
        // Page 默认第 1 页、scale=1
        const page = screen.getByTestId('pdf-page')
        expect(page).toHaveAttribute('data-page', '1')
        expect(page).toHaveAttribute('data-scale', '1')
    })

    it('下一页/上一页翻页 + 边界禁用', async () => {
        render(<PdfContentViewImpl blob={new Blob(['%PDF'], { type: 'application/pdf' })} filePath="doc.pdf" />)
        await screen.findByTestId('pdf-document')
        onLoadSuccessCb?.({ numPages: 3 })
        expect(await screen.findByText('1 / 3')).toBeInTheDocument()

        // 初始：上一页禁用（第 1 页），下一页可用
        const prevBtn = screen.getByText('上一页').closest('button')!
        const nextBtn = screen.getByText('下一页').closest('button')!
        expect(prevBtn).toBeDisabled()
        expect(nextBtn).not.toBeDisabled()

        // 点下一页 → 第 2 页
        fireEvent.click(nextBtn)
        expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '2')

        // 再下一页 → 第 3 页（末页，下一页禁用）
        fireEvent.click(screen.getByText('下一页'))
        expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '3')
        expect(screen.getByText('下一页').closest('button')).toBeDisabled()

        // 点上一页 → 回第 2 页
        fireEvent.click(screen.getByText('上一页'))
        expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-page', '2')
    })

    it('缩放 +/- 步进 0.2、边界 0.5~3、显示百分比', async () => {
        render(<PdfContentViewImpl blob={new Blob(['%PDF'], { type: 'application/pdf' })} filePath="doc.pdf" />)
        await screen.findByTestId('pdf-document')
        onLoadSuccessCb?.({ numPages: 1 })

        // 初始 100%
        expect(screen.getByText('100%')).toBeInTheDocument()
        const minus = screen.getByText('-').closest('button')!
        const plus = screen.getByText('+').closest('button')!

        // + → 120%
        fireEvent.click(plus)
        expect(screen.getByText('120%')).toBeInTheDocument()
        expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-scale', '1.2')

        // - 两次 → 回 80%
        fireEvent.click(minus)
        fireEvent.click(minus)
        expect(screen.getByText('80%')).toBeInTheDocument()
    })

    it('缩放上限 3 / 下限 0.5（连续点击不越界）', async () => {
        render(<PdfContentViewImpl blob={new Blob(['%PDF'], { type: 'application/pdf' })} filePath="doc.pdf" />)
        await screen.findByTestId('pdf-document')
        onLoadSuccessCb?.({ numPages: 1 })

        const plus = screen.getByText('+').closest('button')!
        // 连续点 + 11 次（1.0 → 3.0 封顶）
        for (let i = 0; i < 11; i++) fireEvent.click(plus)
        expect(screen.getByText('300%')).toBeInTheDocument()
        expect(plus).toBeDisabled()
        expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-scale', '3')

        const minus = screen.getByText('-').closest('button')!
        // 连续点 - 13 次（3.0 → 0.5 封顶）
        for (let i = 0; i < 13; i++) fireEvent.click(minus)
        expect(screen.getByText('50%')).toBeInTheDocument()
        expect(minus).toBeDisabled()
        expect(screen.getByTestId('pdf-page')).toHaveAttribute('data-scale', '0.5')
    })
})
