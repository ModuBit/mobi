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

import { describe, it, expect, afterEach } from 'vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import { AgentLoadingBubble } from '@/components/chat/AgentLoadingBubble'

// vitest 未开 globals，渲染型测试需显式 cleanup，否则 DOM 累积串味后续断言
afterEach(cleanup)

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

    // ============ 静默告警（pending #34：上游挂死可观测）============

    it('静默超阈值 → 切换为等待响应提示（不再轮换 vibing 动词）', async () => {
        const { container } = render(
            <AgentLoadingBubble
                agentId="agent-1"
                status="outputting"
                lastActivityAt={Date.now() - 130_000}
            />,
        )
        // ScrambleText 打字机动画收敛后断言最终文案（动画 26 字符 × 40ms，默认 1s 超时不够）
        await waitFor(() => {
            expect(container.textContent).toContain('still waiting for response')
        }, { timeout: 3000 })
        // aria-label 提示长时间无响应
        const status = container.querySelector('[role="status"]')
        expect(status?.getAttribute('aria-label')).toContain('长时间无响应')
    })

    it('静默未超阈值 → 保持 vibing（不误报）', () => {
        const { container } = render(
            <AgentLoadingBubble
                agentId="agent-1"
                status="outputting"
                lastActivityAt={Date.now() - 10_000}
            />,
        )
        expect(container.textContent).not.toContain('still waiting for response')
    })

    it('未传 lastActivityAt → 不启用静默检测（向后兼容，如 sidechain 卡片）', () => {
        const { container } = render(<AgentLoadingBubble agentId="agent-1" status="outputting" />)
        expect(container.textContent).not.toContain('still waiting for response')
    })

    it('awaiting_auth 优先于静默告警（等待审批有自己的文案）', async () => {
        const { container } = render(
            <AgentLoadingBubble
                agentId="agent-1"
                status="awaiting_auth"
                lastActivityAt={Date.now() - 130_000}
            />,
        )
        await waitFor(() => {
            expect(container.textContent).toContain('awaiting approval')
        }, { timeout: 3000 })
        expect(container.textContent).not.toContain('still waiting for response')
    })
})
