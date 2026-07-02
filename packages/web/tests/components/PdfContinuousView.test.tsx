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
import '@testing-library/jest-dom/vitest'
import { render, cleanup, act } from '@testing-library/react'
import PdfContinuousView from '@/components/files/PdfContinuousView'

// react-pdf mock：Page 渲染 data-testid + data-page + data-scale，便于断言
vi.mock('react-pdf', () => ({
    Page: ({ pageNumber, scale }: { pageNumber: number; scale: number }) => (
        <div data-testid={`pdf-page-${pageNumber}`} data-page={pageNumber} data-scale={scale} />
    ),
}))
vi.mock('react-pdf/dist/Page/AnnotationLayer.css', () => ({}))
vi.mock('react-pdf/dist/Page/TextLayer.css', () => ({}))

// IntersectionObserver mock —— jsdom 原生无此 API，必须 stubGlobal
// 暴露 callback 供测试主动触发；记录被 observe 的元素
type IOEntry = { target: Element; isIntersecting: boolean }
let ioCallback: ((entries: IOEntry[]) => void) | null = null
const observedEls: Element[] = []

beforeEach(() => {
    ioCallback = null
    observedEls.length = 0
    vi.stubGlobal('IntersectionObserver', class {
        constructor(cb: (entries: IOEntry[]) => void) {
            ioCallback = cb
        }
        observe(el: Element) { observedEls.push(el) }
        unobserve() {}
        disconnect() {}
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
})

/** 测试 helper：触发某页占位进入/离开可视区（act 包裹，确保 React 同步刷新状态） */
function triggerPageVisible(pageNumber: number, isIntersecting: boolean) {
    const el = document.querySelector(`[data-placeholder="${pageNumber}"]`)
    if (el && ioCallback) {
        act(() => {
            ioCallback!([{ target: el, isIntersecting }])
        })
    }
}

describe('PdfContinuousView', () => {
    it('渲染 N 个占位 div，初始无 Page（IO 未触发可见）', () => {
        render(<PdfContinuousView numPages={3} pageWidth={595} pageHeight={842} previewScale={1} renderScale={1} />)

        // 3 个占位
        const placeholders = document.querySelectorAll('[data-placeholder]')
        expect(placeholders.length).toBe(3)
        // data-placeholder 值为页码 1/2/3
        expect(placeholders[0]).toHaveAttribute('data-placeholder', '1')
        expect(placeholders[2]).toHaveAttribute('data-placeholder', '3')

        // IO 已对全部 3 个占位 observe（验证 observe 时机无遗漏）
        expect(observedEls.length).toBe(3)

        // 初始 IO 未触发 → 无 Page 渲染
        expect(document.querySelector('[data-testid="pdf-page-1"]')).not.toBeInTheDocument()
        expect(document.querySelector('[data-testid="pdf-page-2"]')).not.toBeInTheDocument()
        expect(document.querySelector('[data-testid="pdf-page-3"]')).not.toBeInTheDocument()
    })

    it('占位进入可视区 → 渲染 Page；离开 → 卸载', () => {
        render(<PdfContinuousView numPages={3} pageWidth={595} pageHeight={842} previewScale={1} renderScale={1} />)

        // 初始无 page-1
        expect(document.querySelector('[data-testid="pdf-page-1"]')).not.toBeInTheDocument()

        // page-1 进入可视区 → 渲染
        triggerPageVisible(1, true)
        const page1 = document.querySelector('[data-testid="pdf-page-1"]')
        expect(page1).toBeInTheDocument()
        expect(page1).toHaveAttribute('data-page', '1')
        expect(page1).toHaveAttribute('data-scale', '1')

        // page-1 离开可视区 → 卸载（释放 canvas 内存）
        triggerPageVisible(1, false)
        expect(document.querySelector('[data-testid="pdf-page-1"]')).not.toBeInTheDocument()
    })

    it('占位高度随 previewScale 变化（previewScale=2 → 1684px）', () => {
        render(<PdfContinuousView numPages={1} pageWidth={595} pageHeight={842} previewScale={2} renderScale={1} />)

        const placeholder = document.querySelector('[data-placeholder="1"]') as HTMLElement
        expect(placeholder).toBeInTheDocument()
        // 高度 = pageHeight * previewScale = 842 * 2 = 1684px
        expect(placeholder.style.height).toContain('1684')
    })

    it('transform 补偿：previewScale=2 renderScale=1 → wrapper scale(2) + origin top left，Page scale=1', () => {
        render(<PdfContinuousView numPages={1} pageWidth={595} pageHeight={842} previewScale={2} renderScale={1} />)

        // 先让 page-1 进入可视区，触发 Page 渲染
        triggerPageVisible(1, true)

        // Page 渲染且 scale=renderScale=1（pdfjs 实际渲染缩放）
        const page = document.querySelector('[data-testid="pdf-page-1"]')
        expect(page).toBeInTheDocument()
        expect(page).toHaveAttribute('data-scale', '1')

        // Page 外层 wrapper 有 transform: scale(previewScale/renderScale) = scale(2)
        const wrapper = page!.parentElement as HTMLElement
        expect(wrapper.style.transform).toBe('scale(2)')
        // transformOrigin 必须是 top left（否则缩放偏移）
        expect(wrapper.style.transformOrigin).toBe('top left')
    })
})
