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
vi.mock('react-pdf', async () => {
    const { useLayoutEffect } = await import('react')
    return {
        // Page mount/scale 变后调 onRenderSuccess（模拟 pdfjs 渲染完成，触发双缓冲切层）
        Page: ({ pageNumber, scale, onRenderSuccess }: { pageNumber: number; scale: number; onRenderSuccess?: () => void }) => {
            useLayoutEffect(() => { onRenderSuccess?.() }, [scale])
            return <div data-testid={`pdf-page-${pageNumber}`} data-page={pageNumber} data-scale={scale} />
        },
    }
})
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
        render(<PdfContinuousView numPages={3} pageHeight={842} previewScale={1} renderScale={1} />)

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
        render(<PdfContinuousView numPages={3} pageHeight={842} previewScale={1} renderScale={1} />)

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

    it('占位高度随 previewScale 变化（容器 --page-h = 1684px，占位 height 用 var）', () => {
        render(<PdfContinuousView numPages={1} pageHeight={842} previewScale={2} renderScale={1} />)

        const placeholder = document.querySelector('[data-placeholder="1"]') as HTMLElement
        expect(placeholder).toBeInTheDocument()
        // 占位高度用 CSS 变量（previewScale 变时只更新容器一处，N 占位通过 var 读取，浏览器 O(1) layout）
        expect(placeholder.style.height).toBe('var(--page-h)')
        // 容器 --page-h = pageHeight * previewScale = 842 * 2 = 1684px
        const container = placeholder.parentElement as HTMLElement
        expect(container.style.getPropertyValue('--page-h')).toContain('1684')
    })

    it('transform 补偿 + 居中：previewScale=2 renderScale=1 → 内层 scale(2) origin top center，外层 flex 居中，Page scale=1', () => {
        render(<PdfContinuousView numPages={1} pageHeight={842} previewScale={2} renderScale={1} />)

        // 先让 page-1 进入可视区，触发 Page 渲染
        triggerPageVisible(1, true)

        // Page 渲染且 scale=renderScale=1（pdfjs 实际渲染缩放）
        const page = document.querySelector('[data-testid="pdf-page-1"]')
        expect(page).toBeInTheDocument()
        expect(page).toHaveAttribute('data-scale', '1')

        // 内层 wrapper：transform: scale(previewScale/renderScale) = scale(2)，origin top center
        // （居中：以顶部中心为锚缩放，水平居中在缩放后保持）
        const inner = page!.parentElement as HTMLElement
        expect(inner.style.transform).toBe('scale(2)')
        expect(inner.style.transformOrigin).toBe('top center')

        // 外层 wrapper：absolute 撑满占位 + flex 水平居中 + 顶部对齐（把 Page canvas 居中）
        const outer = inner.parentElement as HTMLElement
        expect(outer.style.display).toBe('flex')
        expect(outer.style.justifyContent).toBe('center')
        expect(outer.style.alignItems).toBe('flex-start')
        expect(outer.style.position).toBe('absolute')
    })

    it('numPages 变化（切 PDF）→ visible 清空，旧可见页卸载', () => {
        const { rerender } = render(<PdfContinuousView numPages={2} pageHeight={842} previewScale={1} renderScale={1} />)
        triggerPageVisible(1, true)
        expect(document.querySelector('[data-testid="pdf-page-1"]')).toBeInTheDocument()
        rerender(<PdfContinuousView numPages={3} pageHeight={842} previewScale={1} renderScale={1} />)
        // visible 被 useEffect(numPages) 清空 → page-1 卸载（直到新 IO 触发），避免旧页码残留越界
        expect(document.querySelector('[data-testid="pdf-page-1"]')).not.toBeInTheDocument()
    })

    it('双缓冲：renderScale 变 → 叠加新层渲染、旧层保持；新层 ready → 旧层移除（canvas 不重建无闪）', () => {
        const { rerender } = render(<PdfContinuousView numPages={1} pageHeight={842} previewScale={1} renderScale={1} />)
        triggerPageVisible(1, true)
        // 初始单层 scale=1
        expect(document.querySelectorAll('[data-page="1"]').length).toBe(1)
        expect(document.querySelector('[data-page="1"]')).toHaveAttribute('data-scale', '1')

        // renderScale 1→2：PdfPage 叠加新层（scale=2）渲染；新层 onRenderSuccess 后移除旧层
        // （新层 position absolute→relative，react-pdf Page scale 未变 → canvas 不重建 → 无空白闪屏）
        rerender(<PdfContinuousView numPages={1} pageHeight={842} previewScale={2} renderScale={2} />)
        expect(document.querySelectorAll('[data-page="1"]').length).toBe(1) // 仅新层（scale=2），旧层已移除
        expect(document.querySelector('[data-page="1"]')).toHaveAttribute('data-scale', '2')
    })
})
