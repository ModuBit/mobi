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
 * HtmlInline 往气泡根挂 `bubble-artifact-fullwidth` 的增删契约。
 *
 * 回归点：React 19 先跑 layout effect 清理、后移除被删子树，卸载清理里的
 * querySelector 会命中正在卸载的自己——类永远摘不掉，消息此后一直全宽。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { HtmlInline } from '@/ui/shared/artifactInlineViews'

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => () => {},
    useParams: () => ({ sessionId: 's-1' }),
}))

vi.mock('@/ui/base/sandbox/SandboxHtmlFrame', () => ({
    SandboxHtmlFrame: () => <div data-testid="sandbox-frame" />,
}))

vi.mock('@/ui/base/markdown/directiveStreamGate', () => ({
    useDirectiveStreaming: () => false,
}))

vi.mock('@/ui/openui/actionContext', () => ({
    useUiSendMessage: () => () => {},
}))

afterEach(cleanup)

function renderInBubble(inline: React.ReactNode) {
    return render(<ConfigProvider><div className="ant-bubble">{inline}</div></ConfigProvider>)
}

describe('HtmlInline 气泡全宽类', () => {
    it('挂载时加类，最后一个产物卸载后摘掉类', () => {
        const { container, rerender } = renderInBubble(
            <HtmlInline sessionId="s-1" path="a.html" etag="1" />,
        )
        const bubble = container.querySelector('.ant-bubble')!
        expect(bubble.classList.contains('bubble-artifact-fullwidth')).toBe(true)

        rerender(<ConfigProvider><div className="ant-bubble" /></ConfigProvider>)
        expect(bubble.classList.contains('bubble-artifact-fullwidth')).toBe(false)
    })

    it('同气泡多个产物：只卸载其中一个时保留全宽类', () => {
        const { container, rerender } = renderInBubble(
            <>
                <HtmlInline sessionId="s-1" path="a.html" etag="1" />
                <HtmlInline sessionId="s-1" path="b.html" etag="2" />
            </>,
        )
        const bubble = container.querySelector('.ant-bubble')!
        expect(bubble.classList.contains('bubble-artifact-fullwidth')).toBe(true)

        rerender(
            <ConfigProvider>
                <div className="ant-bubble">
                    <HtmlInline sessionId="s-1" path="b.html" etag="2" />
                </div>
            </ConfigProvider>,
        )
        expect(bubble.classList.contains('bubble-artifact-fullwidth')).toBe(true)
    })
})
