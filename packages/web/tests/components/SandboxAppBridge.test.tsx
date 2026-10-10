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
 * SandboxHtmlFrame bridge 行为（generative-ui 票 06）：来源 frame 校验（event.source
 * 必须是本 frame 的 contentWindow）+ 白名单 schema + 限流，通过后 onIssueNewTurn 回调。
 * 断言外部行为：什么 postMessage 能触发回调——换实现方式仍应成立。
 */

import { describe, it, expect, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import { SandboxHtmlFrame } from '@/components/files/SandboxHtmlFrame'

vi.mock('@/core/data/hooks/queries/useFileTree', () => ({
    useFileMeta: () => ({ data: { etag: 'e1' }, dataUpdatedAt: 1 }),
}))
vi.mock('@/core/data/stores/uiStore', () => ({
    useUiStore: () => 'light',
    resolveTheme: () => 'light' as const,
}))
vi.mock('@/core/utils/fileUrl', () => ({ buildServeFileUrl: () => 'http://localhost/artifact' }))

/** 以指定 source 派发一条 postMessage 到 window */
function postFrom(source: Window | null, data: unknown) {
    window.dispatchEvent(new MessageEvent('message', { data, source }))
}

function renderFrame(onIssueNewTurn?: (text: string) => void) {
    const { container } = render(
        <SandboxHtmlFrame sessionId="s1" path="a.html" title="t" onIssueNewTurn={onIssueNewTurn} />,
    )
    const iframe = container.querySelector('iframe')!
    expect(iframe).not.toBeNull()
    return iframe
}

describe('SandboxHtmlFrame bridge（票 06）', () => {
    it('本 frame 发来的白名单消息 → onIssueNewTurn 收到 trim 后文本', () => {
        const onIssueNewTurn = vi.fn()
        const iframe = renderFrame(onIssueNewTurn)
        postFrom(iframe.contentWindow, { type: 'mobi-app', action: 'issueNewTurn', text: ' 按当前选择继续 ' })
        expect(onIssueNewTurn).toHaveBeenCalledWith('按当前选择继续')
    })

    it('来源 frame 不对（宿主 window 自己 / null）→ 不触发', () => {
        const onIssueNewTurn = vi.fn()
        renderFrame(onIssueNewTurn)
        postFrom(window, { type: 'mobi-app', action: 'issueNewTurn', text: 'x' })
        postFrom(null, { type: 'mobi-app', action: 'issueNewTurn', text: 'x' })
        expect(onIssueNewTurn).not.toHaveBeenCalled()
    })

    it('非白名单 action / 非法 text → 不触发', () => {
        const onIssueNewTurn = vi.fn()
        const iframe = renderFrame(onIssueNewTurn)
        postFrom(iframe.contentWindow, { type: 'mobi-app', action: 'openLink', text: 'x' })
        postFrom(iframe.contentWindow, { type: 'mobi-app', action: 'issueNewTurn', text: 123 })
        postFrom(iframe.contentWindow, { type: 'mobi-app', action: 'issueNewTurn', text: '   ' })
        expect(onIssueNewTurn).not.toHaveBeenCalled()
    })

    it('限流：连续两条同 frame 消息只放行第一条（jsdom 时钟连续，必然落进限流窗）', () => {
        const onIssueNewTurn = vi.fn()
        const iframe = renderFrame(onIssueNewTurn)
        postFrom(iframe.contentWindow, { type: 'mobi-app', action: 'issueNewTurn', text: 'first' })
        postFrom(iframe.contentWindow, { type: 'mobi-app', action: 'issueNewTurn', text: 'second' })
        expect(onIssueNewTurn).toHaveBeenCalledTimes(1)
        expect(onIssueNewTurn).toHaveBeenCalledWith('first')
    })

    it('回调随渲染更新经 ref 生效（不因闭包陈旧）', () => {
        const first = vi.fn()
        const second = vi.fn()
        const { container, rerender } = render(
            <SandboxHtmlFrame sessionId="s1" path="a.html" title="t" onIssueNewTurn={first} />,
        )
        rerender(<SandboxHtmlFrame sessionId="s1" path="a.html" title="t" onIssueNewTurn={second} />)
        const iframe = container.querySelector('iframe')!
        postFrom(iframe.contentWindow, { type: 'mobi-app', action: 'issueNewTurn', text: 'x' })
        expect(second).toHaveBeenCalled()
        expect(first).not.toHaveBeenCalled()
    })
})
