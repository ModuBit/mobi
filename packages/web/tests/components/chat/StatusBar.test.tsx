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
import { render, screen, cleanup } from '@testing-library/react'

afterEach(cleanup)

// StatusBar 的职责是「running 时渲染 loading 内容、非 running 不渲染」。
// mock 掉 AgentLoadingBubble，隔离其 PixelAvatar / antd theme / setInterval 依赖，
// 让测试聚焦 StatusBar 自身的渲染门控逻辑。
vi.mock('@/components/chat/AgentLoadingBubble', () => ({
    AgentLoadingBubble: ({ agentId, status }: { agentId: string; status: string }) => (
        <div data-testid="loading-bubble" data-agent={agentId} data-status={status} />
    ),
}))

import { StatusBar } from '@/components/chat/StatusBar'

describe('StatusBar', () => {
    it('running=false 时不渲染任何内容', () => {
        const { container } = render(
            <StatusBar agentId="session-1" status="idle" running={false} />
        )
        expect(screen.queryByTestId('loading-bubble')).toBeNull()
        expect(container.firstChild).toBeNull()
    })

    it('running=true 时渲染 loading 内容并透传 agentId / status', () => {
        render(
            <StatusBar agentId="session-1" status="outputting" running={true} />
        )
        const bubble = screen.getByTestId('loading-bubble')
        expect(bubble.getAttribute('data-agent')).toBe('session-1')
        expect(bubble.getAttribute('data-status')).toBe('outputting')
    })

    it('running=true 但 status 缺省时不渲染', () => {
        const { container } = render(
            <StatusBar agentId="session-1" running={true} />
        )
        expect(screen.queryByTestId('loading-bubble')).toBeNull()
        expect(container.firstChild).toBeNull()
    })
})
