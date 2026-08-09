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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, waitFor } from '@testing-library/react'
import { resetMermaidCache } from '@/components/files/mermaidRender'

// mock mermaid（懒加载动态 import 也被拦截）
const renderMock = vi.fn(async (_id: string, _code: string) => ({ svg: '<svg class="mock-svg">mock</svg>' }))
vi.mock('mermaid', () => ({
    default: {
        initialize: vi.fn(),
        render: renderMock,
    },
}))

import { MermaidDiagram } from '@/components/ui/MermaidDiagram'

describe('MermaidDiagram', () => {
    // svg 缓存是模块级，跨用例残留会令后续用例命中缓存不触发 render；每例前清空
    beforeEach(() => { renderMock.mockClear(); resetMermaidCache() })

    it('code 变化触发 mermaid.render + 以 <img> data URL 注入 svg（不进内联 DOM）', async () => {
        // 性能关键：mermaid 输出的 SVG 动辄上千 DOM 节点，若内联进 ProseMirror 文档，
        // 每次事务的 view.update 扫过大 SVG 子树会卡死（移动端尤甚）。
        // 故渲染成单个 <img>（src=svg data URL），把上千节点压成 1 个。
        render(<MermaidDiagram code="graph TD; A-->B" />)
        await waitFor(() => expect(renderMock).toHaveBeenCalledWith(expect.any(String), 'graph TD; A-->B'))

        const img = await waitFor(() => {
            const el = document.querySelector('img.mermaid-diagram') as HTMLImageElement | null
            expect(el).not.toBeNull()
            return el!
        })
        // src 是 svg data URL，且包含 mermaid 渲染出的 svg 内容
        const src = img.getAttribute('src') ?? ''
        expect(src.startsWith('data:image/svg+xml')).toBe(true)
        expect(src).toContain('mock-svg')
        // 关键不变量：原始 SVG 不再作为内联 DOM 子树存在
        expect(document.querySelector('svg.mock-svg')).toBeNull()
    })

    it('code 变化 → 重新 render', async () => {
        const { rerender } = render(<MermaidDiagram code="graph TD; A-->B" />)
        await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1))
        renderMock.mockClear()
        rerender(<MermaidDiagram code="sequenceDiagram; A->>B: x" />)
        await waitFor(() => expect(renderMock).toHaveBeenCalledWith(expect.any(String), 'sequenceDiagram; A->>B: x'))
    })
})
