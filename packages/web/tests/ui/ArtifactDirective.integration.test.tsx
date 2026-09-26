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
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { Markdown } from '@/components/ui/Markdown'
import { ArtifactEnvProvider } from '@/components/ui/ArtifactDirectiveComponents'
import { injectArtifactScrollbarStyle } from '@/components/files/SandboxHtmlFrame'
import { DirectiveStreamGate } from '@/components/ui/directiveStreamGate'
import { useFileMeta } from '@/core/data/hooks/queries/useFileTree'
import { dedupeDirectiveText } from '@/domain/chat/directives'

vi.mock('@/core/data/hooks/queries/useFileTree', () => ({
    useFileMeta: vi.fn(),
}))

// 产物卡动作走 useActionDispatcher → workspaceStore.openFileTab（检查器），
// spy 掉 store 断言分发，避免真实 store 的 inspector 状态副作用
const openFileTabSpy = vi.hoisted(() => vi.fn())
vi.mock('@/core/data/stores/workspaceStore', () => ({
    useWorkspaceStore: Object.assign(vi.fn(() => ({})), {
        getState: () => ({ openFileTab: openFileTabSpy, setExpanded: vi.fn() }),
    }),
}))

// 产物卡「打开方式」动作分发依赖路由与会话 api 上下文
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
    it('图片有效 → inline（票 02 后行为）；mode="card" → 产物卡（文件名 + 打开动作），原文不残留', async () => {
        mockMeta.mockReturnValue({ isPending: false, isError: false, data: META_OK } as never)
        renderDirective('看这个 :mobi-artifact{path="/tmp/demo.png"} 好了')
        expect(await screen.findByTestId('artifact-inline-image')).toBeInTheDocument()
        cleanup()

        renderDirective(':mobi-artifact{path="/tmp/demo.png" mode="card"}')
        const card = await screen.findByTestId('artifact-card')
        expect(card.textContent).toContain('demo.png')
        expect(card.textContent).toMatch(/打开方式|Open with/)
        expect(document.body.textContent).not.toContain(':mobi-artifact{path="/tmp/demo.png"}')
    })

    it('产物卡交互：整卡/「打开方式」标签 → 检查器分发；箭头下拉含浏览器打开与复制链接', async () => {
        mockMeta.mockReturnValue({ isPending: false, isError: false, data: { ...META_OK, mime: 'text/html' } } as never)
        renderDirective(':mobi-artifact{path="/tmp/page.html" mode="card"}')
        const card = await screen.findByTestId('artifact-card')

        // 整卡点击 → 检查器（openFileTab），非路由跳转
        fireEvent.click(card)
        expect(openFileTabSpy).toHaveBeenCalledWith('s-1', '/tmp/page.html', 'page.html')
        openFileTabSpy.mockClear()

        // 「打开方式」标签点击 → 同一默认动作，且不冒泡整卡造成双触发
        fireEvent.click(screen.getByText(/打开方式|Open with/))
        expect(openFileTabSpy).toHaveBeenCalledTimes(1)
        openFileTabSpy.mockClear()

        // 箭头 → 下拉菜单（浏览器打开 / 复制链接），菜单点击不触发整卡
        fireEvent.click(screen.getByTestId('artifact-card-menu-trigger'))
        expect(await screen.findByText(/浏览器打开|Open in browser/)).toBeInTheDocument()
        expect(screen.getByText(/复制链接|Copy link/)).toBeInTheDocument()
        expect(openFileTabSpy).not.toHaveBeenCalled()

        const windowOpenSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
        fireEvent.click(screen.getByText(/浏览器打开|Open in browser/))
        expect(windowOpenSpy).toHaveBeenCalledWith(expect.stringContaining('/api/sessions/s-1/read-file'), '_blank', 'noopener')
        windowOpenSpy.mockRestore()
    })

    it('产物卡菜单可用性收敛：文件不存在 → 无下拉触发（复制/浏览器不可用）', async () => {
        mockMeta.mockReturnValue({ isPending: false, isError: true, data: undefined } as never)
        renderDirective(':mobi-artifact{path="/tmp/gone.html"}')
        await screen.findByTestId('artifact-card')
        expect(screen.queryByTestId('artifact-card-menu-trigger')).not.toBeInTheDocument()
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

    it('同一路径声明两次只渲染一个 inline（blocks 层 dedupeDirectiveText 组合路径）', async () => {
        mockMeta.mockReturnValue({ isPending: false, isError: false, data: META_OK } as never)
        const text = ':mobi-artifact{path="/tmp/demo.png"} 后 :mobi-artifact{path="/tmp/demo.png"}'
        // blocks 层 agent-text 渲染入口先去重再交 Markdown（本测试复现该组合）
        renderDirective(dedupeDirectiveText(text))
        await screen.findByTestId('artifact-inline-image')
        expect(screen.getAllByTestId('artifact-inline-image')).toHaveLength(1)
    })

    it('寻址上下文缺失 → 仍渲染卡片（无原因标注），且不发任何 meta 请求', async () => {
        renderDirective(':mobi-artifact{path="/tmp/demo.png"}', false)
        const card = await screen.findByTestId('artifact-card')
        expect(card.textContent).toContain('demo.png')
        // 寻址缺失在进端口前就短路（不打无效请求）——mockMeta 未被触达
        expect(mockMeta).not.toHaveBeenCalled()
    })

    it('fileMeta 端口注入：数据经 interface 驱动裁决，不穿 query cache 层', async () => {
        // 端口是 ArtifactEnv interface 的一部分：注入假端口即可驱动校验降级链，
        // 无需 mock useFileMeta 模块（端口未注入时才走 react-query adapter）
        const ready = { status: 'ready' as const, size: 1024, etag: 'p1' }
        render(
            <ArtifactEnvProvider refCtx={{ sessionId: 's-1' }} fileMeta={(_sid, path) => (path === '/tmp/demo.png' ? ready : { status: 'missing' as const })}>
                <Markdown content={':mobi-artifact{path="/tmp/demo.png"}'} />
            </ArtifactEnvProvider>,
        )
        expect(await screen.findByTestId('artifact-inline-image')).toBeInTheDocument()
        expect(mockMeta).not.toHaveBeenCalled()

        // 同一管线换 error 端口 → missing 卡（裁决对端口三态一致）
        cleanup()
        render(
            <ArtifactEnvProvider refCtx={{ sessionId: 's-1' }} fileMeta={() => ({ status: 'missing' })}>
                <Markdown content={':mobi-artifact{path="/tmp/demo.png"}'} />
            </ArtifactEnvProvider>,
        )
        expect(await screen.findByTestId('artifact-card')).toBeInTheDocument()
    })

    it('mode 非法值容错为 auto（按类型 inline，不炸不降级原文）', async () => {
        mockMeta.mockReturnValue({ isPending: false, isError: false, data: META_OK } as never)
        renderDirective(':mobi-artifact{path="/tmp/demo.png" mode="fullscreen"}')
        expect(await screen.findByTestId('artifact-inline-image')).toBeInTheDocument()
    })
})

describe('产物 inline 渲染（票 02/03）', () => {
    it('图片 → inline 缩略图（read-file URL 带 etag 版本参数），非卡片', async () => {
        mockMeta.mockReturnValue({ isPending: false, isError: false, data: META_OK } as never)
        renderDirective(':mobi-artifact{path="/tmp/demo.png"}')
        const inline = await screen.findByTestId('artifact-inline-image')
        const img = inline.querySelector('img')
        expect(img).not.toBeNull()
        expect(img!.getAttribute('src')).toContain('/api/sessions/s-1/read-file')
        expect(img!.getAttribute('src')).toContain('v=1-1')
        expect(screen.queryByTestId('artifact-card')).not.toBeInTheDocument()
    })

    it('音频/视频 → 对应标签播放器，preload=metadata 不自动播放', async () => {
        mockMeta.mockReturnValue({ isPending: false, isError: false, data: META_OK } as never)
        const { container: c1 } = render(
            <ArtifactEnvProvider refCtx={{ sessionId: 's-1' }}>
                <Markdown content={':mobi-artifact{path="/tmp/a.mp3"}'} />
            </ArtifactEnvProvider>,
        )
        await screen.findByTestId('artifact-inline-audio')
        expect(c1.querySelector('audio[controls][preload="metadata"]')).not.toBeNull()
        cleanup()

        const { container: c2 } = render(
            <ArtifactEnvProvider refCtx={{ sessionId: 's-1' }}>
                <Markdown content={':mobi-artifact{path="/tmp/v.mp4"}'} />
            </ArtifactEnvProvider>,
        )
        await screen.findByTestId('artifact-inline-video')
        const video = c2.querySelector('video')
        expect(video).not.toBeNull()
        expect(video!.getAttribute('preload')).toBe('metadata')
        expect(video!.getAttribute('autoplay')).toBeNull()
    })

    it('HTML → serve-file 沙箱 iframe（非流式态）；流式揭示期间为占位不挂 iframe', async () => {
        mockMeta.mockReturnValue({ isPending: false, isError: false, data: { ...META_OK, mime: 'text/html' } } as never)
        const ui = <Markdown content={':mobi-artifact{path="/tmp/page.html"}'} />
        const { container } = render(
            <ArtifactEnvProvider refCtx={{ sessionId: 's-1' }}>
                <DirectiveStreamGate.Provider value={true}>{ui}</DirectiveStreamGate.Provider>
            </ArtifactEnvProvider>,
        )
        const wrap = await screen.findByTestId('artifact-inline-html')
        expect(wrap.querySelector('[data-artifact-html-placeholder]')).not.toBeNull()
        expect(wrap.querySelector('iframe')).toBeNull()
        cleanup()

        const { container: c2 } = render(
            <ArtifactEnvProvider refCtx={{ sessionId: 's-1' }}>
                <DirectiveStreamGate.Provider value={false}>{ui}</DirectiveStreamGate.Provider>
            </ArtifactEnvProvider>,
        )
        await screen.findByTestId('artifact-inline-html')
        const iframe = c2.querySelector('iframe')
        expect(iframe).not.toBeNull()
        expect(iframe!.getAttribute('src')).toContain('/api/sessions/s-1/serve-file/')
        expect(iframe!.getAttribute('sandbox')).toContain('allow-scripts')
    })

    it('mode="wide" → iframe 容器走宽档；mode="card" → 产物卡', async () => {        mockMeta.mockReturnValue({ isPending: false, isError: false, data: { ...META_OK, mime: 'text/html' } } as never)
        const { container } = render(
            <ArtifactEnvProvider refCtx={{ sessionId: 's-1' }}>
                <Markdown content={':mobi-artifact{path="/tmp/page.html" mode="wide"}'} />
            </ArtifactEnvProvider>,
        )
        const wrap = await screen.findByTestId('artifact-inline-html')
        // wide 档的可见差异 = 定高 640（默认 480）；iframe 机制单源在 SandboxHtmlFrame
        expect(wrap.querySelector('iframe')!.style.height).toBe('640px')
        expect(container.querySelector('[data-testid="artifact-card"]')).toBeNull()
        cleanup()

        renderDirective(':mobi-artifact{path="/tmp/page.html" mode="card"}')
        await screen.findByTestId('artifact-card')
    })

    it('滚动条样式注入：load 后进产物文档且幂等（重复调用不重复追加）', () => {
        const doc = document.implementation.createHTMLDocument('artifact')
        injectArtifactScrollbarStyle(doc)
        const styles = doc.querySelectorAll('#mobi-artifact-scrollbar')
        expect(styles).toHaveLength(1)
        expect(styles[0]!.textContent).toContain('::-webkit-scrollbar-thumb')

        injectArtifactScrollbarStyle(doc)
        expect(doc.querySelectorAll('#mobi-artifact-scrollbar')).toHaveLength(1)

        // 空文档（contentDocument 未就绪）不抛错
        expect(() => injectArtifactScrollbarStyle(null)).not.toThrow()
    })

    it('宽度选择器：默认自适应（撑满聊天列），点 736/1024 切固定档', async () => {
        mockMeta.mockReturnValue({ isPending: false, isError: false, data: { ...META_OK, mime: 'text/html' } } as never)
        renderDirective(':mobi-artifact{path="/tmp/page.html"}')
        const wrap = await screen.findByTestId('artifact-inline-html')
        expect(wrap.style.width).toBe('100%')

        fireEvent.click(within(wrap).getByText('736'))
        expect(wrap.style.width).toBe('736px')

        fireEvent.click(within(wrap).getByText('1024'))
        expect(wrap.style.width).toBe('1024px')

        fireEvent.click(within(wrap).getByText(/自适应|Fluid/))
        expect(wrap.style.width).toBe('100%')
    })

    it('图片 inline 加载失败（401/损坏）→ 紧凑失败态可重试，重试造 _retry 新 URL（不再静默破图）', async () => {
        mockMeta.mockReturnValue({ isPending: false, isError: false, data: META_OK } as never)
        renderDirective(':mobi-artifact{path="/tmp/demo.png"}')
        const inline = await screen.findByTestId('artifact-inline-image')
        expect(inline.querySelector('img')!.src).not.toContain('_retry')

        // 原生 onError（axios interceptor 够不到的通道）→ 失败态
        fireEvent.error(inline.querySelector('img')!)
        const err = await screen.findByTestId('artifact-inline-media-error')
        expect(err.textContent).toMatch(/加载失败|Failed to load/)

        // 重试 → 失败态清除，src 带 _retry=1（绕缓存重新认证）
        fireEvent.click(within(err).getByRole('button'))
        await waitFor(() => {
            const img = inline.querySelector('img')
            expect(img).not.toBeNull()
            expect(img!.src).toContain('_retry=1')
        })
    })

    it('视频 inline 加载失败同样可重试（etag 未变，纯 retry 计数造新 URL）', async () => {
        mockMeta.mockReturnValue({ isPending: false, isError: false, data: META_OK } as never)
        renderDirective(':mobi-artifact{path="/tmp/v.mp4"}')
        const inline = await screen.findByTestId('artifact-inline-video')
        const video = inline.querySelector('video')!
        expect(video.src).toContain('v=1-1')

        fireEvent.error(video)
        const err = await screen.findByTestId('artifact-inline-media-error')
        fireEvent.click(within(err).getByRole('button'))
        await waitFor(() => {
            const v = inline.querySelector('video')!
            expect(v.src).toContain('_retry=1')
            expect(v.src).toContain('v=1-1')
        })
    })
})
