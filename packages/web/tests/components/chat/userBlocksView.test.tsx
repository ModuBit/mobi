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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { UserContentBlock, UserImageBlock } from '@mobi/shared'
import { buildMachineReadFileUrl } from '@/core/utils/fileUrl'

// 轻量 mock Markdown：UserBlocksView 的测试关注「block 分发」而非 markdown 渲染管线，
// XMarkdown 全链路由 ui/MarkdownStreaming.test.tsx 与 E2E 覆盖
vi.mock('@/components/ui/Markdown', () => ({
    Markdown: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}))

// 动作分发 hook 读路由会话上下文（file/open 执行器按会话隔离 inspector 状态）
// 会话激活态与恢复动作 mock（ActionLink 的会话恢复守卫消费；默认激活=不拦截）
vi.mock('@/core/data/api/client', async (orig) => {
    const actual = await orig<typeof import('@/core/data/api/client')>()
    const helper = await import('../../helpers/sessionActionMocks')
    return { ...actual, useMobiApi: helper.useMobiApi }
})

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    useParams: () => ({ sessionId: 'sess-1' }),
}))

// 端形态可控（画板交互按移动/桌面分流：角标入口 vs 预览工具栏入口）
const isMobileRef = vi.hoisted(() => ({ value: false }))
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useIsMobile: () => isMobileRef.value,
}))

const { UserBlocksView, USER_BLOCK_RENDERERS } = await import('@/components/chat/userBlocks/UserBlocksView')

afterEach(cleanup)

/** 文件卡 / 列表根元素（antd 默认前缀 ant-*；子元素类名含 -list/-file 等后缀，须精确匹配） */
const CARD_ROOT = '.ant-file-card'
const LIST_ROOT = '.ant-file-card-list'

describe('UserBlocksView 按 block 分发渲染', () => {
    it('quote 条 / 文件卡 / 内联图 / 文本各走各的视图', () => {
        const blocks: UserContentBlock[] = [
            { type: 'quote', messageId: 'm1', role: 'agent', excerpt: 'CCR backend…' },
            {
                type: 'document',
                source: { type: 'url', value: '/u/r.pdf', mimeType: 'application/pdf' },
                id: 'd1', filename: 'report.pdf', size: 12345,
            },
            {
                type: 'image',
                source: { type: 'url', value: '/u/p.png', mimeType: 'image/png' },
                id: 'g1', filename: 'pic.png', size: 2048,
            },
            { type: 'text', text: '帮我看看' },
        ]
        render(<UserBlocksView blocks={blocks} env={{ refCtx: { sessionId: 's1' } }} />)

        // quote：引用组容器内 data-testid 定位 + excerpt 全文（短文本不截断）+ 编号恒显示
        expect(screen.getByTestId('user-quote-m1')).toHaveTextContent('CCR backend…')
        expect(screen.getByTestId('user-quote-m1')).toHaveTextContent('1.')

        // document 卡：文件名渲染（FileCard 把 name 拆成 prefix/suffix 两个 span，
        // 单元素 getByText 拿不到完整名，用卡片级 textContent 断言）
        const pdfPrefix = screen.getByText('report')
        const pdfCard = pdfPrefix.closest(CARD_ROOT) as HTMLElement
        expect(pdfCard).not.toBeNull()
        expect(pdfCard).toHaveTextContent('report.pdf')

        // image 卡：alt 取 filename 的真实 <img>，src 走 read-file 端点（服务端路径语义）
        const img = screen.getByRole('img', { name: /pic\.png|pic/ })
        expect(img).toHaveAttribute(
            'src',
            expect.stringContaining('/api/sessions/s1/read-file'),
        )
        expect(img).toHaveAttribute(
            'src',
            expect.stringContaining(encodeURIComponent('/u/p.png')),
        )

        // 文本：原 Markdown 通道照常渲染
        expect(screen.getByText('帮我看看')).toBeInTheDocument()
    })

    it('段落间用垂直 Space 分隔（文本/引用/图片/附件段统一间距）', () => {
        const blocks: UserContentBlock[] = [
            { type: 'quote', messageId: 'm1', role: 'agent', excerpt: '引用' },
            { type: 'text', text: '正文' },
        ]
        const { container } = render(<UserBlocksView blocks={blocks} env={{ refCtx: { sessionId: 's1' } }} />)
        // 顶层垂直 Space：段间距由 Space 收口，不靠 FileCard 自带 padding
        expect(container.querySelector('.ant-space-vertical')).not.toBeNull()
    })

    it('连续 document 归并一组（Space wrap 内多卡）；被其他 block 打断则另起一组', () => {
        const blocks: UserContentBlock[] = [
            {
                type: 'document',
                source: { type: 'url', value: '/u/a.zip', mimeType: 'application/zip' },
                id: 'd1', filename: 'a.zip', size: 1,
            },
            {
                type: 'document',
                source: { type: 'url', value: '/u/b.pdf', mimeType: 'application/pdf' },
                id: 'd2', filename: 'b.pdf', size: 2,
            },
            { type: 'text', text: '中间夹一段' },
            {
                type: 'document',
                source: { type: 'url', value: '/u/c.md', mimeType: 'text/markdown' },
                id: 'd3', filename: 'c.md', size: 3,
            },
        ]
        const { container } = render(<UserBlocksView blocks={blocks} />)

        // 3 张文件卡（d1+d2 同段、d3 单独段）；前 2 张共享同一个横向 wrap Space，第 3 张属另一段
        const cards = Array.from(container.querySelectorAll(CARD_ROOT))
        expect(cards).toHaveLength(3)
        expect(screen.getByText('中间夹一段')).toBeInTheDocument()

        const groupOf = (card: Element) => card.closest('.ant-space')
        expect(groupOf(cards[0]!)).not.toBeNull()
        expect(groupOf(cards[0]!)).toBe(groupOf(cards[1]!))
        expect(groupOf(cards[2]!)).not.toBe(groupOf(cards[0]!))
        // document 组内不再使用 FileCard.List（其 list-content 自带 12px 16px padding，气泡内过肥）
        expect(container.querySelector(LIST_ROOT)).toBeNull()
    })

    it('纯单 text blocks 与旧渲染等价（回归）', () => {
        render(<UserBlocksView blocks={[{ type: 'text', text: '你好' }]} />)
        expect(screen.getByText('你好')).toBeInTheDocument()
    })

    it('image 走 previewUrl 自足 URL 直通，不走 read-file 拼接', () => {
        render(
            <UserBlocksView
                blocks={[{
                    type: 'image',
                    source: { type: 'url', value: '/u/p.png', mimeType: 'image/png' },
                    id: 'g1', filename: 'p.png', size: 1,
                    previewUrl: 'blob:http://localhost/abc',
                }]}
                env={{ refCtx: { sessionId: 's1' } }}
            />,
        )
        expect(screen.getByRole('img', { name: /p\.png|p/ })).toHaveAttribute('src', 'blob:http://localhost/abc')
    })

    it('image 走原生懒加载：loading=lazy + decoding=async 落到真实 <img>', () => {
        // rc-image COMMON_PROPS 白名单透传——锁住这条链路，防上游把 loading 移出白名单后静默失效
        render(
            <UserBlocksView
                blocks={[{
                    type: 'image',
                    source: { type: 'url', value: '/u/p.png', mimeType: 'image/png' },
                    id: 'g1', filename: 'p.png', size: 1,
                }]}
                env={{ refCtx: { sessionId: 's1' } }}
            />,
        )
        const img = screen.getByRole('img', { name: /p\.png|p/ })
        expect(img).toHaveAttribute('loading', 'lazy')
        expect(img).toHaveAttribute('decoding', 'async')
    })

    it('image 加载失败进兜底态：src 换兜底图且关闭点击预览（兜底图无放大价值）', async () => {
        const { container } = render(
            <UserBlocksView
                blocks={[{
                    type: 'image',
                    source: { type: 'url', value: '/u/p.png', mimeType: 'image/png' },
                    id: 'g1', filename: 'p.png', size: 1,
                }]}
                env={{ refCtx: { sessionId: 's1' } }}
            />,
        )
        // 初始态可预览：rc-image 在 preview 开启时给外层容器 role=button
        const img = screen.getByRole('img', { name: /p\.png|p/ })
        expect(img.closest('[role="button"]')).not.toBeNull()

        fireEvent.error(img)
        const fallbackImg = await waitFor(() => {
            const el = container.querySelector('img')
            expect(el).toHaveAttribute('src', expect.stringContaining('data:image'))
            return el as HTMLImageElement
        })
        // 失败态预览关闭：外层不再有 role=button（点卡片不弹兜底图放大）
        expect(fallbackImg.closest('[role="button"]')).toBeNull()
    })

    it('草图缩略图（PC）：编辑角标点击只进编辑器，不穿透触发预览', () => {
        const onEditSketch = vi.fn()
        render(
            <UserBlocksView
                blocks={[{
                    type: 'image',
                    source: { type: 'url', value: '/u/s.png', mimeType: 'image/png' },
                    id: 'sk1', filename: 's.png', size: 1,
                    sketch: { format: 'excalidraw.png' },
                }]}
                env={{ refCtx: { sessionId: 's1' }, onEditSketch }}
            />,
        )
        // PC 有 hover 编辑角标
        const badge = screen.getByRole('generic', { name: /编辑草图|edit/i })
        fireEvent.click(badge)
        expect(onEditSketch).toHaveBeenCalledTimes(1)
    })

    it('草图缩略图（移动端）：不渲染编辑角标（编辑走预览工具栏，避开 rewind 长按手势域）', () => {
        isMobileRef.value = true
        try {
            render(
                <UserBlocksView
                    blocks={[{
                        type: 'image',
                        source: { type: 'url', value: '/u/s.png', mimeType: 'image/png' },
                        id: 'sk2', filename: 's.png', size: 1,
                        sketch: { format: 'excalidraw.png' },
                    }]}
                    env={{ refCtx: { sessionId: 's1' }, onEditSketch: vi.fn() }}
                />,
            )
            expect(screen.queryByRole('generic', { name: /编辑草图|edit/i })).toBeNull()
        } finally {
            isMobileRef.value = false
        }
    })
})

describe('document 卡点击 → file/open 动作（ADR 0003 二期）', () => {
    it('点击文件卡：inspector 新建 file tab + 展开（默认两步语义）', async () => {
        const { useWorkspaceStore } = await import('@/core/data/stores/workspaceStore')
        render(
            <UserBlocksView
                blocks={[{
                    type: 'document',
                    source: { type: 'url', value: '.mobi/uploads/report.pdf', mimeType: 'application/pdf' },
                    id: 'd1', filename: 'report.pdf', size: 12345,
                }]}
                env={{ refCtx: { sessionId: 'sess-1' } }}
            />,
        )

        fireEvent.click(screen.getByRole('link'))

        // 守卫链路 async（fetchQuery 校验激活态）→ store 更新异步抵达，用 waitFor 等待
        const s = await waitFor(() => {
            const state = useWorkspaceStore.getState().getSession('sess-1')
            expect(state.tabs).toHaveLength(1)
            return state
        })
        expect(s.expanded).toBe(true)
        expect(s.tabs[0]).toMatchObject({ mode: 'file', filePath: '.mobi/uploads/report.pdf', fileName: 'report.pdf' })
        expect(s.activeTabId).toBe(s.tabs[0].id)
    })

    it('data source 占位块（无磁盘路径）不绑定点击', () => {
        render(
            <UserBlocksView
                blocks={[{
                    type: 'document',
                    source: { type: 'data', value: 'base64xxx', mimeType: 'application/pdf' },
                    id: 'd2', filename: 'inline.pdf', size: 1,
                }]}
                env={{ refCtx: { sessionId: 'sess-1' } }}
            />,
        )
        expect(screen.queryByRole('link')).toBeNull()
    })
})

describe('USER_BLOCK_RENDERERS 注册表完整性', () => {
    it('四种 block 类型全部注册视图', () => {
        expect(Object.keys(USER_BLOCK_RENDERERS).sort()).toEqual(['document', 'image', 'quote', 'text'])
    })
})

describe('合成消息文本样式', () => {
    it('env.isSynthetic 时文本走弱化 span，不进 Markdown', () => {
        render(
            <UserBlocksView
                blocks={[{ type: 'text', text: '/rewind 标记' }]}
                env={{ isSynthetic: true }}
            />,
        )
        expect(document.querySelector('[data-testid=md]')).toBeNull()
        expect(screen.getByText('/rewind 标记').tagName).toBe('SPAN')
    })
})

describe('引用组合并容器（票 06）', () => {
    /** 构造 quote block 的便捷工厂 */
    const quote = (messageId: string, excerpt: string, comment?: string): UserContentBlock => ({
        type: 'quote', messageId, role: 'agent', excerpt,
        ...(comment !== undefined ? { comment } : {}),
    })

    it('多 quote 归并单容器：编号连续 + 条间分隔线 + comment 全显异色', () => {
        render(
            <UserBlocksView
                blocks={[
                    quote('q1', '第一条引用'),
                    quote('q2', '第二条引用', '这里为什么成立？'),
                ]}
            />,
        )

        // 编号 1./2. 与条目同容器（对齐 chip/prompt 的跨端编号词汇）
        expect(screen.getByTestId('user-quote-q1')).toHaveTextContent('1.第一条引用')
        expect(screen.getByTestId('user-quote-q2')).toHaveTextContent('2.第二条引用')
        // comment 全显（不截断）
        expect(screen.getByText('这里为什么成立？')).toBeInTheDocument()

        // 条间细分隔线：第二条（divided）落 border-top，首条无
        expect(screen.getByTestId('user-quote-q2').style.borderTopWidth).toBe('1px')
        expect(screen.getByTestId('user-quote-q1').style.borderTopWidth).toBe('')

        // 色调区分：excerpt 静音灰 vs comment 提一级（同为灰系 token，色值不同）
        const excerptColor = screen.getByText('第二条引用').style.color
        const commentColor = screen.getByText('这里为什么成立？').style.color
        expect(excerptColor).not.toBe('')
        expect(commentColor).not.toBe('')
        expect(commentColor).not.toBe(excerptColor)
    })

    it('单条 quote 也走组容器：编号保留（chip/prompt/气泡三处一致的跨端锚点）', () => {
        render(<UserBlocksView blocks={[quote('q1', '单条引用')]} />)
        expect(screen.getByTestId('user-quote-q1')).toHaveTextContent('1.单条引用')
    })

    it('excerpt 超 120 字截断补省略号；hover 展示全文（全文 = excerpt 存档）', async () => {
        const full = `${'x'.repeat(150)}结尾标记`
        render(<UserBlocksView blocks={[quote('q1', full)]} />)

        const row = screen.getByTestId('user-quote-q1')
        expect(row.textContent).toContain('…')
        expect(row.textContent).not.toContain('结尾标记')

        // PC hover（pointerType=mouse）→ AppTooltip 弹出全文（截断不阻碍阅读）
        fireEvent.pointerOver(row, { pointerType: 'mouse', relatedTarget: document.body })
        expect(await screen.findByText(full)).toBeInTheDocument()
    })

    it('引用组落 forbidden 锚点 + user-select:none（「引用的引用」禁区双防御）', () => {
        const { container } = render(<UserBlocksView blocks={[quote('q1', '不可再被引用')]} />)
        const forbidden = container.querySelector('[data-quote-forbidden]')
        expect(forbidden).not.toBeNull()
        expect(forbidden).toHaveStyle({ userSelect: 'none' })
    })

    it('点击条目 → env.onQuoteLocate（消息级定位能力位；未提供则无点击 handler）', () => {
        const onQuoteLocate = vi.fn()
        const { rerender } = render(
            <UserBlocksView blocks={[quote('q1', '可定位'), quote('q2', '第二条')]} env={{ onQuoteLocate }} />,
        )
        fireEvent.click(screen.getByTestId('user-quote-q2'))
        expect(onQuoteLocate).toHaveBeenCalledTimes(1)
        expect(onQuoteLocate).toHaveBeenCalledWith('q2')

        // 能力位缺省（非聊天上下文）：点击无 handler，纯展示不报错
        rerender(<UserBlocksView blocks={[quote('q1', '纯展示')]} />)
        expect(() => fireEvent.click(screen.getByTestId('user-quote-q1'))).not.toThrow()
    })
})

describe('UserBlocksView ImageView（图片视图细部）', () => {
    /** 服务端 uploads 路径形态的 image block */
    function serverImageBlock(): UserImageBlock {
        return {
            type: 'image',
            id: 'img-1',
            filename: 'photo.png',
            size: 12345,
            source: { type: 'url', value: '.mobi/uploads/2026-08/photo.png' },
        }
    }

    it('缩略图固定 80×80、objectFit cover 裁切', () => {
        const { container } = render(
            <UserBlocksView blocks={[serverImageBlock()]} env={{ refCtx: { sessionId: 'sess-1' } }} />,
        )
        // antd Image：width/height 落外层容器 div，objectFit 经 styles.image 落 <img>
        const holder = container.querySelector('.ant-image') as HTMLElement
        expect(holder).not.toBeNull()
        expect(holder.style.width).toBe('80px')
        expect(holder.style.height).toBe('80px')
        const img = container.querySelector('img')!
        expect(img.style.objectFit).toBe('cover')
    })

    it('服务端路径经 read-file 端点构造 src', () => {
        const { container } = render(
            <UserBlocksView blocks={[serverImageBlock()]} env={{ refCtx: { sessionId: 'sess-1' } }} />,
        )
        const img = container.querySelector('img')
        expect(img!.getAttribute('src')).toContain('/api/sessions/sess-1/read-file')
        expect(img!.getAttribute('src')).toContain(encodeURIComponent('.mobi/uploads/2026-08/photo.png'))
    })

    it('blob:/data:/http(s) 自足 URL 直接使用（乐观回显）', () => {
        const block: UserImageBlock = {
            ...serverImageBlock(),
            source: { type: 'url', value: 'blob:http://localhost/abc' },
        }
        const { container } = render(
            <UserBlocksView blocks={[block]} env={{ refCtx: { sessionId: 'sess-1' } }} />,
        )
        expect(container.querySelector('img')!.getAttribute('src')).toBe('blob:http://localhost/abc')
    })

    it('文件名承载于 img alt（无障碍），不挂 tooltip', () => {
        const { container } = render(
            <UserBlocksView blocks={[serverImageBlock()]} env={{ refCtx: { sessionId: 'sess-1' } }} />,
        )
        expect(container.querySelector('img')!.getAttribute('alt')).toBe('photo.png')
    })

    it('加载失败 → 切换兜底图（svg data URI），不再请求原 src', () => {
        // 失败态由组件自管：onError 置 failed 换 src，不依赖 rc-image 内部异步校验
        const { container } = render(
            <UserBlocksView blocks={[serverImageBlock()]} env={{ refCtx: { sessionId: 'sess-1' } }} />,
        )
        const img = container.querySelector('img')!
        expect(img.getAttribute('src')).not.toMatch(/^data:/)
        fireEvent.error(img)
        expect(container.querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
    })

    it('失败态钉死于触发它的 src：src 变化（如环境恢复）后自动重试正常 src', () => {
        const { container, rerender } = render(
            <UserBlocksView blocks={[serverImageBlock()]} env={{ refCtx: { sessionId: 'sess-1' } }} />,
        )
        fireEvent.error(container.querySelector('img')!)
        expect(container.querySelector('img')!.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)

        // 环境恢复（env 补上 sessionId → src 切换为 session 端点）：不再显示兜底图
        rerender(
            <UserBlocksView
                blocks={[serverImageBlock()]}
                env={{ refCtx: { sessionId: 'sess-2', machineId: 'm-1', cwd: '/Users/t/demo' } }}
            />,
        )
        expect(container.querySelector('img')!.getAttribute('src')).toContain('/api/sessions/sess-2/read-file')
    })

    it('连续多图归并到同一横向容器：flex wrap + 间距，不一张一行', () => {
        const blocks = [
            serverImageBlock(),
            { ...serverImageBlock(), id: 'img-2', filename: 'photo2.png' },
            { ...serverImageBlock(), id: 'img-3', filename: 'photo3.png' },
        ]
        const { container } = render(
            <UserBlocksView blocks={blocks} env={{ refCtx: { sessionId: 'sess-1' } }} />,
        )
        // 三张图共享同一个横向 wrap Space（顶层还有垂直 Space 包段落，此处取横向组）
        // antd v6 的 wrap 不再加 class，而是 inline flex-wrap
        const space = container.querySelector('.ant-space-horizontal')
        expect(space).not.toBeNull()
        expect((space as HTMLElement).style.flexWrap).toBe('wrap')
        expect(space!.querySelectorAll('.ant-space-item .ant-image')).toHaveLength(3)
    })

    it('非连续多图不被归并：text 打断后各自成段', () => {
        const blocks = [serverImageBlock(), { type: 'text', text: '说明' }, serverImageBlock()]
        const { container } = render(
            <UserBlocksView blocks={blocks} env={{ refCtx: { sessionId: 'sess-1' } }} />,
        )
        // 两张图各自成横向段（顶层垂直 Space 不计入）
        expect(container.querySelectorAll('.ant-space-horizontal')).toHaveLength(2)
        expect(container.querySelectorAll('.ant-image')).toHaveLength(2)
    })

    it('多图段共享组预览：点击第二张直接打开组预览，计数从命中张开始', () => {
        const blocks = [
            serverImageBlock(),
            // source 与第一张不同（uploads shortId 唯一）：组预览按 src 命中下标
            { ...serverImageBlock(), id: 'img-2', filename: 'photo2.png', source: { type: 'url' as const, value: '.mobi/uploads/2026-08/photo2.png' } },
        ]
        const { container } = render(
            <UserBlocksView blocks={blocks} env={{ refCtx: { sessionId: 'sess-1' } }} />,
        )
        // 点击第二张缩略图 → 组预览打开（不需要关闭再点下一张）
        fireEvent.click(container.querySelectorAll('.ant-image img')[1])
        const preview = document.querySelector('.ant-image-preview')
        expect(preview).not.toBeNull()
        // 1/N 进度可见（count>1 才渲染），且 current 命中点击的那张（2/2 而非 1/2）
        expect(preview!.textContent).toMatch(/2\s*\/\s*2/)
    })

    it('单张图片也在组内：打开预览无 1/N 计数（无切换语义）', () => {
        const { container } = render(
            <UserBlocksView blocks={[serverImageBlock()]} env={{ refCtx: { sessionId: 'sess-1' } }} />,
        )
        fireEvent.click(container.querySelector('.ant-image img')!)
        const preview = document.querySelector('.ant-image-preview')
        expect(preview).not.toBeNull()
        expect(preview!.textContent).not.toMatch(/1\s*\/\s*1/)
    })

    it('无 sessionId（spawn 前草稿）时 src 回退 machine 端点', () => {
        const { container } = render(
            <UserBlocksView
                blocks={[serverImageBlock()]}
                env={{ refCtx: { machineId: 'm-1', cwd: '/Users/t/demo' } }}
            />,
        )
        const src = container.querySelector('img')!.getAttribute('src')!
        expect(src).toContain('/api/machines/m-1/read-file')
        expect(src).toContain(encodeURIComponent('.mobi/uploads/2026-08/photo.png'))
        // 无会话行：不会打 sessions read-file
        expect(src).not.toContain('/api/sessions/')
    })

    it('env 带 sessionId 时 src 走 session 端点（ADR 0006：执行层在 runner，优先于 machine）', () => {
        const { container } = render(
            <UserBlocksView
                blocks={[serverImageBlock()]}
                env={{ refCtx: { sessionId: 'sess-1', machineId: 'm-1', cwd: '/Users/t/demo' } }}
            />,
        )
        const src = container.querySelector('img')!.getAttribute('src')!
        expect(src).toContain('/api/sessions/sess-1/read-file')
        expect(src).toContain(encodeURIComponent('.mobi/uploads/2026-08/photo.png'))
        expect(src).not.toContain('/api/machines/')
    })
})

describe('buildMachineReadFileUrl', () => {
    it('cwd 与 path 并入查询串，支持 v/download', () => {
        const url = new URL(buildMachineReadFileUrl('m-1', '/h/demo', '.mobi/uploads/a.png', { etag: 'e1', download: true }), 'http://localhost')
        expect(url.pathname).toBe('/api/machines/m-1/read-file')
        expect(url.searchParams.get('cwd')).toBe('/h/demo')
        expect(url.searchParams.get('path')).toBe('.mobi/uploads/a.png')
        expect(url.searchParams.get('v')).toBe('e1')
        expect(url.searchParams.get('download')).toBe('1')
    })
})
