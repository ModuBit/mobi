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
 * CustomBlockView 渲染测试（ADR 0002 两级注册：block.type 分发 + ref.targetType 注册表）：
 * text 直出、ref(session) 标题实时取 + 点击跳转、parent 已删降级灰文本、未注册 targetType 跳过。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// ============ useMobiApi mock（必须返回稳定引用，否则 effect 无限循环 OOM——项目已知坑） ============

const sessionsGet = vi.hoisted(() => vi.fn())
const mockApi = {
    sessions: { get: sessionsGet },
    visibility: { report: vi.fn().mockResolvedValue(undefined) },
}
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => mockApi,
}))

const navigateSpy = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigateSpy,
}))

vi.mock('react-i18next', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        useTranslation: () => ({ t: (k: string) => k }),
    }
})

import { CustomBlockView } from '@/components/chat/blocks/CustomBlock'
import type { CustomBlock } from '@/domain/chat/types'

afterEach(cleanup)

function makeBlock(blocks: CustomBlock['blocks']): CustomBlock {
    return { kind: 'custom', id: 'custom-1', localId: null, createdAt: 1000, blocks }
}

function renderView(block: CustomBlock): ReturnType<typeof render> {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={queryClient}>
            <CustomBlockView block={block} />
        </QueryClientProvider>,
    )
}

describe('CustomBlockView', () => {
    it('text 段直出', () => {
        renderView(makeBlock([{ type: 'text', text: 'fork 自会话 ' }]))
        // getByText 默认 normalizer 会 trim 文本，查询串用 trim 后形态
        expect(screen.getByText('fork 自会话')).toBeTruthy()
    })

    it('ref(session)：标题实时取，渲染为可点击链接，点击跳转该会话', async () => {
        sessionsGet.mockResolvedValue({ data: { session: { id: 'parent-1', metadata: { name: '父会话' } } } })
        renderView(makeBlock([
            { type: 'text', text: 'fork 自会话 ' },
            { type: 'ref', targetType: 'session', id: 'parent-1' },
        ]))

        const link = await screen.findByRole('link', { name: '父会话' })
        fireEvent.click(link)
        expect(navigateSpy).toHaveBeenCalledWith(
            expect.objectContaining({ params: { sessionId: 'parent-1' } }),
        )
    })

    it('parent 已删（404）→ 降级灰文本不可点', async () => {
        sessionsGet.mockRejectedValue(new Error('Session not found'))
        renderView(makeBlock([{ type: 'ref', targetType: 'session', id: 'gone' }]))

        // 降级文案出现且无 link role（不可点）
        await screen.findByText('chat.custom.sessionRefMissing')
        expect(screen.queryByRole('link')).toBeNull()
    })

    it('未注册 targetType 的 ref 跳过（注册表无渲染器）', () => {
        const { container } = renderView(makeBlock([
            { type: 'ref', targetType: 'file', id: 'f-1' },
        ]))
        expect(container.querySelector('span[role="link"]')).toBeNull()
    })

    it('未知 block 类型跳过（向前兼容）', () => {
        const { container } = renderView(makeBlock([
            { type: 'mystery' } as unknown as CustomBlock['blocks'][number],
        ]))
        expect(container.querySelector('span[role="link"]')).toBeNull()
    })
})
