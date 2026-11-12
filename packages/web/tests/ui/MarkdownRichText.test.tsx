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
 * composer wire → 气泡渲染（真实 x-markdown 管线）：
 * 下划线 `<u>` 不被 DOMPurify 剥除；GFM 表格渲染为 table；链接渲染为 a[href]。
 * 空白工作区场景，聚焦「发送后的消息能显示 composer 富文本」这条链路。
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'

// Popconfirm（rc resize-observer）依赖 ResizeObserver，jsdom 没有
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})
import { render, cleanup, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    useParams: () => ({ sessionId: 'sess-1' }),
}))

vi.mock('react-i18next', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        useTranslation: () => ({ t: (k: string) => k }),
    }
})

vi.mock('@/core/data/api/client', async (orig) => {
    const actual = await orig<typeof import('@/core/data/api/client')>()
    return {
        ...actual,
        useMobiApi: () => ({
            sessions: {
                get: async () => ({ data: { session: { id: 'sess-1', active: true } } }),
            },
        }),
    }
})

import { Markdown } from '@/ui/base/markdown/Markdown'

afterEach(cleanup)

describe('Markdown 富文本渲染（wire 输出可见）', () => {
    it('下划线 <u> 不被 sanitize 剥除', async () => {
        const { container } = render(<Markdown content={'<u>abc</u>'} />)
        await waitFor(() => {
            expect(container.querySelector('u')?.textContent).toBe('abc')
        })
    })

    it('GFM 表格渲染为 table', async () => {
        const { container } = render(
            <Markdown content={'| A | B |\n| - | - |\n| 1 | 2 |'} />,
        )
        await waitFor(() => {
            const table = container.querySelector('table')
            expect(table).toBeTruthy()
            expect(table!.textContent).toContain('A')
            expect(table!.textContent).toContain('1')
        })
    })

    it('链接渲染为 a[href]', async () => {
        const { container } = render(<Markdown content={'[mobi](https://example.com)'} />)
        await waitFor(() => {
            const anchor = container.querySelector('a[href="https://example.com"]')
            expect(anchor?.textContent).toBe('mobi')
        })
    })
})
