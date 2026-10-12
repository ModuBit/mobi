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
 * fenced ```openui → react-ui 渲染闭环规格（票 01）：
 * - openui fence 经 Markdown 的 code 分流进 OpenUIBlock，懒加载 chunk 落地后
 *   渲染官方 react-ui 组件（TextContent/表格/表单各覆盖）；
 * - 未知 lang 回落现状代码块（向后兼容）；
 * - 流式期间半截源码宽松渲染（悬空引用占位，不抛错）；
 * - 封口后结构化错误降级显示（块不移除）。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { streamingDisplayState } from '../helpers/streamingContentMock'
vi.mock('@/ui/useStreamingContent', async () =>
    (await import('../helpers/streamingContentMock')).streamingContentMock())

const { Markdown } = await import('@/ui/Markdown')

const SAMPLE = `root = Stack([title, tbl])
title = TextContent("拓扑语言", "large-heavy")
tbl = Table([Col("语言", langs), Col("用户 (M)", users)])
langs = ["Python", "JavaScript"]
users = [15.7, 14.2]`

const fenced = (body: string) => '```openui\n' + body + '\n```'

describe('fenced openui 渲染闭环', () => {
    afterEach(() => cleanup())

    it('openui fence 渲染为 react-ui 组件（文本 + 表格）', async () => {
        streamingDisplayState.current = fenced(SAMPLE)
        const { container } = render(<Markdown content={fenced(SAMPLE)} />)

        // 懒加载 chunk 异步落地，findBy 等 Suspense resolve
        expect(await screen.findByText('拓扑语言')).toBeInTheDocument()
        expect(await screen.findByText('Python')).toBeInTheDocument()
        expect(container.querySelector('.openui-block')).toBeInTheDocument()
    })

    it('官方 openui-lang 标签同路径渲染（catalog prompt inlineMode 教的标签）', async () => {
        const content = '```openui-lang\n' + SAMPLE + '\n```'
        streamingDisplayState.current = content
        const { container } = render(<Markdown content={content} />)

        expect(await screen.findByText('拓扑语言')).toBeInTheDocument()
        expect(container.querySelector('.openui-block')).toBeInTheDocument()
    })

    it('未知 lang 回落现状代码块（向后兼容）', async () => {
        streamingDisplayState.current = '```ts\nconst a = 1\n```'
        const { container } = render(<Markdown content={'```ts\nconst a = 1\n```'} />)

        // AutoDetectCodeBlock 异步高亮，等 code 元素出现
        await screen.findByText(/const a = 1/)
        expect(container.querySelector('.openui-block')).toBeNull()
    })

    it('流式期间半截源码宽松渲染，不抛错', async () => {
        // 悬空引用 + 未闭合括号：streaming parser 应容忍并渐进渲染
        const partial = 'root = Stack([title, tbl])\ntitle = TextContent("流式标题"'
        streamingDisplayState.current = fenced(partial)
        render(<Markdown content={fenced(partial)} streaming />)

        expect(await screen.findByText('流式标题')).toBeInTheDocument()
        expect(screen.queryByText(/无效语句/)).not.toBeInTheDocument()
    })

    it('封口后结构化错误降级显示（块不移除）', async () => {
        // UnknownComp 不在 catalog 且被引用进树：封口后 onError 给结构化错误 → 内联警示
        const broken = `root = Stack([title, bad])
title = TextContent("拓扑语言", "large-heavy")
bad = UnknownComp("x")`
        streamingDisplayState.current = fenced(broken)
        const { container } = render(<Markdown content={fenced(broken)} />)

        expect(await screen.findByText(/无效语句已被忽略/)).toBeInTheDocument()
        // 块本身保留
        expect(container.querySelector('.openui-block')).toBeInTheDocument()
    })
})
