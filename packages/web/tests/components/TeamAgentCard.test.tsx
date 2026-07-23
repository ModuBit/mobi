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

import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import type { ReactNode } from 'react'
import { TeamAgentCard } from '@/components/composer/TeamAgentCard'
import type { TeamMember } from '@mobi/shared'

// PixelAvatar 用 canvas，jsdom 无 getContext('2d')；stub 成占位 canvas
vi.mock('@/components/pixel-avatar/PixelAvatar', () => ({
    PixelAvatar: () => <canvas data-testid="pixel-avatar" />,
}))

const wrapper = ({ children }: { children: ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

function baseMember(overrides: Partial<TeamMember>): TeamMember {
    return { name: 'agent-x', status: 'active', ...overrides } as TeamMember
}

describe('TeamAgentCard', () => {
    it('running 状态 label 颜色用统一蓝 #4dabf7', () => {
        const { container } = render(
            <TeamAgentCard member={baseMember({ status: 'running' })} teamName="t" />,
            { wrapper },
        )
        const runningLabel = Array.from(container.querySelectorAll('span'))
            .find(s => s.textContent === 'running')
        expect(runningLabel).toBeDefined()
        expect(runningLabel!.style.color).toBe('rgb(77, 171, 247)')
    })

    it('active 状态用绿待命（区别于 running 蓝），label 显示 active', () => {
        const { container } = render(
            <TeamAgentCard member={baseMember({ status: 'active' })} teamName="t" />,
            { wrapper },
        )
        const activeLabel = Array.from(container.querySelectorAll('span'))
            .find(s => s.textContent === 'active')
        expect(activeLabel).toBeDefined()
        expect(activeLabel!.style.color).toBe('rgb(102, 187, 106)')
    })

    it('idle 状态 label 颜色用统一绿 #66bb6a', () => {
        const { container } = render(
            <TeamAgentCard member={baseMember({ status: 'idle' })} teamName="t" />,
            { wrapper },
        )
        const idleLabel = Array.from(container.querySelectorAll('span'))
            .find(s => s.textContent === 'idle')
        expect(idleLabel).toBeDefined()
        expect(idleLabel!.style.color).toBe('rgb(102, 187, 106)')
    })

    it('completed 状态 label 颜色用统一绿 #66bb6a（完成=成功）', () => {
        const { container } = render(
            <TeamAgentCard member={baseMember({ status: 'completed' })} teamName="t" />,
            { wrapper },
        )
        const doneLabel = Array.from(container.querySelectorAll('span'))
            .find(s => s.textContent === 'done')
        expect(doneLabel).toBeDefined()
        expect(doneLabel!.style.color).toBe('rgb(102, 187, 106)')
    })

    it('保留 PixelAvatar（有 canvas）', () => {
        const { container } = render(
            <TeamAgentCard member={baseMember({ status: 'running' })} teamName="t" />,
            { wrapper },
        )
        expect(container.querySelector('canvas')).not.toBeNull()
    })
})
