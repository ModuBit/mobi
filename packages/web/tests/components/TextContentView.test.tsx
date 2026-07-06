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

vi.mock('@/components/files/CodeHighlight', () => ({
    default: ({ code }: { code: string }) => <div data-testid="tc-highlight">{code}</div>,
}))

const TextContentView = (await import('@/components/files/TextContentView')).default

describe('TextContentView', () => {
    it('高亮分支：外层包 .text-content-view 容器（承载 padding）', () => {
        const { container, getByTestId } = render(
            <TextContentView text="hi" filePath="a.ts" highlight />,
        )
        expect(container.querySelector('.text-content-view')).toBeInTheDocument()
        expect(getByTestId('tc-highlight')).toBeInTheDocument()
    })

    it('非高亮分支：同样包 .text-content-view 容器', () => {
        const { container } = render(
            <TextContentView text="hi" filePath="a.txt" highlight={false} />,
        )
        expect(container.querySelector('.text-content-view')).toBeInTheDocument()
        // 纯 pre 仍在（不再自带 padding，由外层管）
        expect(container.querySelector('pre')).toBeInTheDocument()
    })
})
