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

import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AgentLoadingBubble } from '@/components/chat/AgentLoadingBubble'

describe('AgentLoadingBubble', () => {
    it('不再渲染 PixelAvatar（无 canvas / .pixel-avatar）', () => {
        const { container } = render(<AgentLoadingBubble agentId="agent-1" status="outputting" />)
        expect(container.querySelector('canvas')).toBeNull()
        expect(container.querySelector('.pixel-avatar')).toBeNull()
    })

    it('渲染 StatusDot（outputting → 蓝色 running）', () => {
        const { container } = render(<AgentLoadingBubble agentId="agent-1" status="outputting" />)
        const spans = container.querySelectorAll('span')
        const dot = Array.from(spans).find(s => s.style.background.includes('77, 171, 247'))
        expect(dot).toBeDefined()
    })

    it('保留计时（传入 startedAt 后展示数字）', () => {
        const startedAt = Date.now() - 5000
        const { container } = render(
            <AgentLoadingBubble agentId="agent-1" status="outputting" startedAt={startedAt} />,
        )
        expect(container.textContent).toMatch(/\d/)
    })

    it('保留 vibing 文本（role=status 容器）', () => {
        const { container } = render(<AgentLoadingBubble agentId="agent-1" status="outputting" />)
        const status = container.querySelector('[role="status"]')
        expect(status).not.toBeNull()
    })
})
