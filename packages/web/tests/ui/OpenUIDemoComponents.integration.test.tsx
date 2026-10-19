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
 * 自定义组件渲染规格（票 03）：Chart / Svg 图元 / HtmlView 经 mobiLibrary 挂载后
 * - 挂载不抛错（未知组件在 react-lang 侧会整条丢弃，这里是「真的注册上了」的回归）；
 * - 关键交互回调可达（散点 hover → tooltip）；
 * - HtmlView 的安全基线不被移植改坏（opaque origin + connect-src 'none'）。
 *
 * seam：直接渲染 OpenUIRenderer（与生产同一条 Renderer + mobiLibrary 装配），
 * 不做组件级单测——挂载问题的根因在库注册，不在视图函数。
 */

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { streamingDisplayState } from '../helpers/streamingContentMock'
vi.mock('@/ui/shared/useStreamingContent', async () =>
    (await import('../helpers/streamingContentMock')).streamingContentMock())

const OpenUIRenderer = (await import('@/ui/openui/OpenUIRenderer')).default

beforeAll(() => {
    // jsdom 无布局：Chart 用 ResizeObserver + clientWidth 测宽，给非零宽度才走到真图表
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get: () => 480,
    })
})

afterEach(() => cleanup())

function renderCode(code: string) {
    streamingDisplayState.current = code
    return render(<OpenUIRenderer code={code} streaming={false} />)
}

describe('Chart（票 03）', () => {
    const BAR = `root = Stack([chart])
chart = Chart("bar", rows, "k", ["v"])
rows = [{"k": "A", "v": 10}, {"k": "B", "v": 20}]`

    it('挂载不抛错：柱状图画出两根柱与轴标签', () => {
        const { container } = renderCode(BAR)
        const svg = container.querySelector('.iui-chart svg')
        expect(svg).not.toBeNull()
        // 2 根柱 + hover 底块（无 hover 时不画）
        expect(container.querySelectorAll('.iui-chart svg rect').length).toBeGreaterThanOrEqual(2)
        expect(screen.getByText('A')).toBeInTheDocument()
        expect(screen.getByText('B')).toBeInTheDocument()
    })

    it('散点 hover 回调可达：指针进入点 → tooltip 显示系列名与值', () => {
        const SCATTER = `root = Stack([chart])
chart = Chart("scatter", rows, "x", ["y"])
rows = [{"x": 1, "y": 10}, {"x": 2, "y": 20}]`
        const { container } = renderCode(SCATTER)
        const dot = container.querySelector('.iui-chart svg circle')
        expect(dot).not.toBeNull()
        fireEvent.pointerEnter(dot!)
        // tooltip 里出现系列名（单系列时 strong 由第一个文本键回退为系列名）
        expect(container.querySelector('.iui-chart-tooltip')).not.toBeNull()
        expect(container.querySelector('.iui-chart-tooltip')!.textContent).toContain('y')
    })
})

describe('Svg 图元（票 03）', () => {
    const DRAWING = `root = Svg([box, dot, caption], "0 0 240 160")
box = Rect(10, 10, 100, 40, "surface", "ink", 2)
dot = Circle(20, 20, 4, "chart1")
caption = SvgText("步骤 1", 20, 80, 12, "muted")`

    it('挂载不抛错：容器 + 图元 + 文本都进 DOM', () => {
        const { container } = renderCode(DRAWING)
        expect(container.querySelector('svg.iui-svg')).not.toBeNull()
        expect(container.querySelector('rect')).not.toBeNull()
        expect(container.querySelector('circle')).not.toBeNull()
        expect(screen.getByText('步骤 1')).toBeInTheDocument()
    })

    it('颜色 token 投到主题变量（chart1 → --mobi-chart-1）', () => {
        const { container } = renderCode(DRAWING)
        expect(container.querySelector('circle')!.getAttribute('fill')).toBe('var(--mobi-chart-1)')
        expect(container.querySelector('rect')!.getAttribute('fill')).toBe('var(--iui-surface)')
    })

    it('危险值被丢弃：url() 填充不落到 DOM', () => {
        const code = `root = Svg([r], "0 0 10 10")
r = Rect(0, 0, 5, 5, "url(https://evil.example/x)", "ink")`
        const { container } = renderCode(code)
        expect(container.querySelector('rect')!.getAttribute('fill')).toBe('none')
    })
})

describe('HtmlView（票 03）', () => {
    it('挂载不抛错：opaque origin 沙箱 + mobi CSP 底线', () => {
        const code = `root = HtmlView("<p>hi</p>", 200, "demo")`
        const { container } = renderCode(code)
        const frame = container.querySelector('iframe')
        expect(frame).not.toBeNull()
        expect(frame!.getAttribute('sandbox')).toBe('allow-scripts')
        const srcDoc = frame!.getAttribute('srcdoc') ?? ''
        expect(srcDoc).toContain("connect-src 'none'")
        expect(srcDoc).toContain("script-src 'unsafe-inline' https:")
        expect(srcDoc).toContain('<p>hi</p>')
    })
})
