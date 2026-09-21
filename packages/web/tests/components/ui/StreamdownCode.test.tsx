/*
 * Copyright Manerfan
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
 * Streamdown 代码块管线契约测试（ticket 07，真实渲染管线，不 mock streamdown）
 *
 * 验证 shiki 双主题插件 + mobi 语言检测适配器的渲染链路：
 * - 显式 lang 直接 shiki 着色 + 内建 copy 按钮（controls.code.copy）
 * - 无 lang 走 detectLanguage 自动检测（适配器契约）
 * - 不支持的语言名不崩溃、源码保留（插件内部 text 兜底）
 * - 流式中未闭合围栏渲染为代码块结构（ticket 01 期移除的超前用例在此以新栈
 *   形态回归；新栈为未闭合块渐进着色，与旧栈「裸 pre/code」形态不同，见 ticket 偏差记录）
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { StreamdownView } from '@/components/ui/StreamdownView'
import { detectLanguage } from '@/core/utils/codeLanguageDetect'

// 监视检测调用（实现透传）：锁定「无 lang 围栏触发自动检测」的适配器契约
vi.mock('@/core/utils/codeLanguageDetect', async (orig) => {
    const actual = await orig<typeof import('@/core/utils/codeLanguageDetect')>()
    return { ...actual, detectLanguage: vi.fn(actual.detectLanguage) }
})

/** 等待 shiki 着色完成（着色 span 带内联 color） */
async function waitForHighlighted(container: HTMLElement) {
    await waitFor(
        () => {
            const colored = container.querySelectorAll('[data-streamdown="code-block-body"] span[style*="--sdm-c"]')
            expect(colored.length).toBeGreaterThan(0)
        },
        { timeout: 10_000 },
    )
}

describe('Streamdown 代码块管线', () => {
    afterEach(() => {
        cleanup()
        vi.mocked(detectLanguage).mockClear()
    })

    it('显式 lang 直接 shiki 着色，copy 按钮随 controls 展示', async () => {
        const { container } = render(<StreamdownView content={'```js\nconst a = 1\n```'} />)
        await waitForHighlighted(container)
        expect(container.querySelector('[data-streamdown="code-block"]')?.getAttribute('data-language')).toBe('js')
        expect(container.querySelector('[data-streamdown="code-block-actions"] button')).toBeTruthy()
        // 不支持的伪装语言不应出现（插件接管了渲染）
        expect(container.textContent).not.toContain('```')
    })

    it('无 lang 围栏触发 detectLanguage 自动检测并完成着色', async () => {
        const code = 'def greet(name):\n    return f"hello {name}"'
        const { container } = render(<StreamdownView content={'```\n' + code + '\n```'} />)
        await waitForHighlighted(container)
        // 检测适配器被调用（先兜底着色、检测完成后刷新，均为官方缓存机制内的正常调用）
        await waitFor(() => expect(vi.mocked(detectLanguage)).toHaveBeenCalled())
        expect(container.textContent).toContain('greet')
    })

    it('不支持的显式语言名不崩溃，源码保留（插件 text 兜底）', async () => {
        const { container } = render(<StreamdownView content={'```notalang\nplain text here\n```'} />)
        await waitFor(() => {
            expect(container.querySelector('[data-streamdown="code-block"]')).toBeTruthy()
        })
        expect(container.textContent).toContain('plain text here')
    })

    it('流式中未闭合围栏渲染为代码块结构（闭合后保持一致）', async () => {
        const open = render(<StreamdownView content={'```js\nconst a = 1'} />)
        await waitFor(() => {
            expect(open.container.querySelector('[data-streamdown="code-block"]')).toBeTruthy()
        })
        expect(open.container.textContent).toContain('const a = 1')
        cleanup()

        const closed = render(<StreamdownView content={'```js\nconst a = 1\n```'} />)
        await waitFor(() => {
            expect(closed.container.querySelector('[data-streamdown="code-block"]')).toBeTruthy()
        })
        expect(closed.container.textContent).toContain('const a = 1')
    })
})
