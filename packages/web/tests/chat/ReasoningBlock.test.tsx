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
 * ReasoningBlock 展开态契约：**任何位置、任何阶段都默认收起**，展开权只归用户。
 *
 * 断言的是本组件传给 antdx Think 的 expanded 契约（展开状态由本组件持有，
 * 动画与 DOM 形态归 Think）——故 Think 走桩件，把 expanded 落成可断言的 DOM，
 * 不受 antdx 折叠动效（CSSMotion）在 jsdom 下的影响。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ReasoningBlock } from '@/features/chat/blocks/ReasoningBlock'

vi.mock('react-i18next', async (orig) => {
    const actual = await orig<typeof import('react-i18next')>()
    return { ...actual, useTranslation: () => ({ t: (k: string) => k }) }
})

// Think 桩件：expanded 决定内容是否渲染，组头点击即用户展开
vi.mock('@ant-design/x', () => ({
    Think: ({ expanded, onExpand, title, children }: {
        expanded: boolean
        onExpand: (next: boolean) => void
        title: ReactNode
        children: ReactNode
    }) => (
        <div>
            <div data-testid="think-header" onClick={() => onExpand(!expanded)}>{title}</div>
            {expanded ? <div data-testid="think-content">{children}</div> : null}
        </div>
    ),
}))

afterEach(cleanup)

describe('ReasoningBlock 展开态', () => {
    it('思考进行中也不默认展开', () => {
        render(<ReasoningBlock text="推理内容" thinking isStreaming />)
        expect(screen.queryByTestId('think-content')).toBeNull()
    })

    it('思考已结束同样默认收起', () => {
        render(<ReasoningBlock text="推理内容" thinking={false} durationMs={1200} />)
        expect(screen.queryByTestId('think-content')).toBeNull()
    })

    it('用户点击组头才展开', () => {
        render(<ReasoningBlock text="推理内容" thinking isStreaming />)
        fireEvent.click(screen.getByTestId('think-header'))
        expect(screen.getByTestId('think-content')).not.toBeNull()
    })

    it('用户展开后思考结束不自动收起（展开态不被组件改写）', () => {
        const { rerender } = render(<ReasoningBlock text="推理内容" thinking isStreaming />)
        fireEvent.click(screen.getByTestId('think-header'))
        expect(screen.getByTestId('think-content')).not.toBeNull()

        rerender(<ReasoningBlock text="推理内容" thinking={false} durationMs={1200} />)
        expect(screen.getByTestId('think-content')).not.toBeNull()
    })
})
