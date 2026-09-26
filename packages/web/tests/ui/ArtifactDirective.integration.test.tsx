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
 * 产物声明 → 渲染全链路（真实 x-markdown 管线，模式同 MarkdownDirective.integration）：
 * 组件级 mock 不了 marked tokenizer / sanitize / components 映射——directive 路由、
 * 降级与去重回归只有管线级测试能抓。fileMeta 用模块 mock 注入三态。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { Markdown } from '@/components/ui/Markdown'
import { ArtifactEnvProvider } from '@/components/ui/ArtifactDirectiveComponents'
import { useFileMeta } from '@/core/data/hooks/queries/useFileTree'
import { dedupeDirectiveText } from '@/domain/chat/directives'

vi.mock('@/core/data/hooks/queries/useFileTree', () => ({
    useFileMeta: vi.fn(),
}))

// 产物卡「打开」动作是 ActionLink（mobi://file/open），依赖路由与会话 api 上下文
// （模式同 MarkdownActionLink.integration：只 mock 到能渲染，动作分发契约由其专测把守）
const navigateSpy = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigateSpy,
    useParams: () => ({ sessionId: 's-1' }),
}))
vi.mock('@/core/data/api/client', async (orig) => {
    const actual = await orig<typeof import('@/core/data/api/client')>()
    return {
        ...actual,
        useMobiApi: () => ({
            sessions: {
                get: async () => ({ data: { session: { id: 's-1', active: true } } }),
                resume: vi.fn(async () => ({ data: { sessionId: 's-1' } })),
            },
        }),
    }
})

const mockMeta = vi.mocked(useFileMeta)

afterEach(() => {
    cleanup()
    mockMeta.mockReset()
})

/** 默认寻址上下文（sessionId 非 null，走 fileMeta 校验分支） */
function renderDirective(text: string, withEnv = true) {
    const ui = <Markdown content={text} />
    render(withEnv ? <ArtifactEnvProvider refCtx={{ sessionId: 's-1' }}>{ui}</ArtifactEnvProvider> : ui)
}

const META_OK = { mime: 'image/png', size: 1024, etag: '1-1', writable: true }

describe('产物声明渲染（:mobi-artifact 管线集成）', () => {
    it('文件存在 → 产物卡（文件名 + 打开动作），directive 原文不残留', async () => {
        mockMeta.mockReturnValue({ isPending: false, isError: false, data: META_OK } as never)
        renderDirective('看这个 :mobi-artifact{path="/tmp/demo.png"} 好了')
        const card = await screen.findByTestId('artifact-card')
        expect(card.textContent).toContain('demo.png')
        expect(card.textContent).toMatch(/在检查器打开|Open in inspector/)
        expect(document.body.textContent).not.toContain(':mobi-artifact{path="/tmp/demo.png"}')
    })

    it('fileMeta 失败（不存在/越界）→ 产物卡标注原因', async () => {
        mockMeta.mockReturnValue({ isPending: false, isError: true, data: undefined } as never)
        renderDirective(':mobi-artifact{path="/tmp/gone.png"}')
        const card = await screen.findByTestId('artifact-card')
        expect(card.textContent).toMatch(/文件不存在或不可读|File not found/)
    })

    it('超限（图 >8MB）→ 产物卡标注大小原因', async () => {
        mockMeta.mockReturnValue({ isPending: false, isError: false, data: { ...META_OK, size: 9 * 1024 * 1024 } } as never)
        renderDirective(':mobi-artifact{path="/tmp/big.png"}')
        const card = await screen.findByTestId('artifact-card')
        expect(card.textContent).toMatch(/超过 inline 大小上限|Exceeds the inline size limit/)
        expect(card.textContent).toContain('8MB')
    })

    it('pdf / 未知类型 → 产物卡标注不支持 inline', async () => {
        mockMeta.mockReturnValue({ isPending: false, isError: false, data: META_OK } as never)
        renderDirective(':mobi-artifact{path="/tmp/r.pdf"} 和 :mobi-artifact{path="/tmp/x.bin"}')
        const cards = await screen.findAllByTestId('artifact-card')
        expect(cards).toHaveLength(2)
        expect(cards[0]!.textContent).toMatch(/该类型不支持|can't be inlined/)
        expect(cards[1]!.textContent).toMatch(/该类型不支持|can't be inlined/)
    })

    it('path 缺失（伪造声明）→ 按原文降级，不渲染卡片', async () => {
        renderDirective('前文 :mobi-artifact{} 后文')
        await screen.findByText(/前文/)
        expect(screen.queryByTestId('artifact-card')).not.toBeInTheDocument()
        expect(document.body.textContent).toContain(':mobi-artifact{}')
    })

    it('同一路径声明两次只渲染一张卡（blocks 层 dedupeDirectiveText 组合路径）', async () => {
        mockMeta.mockReturnValue({ isPending: false, isError: false, data: META_OK } as never)
        const text = ':mobi-artifact{path="/tmp/demo.png"} 后 :mobi-artifact{path="/tmp/demo.png"}'
        // blocks 层 agent-text 渲染入口先去重再交 Markdown（本测试复现该组合）
        renderDirective(dedupeDirectiveText(text))
        await screen.findByTestId('artifact-card')
        expect(screen.getAllByTestId('artifact-card')).toHaveLength(1)
    })

    it('寻址上下文缺失 → 仍渲染卡片（无原因标注，不发无效请求）', async () => {
        renderDirective(':mobi-artifact{path="/tmp/demo.png"}', false)
        const card = await screen.findByTestId('artifact-card')
        expect(card.textContent).toContain('demo.png')
        expect(mockMeta).toHaveBeenCalledWith(null, '/tmp/demo.png')
    })

    it('mode="wide" 非法值容错为 auto（不炸不降级原文）', async () => {
        mockMeta.mockReturnValue({ isPending: false, isError: false, data: META_OK } as never)
        renderDirective(':mobi-artifact{path="/tmp/demo.png" mode="fullscreen"}')
        const card = await screen.findByTestId('artifact-card')
        expect(card.textContent).toContain('demo.png')
    })
})
