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
    beforeEach(() => { renderMock.mockClear() })

    it('code 变化触发 mermaid.render + 注入 svg', async () => {
        render(<MermaidDiagram code="graph TD; A-->B" />)
        await waitFor(() => expect(renderMock).toHaveBeenCalledWith(expect.any(String), 'graph TD; A-->B'))
        await waitFor(() => expect(document.querySelector('.mermaid-diagram')).toBeInTheDocument())
        await waitFor(() => expect(document.querySelector('.mock-svg')).toBeInTheDocument())
    })

    it('code 变化 → 重新 render', async () => {
        const { rerender } = render(<MermaidDiagram code="graph TD; A-->B" />)
        await waitFor(() => expect(renderMock).toHaveBeenCalledTimes(1))
        renderMock.mockClear()
        rerender(<MermaidDiagram code="sequenceDiagram; A->>B: x" />)
        await waitFor(() => expect(renderMock).toHaveBeenCalledWith(expect.any(String), 'sequenceDiagram; A->>B: x'))
    })
})
