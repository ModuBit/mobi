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
 * Markdown 流式渲染规格（单段架构）：
 * 全程单 XMarkdown 渲染——流式揭示中、追平间隙、消息结束，DOM 结构恒单段，
 * 无任何双段拆分/结构翻转（XMarkdown 流式管线假设 content append-only，
 * 结构变化会触发 AnimationText 整块重淡入 = 闪烁）。揭示节奏的成本控制
 * 由 useStreamingContent 的长度自适应节流承担，不靠拆段。
 * XMarkdown 与 useStreamingContent 均 mock，纯组件契约验证；真实链路由 E2E 覆盖。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { memo } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// 受控 display：测试直接驱动「揭示进度」（display 恒为 content 的前缀）
const displayState = vi.hoisted(() => ({ current: '' }))
vi.mock('@/components/ui/useStreamingContent', () => ({
    useStreamingContent: () => displayState.current,
    STREAM_BASE_RATE: 0.1,
    computeRevealRate: vi.fn(() => 0.1),
    revealIntervalFor: vi.fn(() => 0),
}))

// XMarkdown mock：按真实实现包 memo（content 值不变 + props 引用稳定 → 跳过重渲染），
// 记录每次渲染的 props 验证单段结构与 memo 短路行为
const xmdRenders = vi.hoisted(() => ({
    calls: [] as Array<{ content: string; streaming?: unknown }>,
}))
vi.mock('@ant-design/x-markdown', () => ({
    XMarkdown: memo(({ content, streaming }: { content: string; streaming?: unknown }) => {
        xmdRenders.calls.push({ content, streaming })
        return <div data-testid="xmd">{content}</div>
    }),
}))

const { Markdown } = await import('@/components/ui/Markdown')

/** 当前挂载的段（DOM 即真实渲染状态，不受历史调用记录干扰） */
function mountedSegments() {
    return screen.queryAllByTestId('xmd').map(el => el.textContent ?? '')
}

describe('Markdown 流式渲染（单段架构）', () => {
    beforeEach(() => {
        xmdRenders.calls.length = 0
        displayState.current = ''
    })

    // vitest 未开 globals：渲染型测试必须显式 cleanup，否则 DOM 累积——项目已知坑
    afterEach(() => cleanup())

    it('非流式（无 streaming prop）：单段渲染全文', () => {
        displayState.current = 'para1\n\npara2'
        render(<Markdown content={'para1\n\npara2'} />)
        expect(mountedSegments()).toEqual(['para1\n\npara2'])
        expect(xmdRenders.calls[xmdRenders.calls.length - 1].streaming).toBeUndefined()
    })

    it('流式揭示中（display < content）：单段渲染已揭示内容，带 streaming 选项', () => {
        const content = 'para1\n\npara2\n\npara3'
        displayState.current = 'para1\n\npar'
        render(<Markdown content={content} streaming typing />)
        expect(mountedSegments()).toEqual(['para1\n\npar'])
        expect(xmdRenders.calls[xmdRenders.calls.length - 1].streaming).toBeTruthy()
    })

    it('结构恒单段：揭示中 / 追平间隙 / 收敛 / 消息结束，全程无结构翻转（防闪烁回归）', () => {
        const content = 'para1\n\npara2\n\npara3'
        // 揭示中
        displayState.current = 'para1\n\npara2\n\np'
        const { rerender } = render(<Markdown content={content} streaming typing style={{ a: 1 }} />)
        expect(mountedSegments()).toEqual(['para1\n\npara2\n\np'])

        // 追平间隙（display === content，streaming 仍 true——快照间歇的常态）
        displayState.current = content
        rerender(<Markdown content={content} streaming typing style={{ a: 2 }} />)
        expect(mountedSegments()).toEqual([content])

        // 消息结束（streaming 翻 false）
        rerender(<Markdown content={content} typing style={{ a: 3 }} />)
        expect(mountedSegments()).toEqual([content])
    })

    it('display 不变时 XMarkdown 不重渲染（memo 按值短路）', () => {
        const content = 'para1\n\npara2'
        displayState.current = 'para1\n\npar'
        const { rerender } = render(<Markdown content={content} streaming typing style={{ a: 1 }} />)
        const rendersBefore = xmdRenders.calls.length

        // 同 display rerender（真实场景：父组件无关 state 变化）→ XMarkdown 跳过
        rerender(<Markdown content={content} streaming typing style={{ a: 1 }} />)
        expect(xmdRenders.calls.length).toBe(rendersBefore)

        // display 增长 → 恰好一次重渲染
        displayState.current = 'para1\n\npara'
        rerender(<Markdown content={content} streaming typing style={{ a: 2 }} />)
        expect(xmdRenders.calls.length).toBe(rendersBefore + 1)
        expect(xmdRenders.calls[xmdRenders.calls.length - 1].content).toBe('para1\n\npara')
    })
})
