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
 * Markdown mobi:// 链接拦截——真实 x-markdown 渲染管线集成测试（ADR 0003）。
 *
 * MarkdownActionLink.test.tsx mock 了 XMarkdown（聚焦 ExternalLink 分支契约），
 * 测不出管线级回归：x-markdown 在 sanitize 阶段用 DOMPurify 默认协议白名单剥掉
 * `mobi://` 的 href（E2E 实证），ExternalLink 收不到 href → ActionLink 永不渲染。
 * 本文件用真实 XMarkdown 锁定「md 链接文本 → 带 href 的 <a> → 点击分发」全链路。
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

// Popconfirm（rc resize-observer）依赖 ResizeObserver，jsdom 没有
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { message } from 'antd'

const navigateSpy = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigateSpy,
    // 动作分发 hook（useActionDispatcher）读当前会话上下文
    useParams: () => ({ sessionId: 'sess-1' }),
}))

vi.mock('react-i18next', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        useTranslation: () => ({ t: (k: string) => k }),
    }
})

// 恢复动作 mock（ActionLink 的会话恢复守卫消费）；激活态经 queryClient 单例缓存注入
const resumeSessionSpy = vi.hoisted(() => vi.fn(async () => 'sess-1'))
vi.mock('@/core/data/hooks/mutations/useSessionActions', () => ({
    useSessionActions: () => ({ resumeSession: resumeSessionSpy, isPending: false }),
}))

const messageInfoSpy = vi.spyOn(message, 'info').mockImplementation(() => undefined as never)

beforeEach(() => {
    navigateSpy.mockClear()
    messageInfoSpy.mockClear()
    resumeSessionSpy.mockClear()
    // 全局 inspector store / queryClient 缓存跨用例残留，逐用例清空
    useWorkspaceStore.getState().clearAll()
    queryClient.clear()
})

import { Markdown } from '@/components/ui/Markdown'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { queryClient } from '@/core/lib/queryClient'

afterEach(cleanup)

describe('Markdown mobi:// 链接拦截（真实渲染管线）', () => {
    it('md 链接文本中的 mobi://session/open 渲染为带 href 的链接（DOMPurify 不剥除）', async () => {
        render(<Markdown content={'试试 [打开会话](mobi://session/open?id=s1)'} />)
        await waitFor(() => {
            expect(screen.getByRole('link', { name: '打开会话' })).toHaveAttribute(
                'href',
                'mobi://session/open?id=s1',
            )
        })
    })

    it('已注册动作点击 navigate 到目标会话，不 toast', async () => {
        render(<Markdown content={'试试 [打开会话](mobi://session/open?id=s1)'} />)
        const link = await waitFor(() => screen.getByRole('link', { name: '打开会话' }))
        fireEvent.click(link)
        expect(navigateSpy).toHaveBeenCalledWith(
            expect.objectContaining({ params: { sessionId: 's1' } }),
        )
        expect(messageInfoSpy).not.toHaveBeenCalled()
    })

    it('未注册动作（file/download）保留 href（正常链接样式），点击 toast 不跳转', async () => {
        render(<Markdown content={'看下 [下载文件](mobi://file/download?path=/tmp/x.txt)'} />)
        const link = await waitFor(() => screen.getByRole('link', { name: '下载文件' }))
        expect(link.getAttribute('href')).toBe('mobi://file/download?path=/tmp/x.txt')
        fireEvent.click(link)
        expect(messageInfoSpy).toHaveBeenCalledWith('chat.action.unsupported')
        expect(navigateSpy).not.toHaveBeenCalled()
    })

    it('畸形 URI（mobi://session）保留 href，点击 toast 不抛错', async () => {
        render(<Markdown content={'这个 [坏链接](mobi://session) 坏了'} />)
        const link = await waitFor(() => screen.getByRole('link', { name: '坏链接' }))
        expect(link.getAttribute('href')).toBe('mobi://session')
        fireEvent.click(link)
        expect(messageInfoSpy).toHaveBeenCalledWith('chat.action.unsupported')
        expect(navigateSpy).not.toHaveBeenCalled()
    })

    it('普通 http 链接仍新标签页打开，不走动作分发', async () => {
        render(<Markdown content={'[官网](https://example.com)'} />)
        const link = await waitFor(() => screen.getByRole('link', { name: '官网' }))
        expect(link.getAttribute('target')).toBe('_blank')
        fireEvent.click(link)
        expect(navigateSpy).not.toHaveBeenCalled()
        expect(messageInfoSpy).not.toHaveBeenCalled()
    })

    it('mention badge（raw HTML 形态 mobi 链接）同样被拦截为 ActionLink，点击打开 inspector tab', async () => {
        const { useWorkspaceStore } = await import('@/core/data/stores/workspaceStore')
        // @mention 经 mentionPlugin 输出 raw HTML <a href="mobi://file/open?...">——
        // 锁定 raw HTML 锚点也过 DOMPurify（mobi scheme 白名单）并被 components.a 拦截
        render(<Markdown content={'看下 @src/main.ts 谢谢'} enableMention />)
        const link = await waitFor(() => screen.getByRole('link', { name: '@src/main.ts' }))
        expect(link.getAttribute('href')).toBe('mobi://file/open?path=src%2Fmain.ts')
        expect(link.className).toContain('mention-badge')

        fireEvent.click(link)
        const s = useWorkspaceStore.getState().getSession('sess-1')
        expect(s.expanded).toBe(true)
        expect(s.tabs[0]).toMatchObject({ mode: 'file', filePath: 'src/main.ts', fileName: 'main.ts' })
        expect(messageInfoSpy).not.toHaveBeenCalled()
    })

    it('会话未激活点击 file/open：弹确认气泡，恢复成功后用（可能变更的）新 id 执行动作', async () => {
        // 未激活态经 queryClient 缓存注入（ActionLink 零订阅判定读同 key 缓存）
        queryClient.setQueryData(['session', 'sess-1'], { active: false })
        resumeSessionSpy.mockResolvedValue('sess-new')
        render(<Markdown content={'看下 @src/main.ts 谢谢'} enableMention />)
        const link = await waitFor(() => screen.getByRole('link', { name: '@src/main.ts' }))
        fireEvent.click(link)

        // 气泡出现，未直接执行动作
        expect(await screen.findByText('chat.action.sessionInactiveHint')).toBeInTheDocument()
        expect(useWorkspaceStore.getState().getSession('sess-1').tabs).toHaveLength(0)
        expect(resumeSessionSpy).not.toHaveBeenCalled()

        fireEvent.click(await screen.findByRole('button', { name: 'chat.action.resume' }))
        await waitFor(() => expect(resumeSessionSpy).toHaveBeenCalledTimes(1))
        // 动作重放挂在恢复后的新会话 id 下（resume 可能 mergeSessions 变更 id）
        await waitFor(() => {
            const ns = useWorkspaceStore.getState().getSession('sess-new')
            expect(ns.tabs[0]).toMatchObject({ mode: 'file', filePath: 'src/main.ts' })
        })
    })

    it('会话未激活点击 file/open：取消则什么都不做', async () => {
        queryClient.setQueryData(['session', 'sess-1'], { active: false })
        render(<Markdown content={'看下 @src/main.ts 谢谢'} enableMention />)
        fireEvent.click(await waitFor(() => screen.getByRole('link', { name: '@src/main.ts' })))
        // 气泡出现后点取消
        fireEvent.click(await screen.findByRole('button', { name: 'common.cancel' }))
        // 行为断言：不恢复、不打开 tab（气泡关闭由 antd 受控 open 驱动，动画时序不在此锁）
        expect(resumeSessionSpy).not.toHaveBeenCalled()
        expect(useWorkspaceStore.getState().getSession('sess-1').tabs).toHaveLength(0)
    })
})
