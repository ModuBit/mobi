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
 * Streamdown 脚注管线契约测试（真实渲染管线，不 mock streamdown）
 *
 * extractFootnotes 预处理契约由 footnotePlugin.test.ts 承载（双栈共用同一函数，
 * 无需平移）；此处验证新栈渲染链路：定义不进正文、引用渲染为 FootnoteRef、
 * 尾部 FootnoteSources 集中渲染、remark-gfm 内置脚注解析无双重消费。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// i18n 直返 key；partial mock——真实 react-i18next 需保留（uiStore→i18n 初始化链依赖它）
vi.mock('react-i18next', async (orig) => ({
    ...(await orig<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key }),
}))

import { Markdown } from '@/components/ui/Markdown'
import { setMarkdownRenderer } from '@/core/lib/markdownRenderer'

const FOOTNOTE_SAMPLE = [
    '正文引用[^1]与第二处[^2]。',
    '',
    '[^1]: [参考标题](https://example.com) 额外描述',
    '[^2]: 纯文本脚注',
].join('\n')

describe('Streamdown 脚注管线', () => {
    afterEach(() => {
        cleanup()
        localStorage.clear()
        setMarkdownRenderer('x-markdown')
        vi.restoreAllMocks()
    })

    /** flag 侧渲染（lazy chunk 异步解析，等待容器挂载） */
    async function renderFlagOn(content: string) {
        setMarkdownRenderer('streamdown')
        const { container } = render(<Markdown content={content} />)
        await waitFor(() => expect(container.querySelector('.streamdown-md')).toBeTruthy())
        return container
    }

    it('脚注定义不出现在正文，引用渲染为 FootnoteRef（sup.footnote-ref）', async () => {
        const container = await renderFlagOn(FOOTNOTE_SAMPLE)
        // 定义行被清洗，正文不再含 [^1]:
        expect(container.querySelector('.streamdown-md')!.textContent).not.toContain('[^1]:')
        // remark-gfm 内置脚注解析未双重消费：无 gfm 脚注锚点（#user-content-fn- 开头链接）
        expect(container.innerHTML).not.toContain('user-content-fn')
        // 引用位置渲染 FootnoteRef（sup.footnote-ref + antd Tag）
        expect(container.querySelectorAll('sup.footnote-ref').length).toBe(2)
    })

    it('脚注集中渲染于消息尾部 FootnoteSources（标题/描述齐备）', async () => {
        await renderFlagOn(FOOTNOTE_SAMPLE)
        expect(screen.getByText('chat.footnoteSources')).toBeInTheDocument()
        // Sources 条目内容（标题/描述会被 antd 内部结构拆分元素，用 textContent 断言）
        const bodyText = document.body.textContent ?? ''
        expect(bodyText).toContain('1. 参考标题')
        expect(bodyText).toContain('2. 纯文本脚注')
        // description 的展示由 FootnoteSources（双栈同一组件，antd Sources 内部结构）决定，不在此断言
    })

    it('无脚注内容不受影响（wrapFootnoteRefs 快速路径）', async () => {
        const container = await renderFlagOn('普通 **正文**，含 [^ 与 ]: 的碎片文本')
        expect(container.querySelector('sup.footnote-ref')).toBeNull()
        expect(screen.queryByText('chat.footnoteSources')).not.toBeInTheDocument()
    })

    it('code 区段内的伪脚注引用不转换为 FootnoteRef', async () => {
        const container = await renderFlagOn('```md\n[^9]: not a ref [^9]\n```\n正文 [^9]: 也不算——围栏内整行被掩码')
        // 围栏内的 [^9] 保留原文（掩码保护），不产生 FootnoteRef
        const codeEl = container.querySelector('pre, code')
        expect(codeEl?.textContent).toContain('[^9]')
    })

    it('流式增长时 FootnoteSources 稳定复渲染（Map 引用稳定机制在分发层）', async () => {
        setMarkdownRenderer('streamdown')
        const { rerender, container } = render(<Markdown content={'正文[^1]'} streaming />)
        await waitFor(() => expect(container.querySelector('.streamdown-md')).toBeTruthy())
        rerender(<Markdown content={'正文[^1]\n\n[^1]: 标题 https://example.com'} streaming />)
        expect(await screen.findByText('1. 标题')).toBeInTheDocument()
        expect(document.querySelectorAll('sup.footnote-ref').length).toBe(1)
    })
})
