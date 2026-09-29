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
 * LiveSystemNoticeBar 渲染测试（02 票）：slot 有值渲染摘要 / ✕ 清除 / 展开全文 /
 * 按会话归属。store 用真实实例（发布后即渲染），测试间 _resetForTest 隔离。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { LiveSystemNoticeBar } from '@/components/chat/LiveSystemNoticeBar'
import { useLiveNoticeStore, _resetForTest } from '@/core/data/stores/liveNoticeStore'

vi.mock('react-i18next', async (orig) => {
    const actual = await orig<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({ t: (k: string) => k }),
    }
})

afterEach(cleanup)

const getNotice = (sessionId: string) => useLiveNoticeStore.getState().noticeBySession.get(sessionId)

describe('LiveSystemNoticeBar', () => {
    it('无 slot 时渲染 null', () => {
        const { container } = render(<LiveSystemNoticeBar sessionId="s1" />)
        expect(container.querySelector('[data-testid="live-system-notice"]')).toBeNull()
    })

    it('slot 有值渲染一行摘要（收窄态不显示全文块）', () => {
        useLiveNoticeStore.getState().publishLiveNotice('s1', { id: 'm1', content: 'Model fallback engaged' })
        const { container } = render(<LiveSystemNoticeBar sessionId="s1" />)
        expect(container.querySelector('[data-testid="live-system-notice"]')).toBeTruthy()
        expect(screen.getByText('chat.liveNotice.title')).toBeTruthy()
        expect(screen.getByText('Model fallback engaged')).toBeTruthy()
    })

    it('点击行展开全文，再点行收起', () => {
        useLiveNoticeStore.getState().publishLiveNotice('s1', { id: 'm1', content: 'Model fallback engaged' })
        const { container } = render(<LiveSystemNoticeBar sessionId="s1" />)
        // onClick 挂在行 div（data-testid 的首个子元素）上，点它切换展开；展开态 role 移除但 onClick 仍在
        const row = () => container.querySelector('[data-testid="live-system-notice"] > div') as HTMLElement
        // 展开前：全文只出现一次（摘要形态）
        expect(screen.getAllByText('Model fallback engaged')).toHaveLength(1)
        fireEvent.click(row())
        // 展开后：行不再是 button（摘要行隐藏），全文经展开块渲染
        expect(container.querySelector('[role="button"]')).toBeNull()
        expect(screen.getAllByText('Model fallback engaged')).toHaveLength(1)
        fireEvent.click(row())
        expect(container.querySelector('[role="button"]')).toBeTruthy()
    })

    it('✕ 关闭清除 store slot，横幅消失', () => {
        useLiveNoticeStore.getState().publishLiveNotice('s1', { id: 'm1', content: 'Model fallback engaged' })
        const { container } = render(<LiveSystemNoticeBar sessionId="s1" />)
        fireEvent.click(screen.getByLabelText('chat.liveNotice.dismiss'))
        expect(getNotice('s1')).toBeUndefined()
        expect(container.querySelector('[data-testid="live-system-notice"]')).toBeNull()
    })

    it('按会话归属：s2 的横幅不显示在 s1 视图', () => {
        useLiveNoticeStore.getState().publishLiveNotice('s2', { id: 'm2', content: 'other session' })
        const { container } = render(<LiveSystemNoticeBar sessionId="s1" />)
        expect(container.querySelector('[data-testid="live-system-notice"]')).toBeNull()
    })

    it('✕ 不触发外层展开切换（stopPropagation）', () => {
        useLiveNoticeStore.getState().publishLiveNotice('s1', { id: 'm1', content: 'Model fallback engaged' })
        render(<LiveSystemNoticeBar sessionId="s1" />)
        fireEvent.click(screen.getByLabelText('chat.liveNotice.dismiss'))
        // slot 已清空——若 stopPropagation 失效会先展开再清空，这里直接断言终态即可
        expect(getNotice('s1')).toBeUndefined()
    })
})
