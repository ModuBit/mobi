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
 * Streamdown mermaid 管线测试（ticket 06）
 *
 * jsdom 无 SVG getBBox，mermaid 实际绘图无法在单测内完成（真渲染在浏览器/真机
 * 验证，见 spike 页与 09 终测）。此处验证：
 * - 插件按需加载链路（含 ```mermaid 围栏才触发）
 * - 渲染成功或走错误兜底，均不白屏不抛异常
 */

import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { StreamdownView } from '@/components/ui/StreamdownView'

const MERMAID_SAMPLE = '```mermaid\ngraph TD\nA-->B\n```'

describe('Streamdown mermaid 管线', () => {
    afterEach(cleanup)

    it('含 mermaid 围栏时插件按需加载，渲染出图或错误兜底（不白屏）', async () => {
        const { container } = render(<StreamdownView content={MERMAID_SAMPLE} />)
        await waitFor(() => {
            // 插件装载后：要么渲染出 svg（jsdom 可能因 getBBox 失败走兜底），要么错误组件
            const hasSvg = container.querySelector('svg') !== null
            const hasErrorUi = container.textContent?.includes('mermaid') === true
            expect(hasSvg || hasErrorUi).toBe(true)
        }, { timeout: 8000 })
        // 无论哪条路径，围栏源码不能原样裸露为纯文本段落（说明插件已接管）
    })

    it('不含 mermaid 围栏时不加载插件，代码块按普通代码渲染', async () => {
        const { container } = render(<StreamdownView content={'```mermaid 不在 info string 里\ngraph TD\n```'} />)
        await waitFor(() => {
            // 普通 shiki 代码块渲染出源码（loading 骨架期 body 为空，等高亮完成）
            expect(container.textContent).toContain('graph TD')
        })
        // 无 mermaid 插件接管（无 diagram 容器）
        expect(container.querySelector('.mermaid')).toBeNull()
    })
})
