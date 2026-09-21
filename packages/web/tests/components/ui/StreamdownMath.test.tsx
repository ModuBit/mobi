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
 * Streamdown math 管线契约测试（真实渲染管线，不 mock streamdown）
 *
 * 平移旧栈 latexPlugin 契约的行为断言：行内 $ 不跨行、fenced code 内 $ 不算公式、
 * 自研定界 \(...\) / \[...\] 经归一后可渲染、mathEnabled 关闭时不渲染。
 */

import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { StreamdownView } from '@/components/ui/StreamdownView'

describe('StreamdownView math 管线', () => {
    afterEach(cleanup)

    async function renderAndGetKatex(content: string, mathEnabled = true) {
        render(<StreamdownView content={content} mathEnabled={mathEnabled} />)
        await waitFor(() => {
            // math 插件是懒加载（动态 import），等一次微任务链走完
            expect(document.querySelector('.katex, .katex-display, [class*="math"]')).toBeTruthy()
        }, { timeout: 3000 })
        return document.querySelectorAll('.katex').length
    }

    it('行内 $...$ 渲染为 katex', async () => {
        expect(await renderAndGetKatex('质能方程 $E=mc^2$ 可知')).toBeGreaterThan(0)
    })

    it('块级 $$...$$ 渲染为 katex display', async () => {
        render(<StreamdownView content={'$$\nE=mc^2\n$$'} mathEnabled />)
        await screen.findAllByText(/E=mc/, { selector: '.katex *' }, { timeout: 3000 })
        expect(document.querySelector('.katex-display')).toBeTruthy()
    })

    it('自研 \\(...\\) 定界经归一后渲染', async () => {
        expect(await renderAndGetKatex('质能方程 \\(E=mc^2\\) 可知')).toBeGreaterThan(0)
    })

    it('自研 \\[...\\] 块级定界经归一后渲染', async () => {
        render(<StreamdownView content={'\\[\\frac{a}{b}\\]'} mathEnabled />)
        await waitFor(() => {
            expect(document.querySelector('.katex-display')).toBeTruthy()
        }, { timeout: 3000 })
    })

    it('行内 $ 不跨行（旧栈核心修复平移）：跨行 $ 对不算公式', async () => {
        render(<StreamdownView content={'$0.2290\nsome text\n$'} mathEnabled />)
        // 无公式可渲染：懒加载根本不该触发（内容探测不出公式特征也会因直接传 mathEnabled 而触发，
        // 这里断言的是 remark-math 不会把跨行 $ 对解析成公式）
        await new Promise((r) => setTimeout(r, 50))
        expect(document.querySelector('.katex')).toBeNull()
    })

    it('fenced code 内的 $ 不算公式', async () => {
        render(<StreamdownView content={'```bash\necho $HOME\n```'} mathEnabled />)
        await new Promise((r) => setTimeout(r, 50))
        expect(document.querySelector('.katex')).toBeNull()
    })

    it('mathEnabled 关闭时不加载 math 插件，公式保持原文', async () => {
        render(<StreamdownView content="公式 $E=mc^2$ 原文" mathEnabled={false} />)
        await new Promise((r) => setTimeout(r, 50))
        expect(document.querySelector('.katex')).toBeNull()
        expect(screen.getByText(/E=mc\^2/)).toBeInTheDocument()
    })
})
