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
 * Markdown 流式增量渲染规格：
 * 揭示进行中（display < content）按稳定前缀拆双段——stable 段零 re-parse、
 * tail 段承接流式；收敛后（display === content）回归单段渲染。
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
}))

// XMarkdown mock：按真实实现包 memo（content 值不变 + props 引用稳定 → 跳过重渲染），
// 记录每次渲染的 props 验证双段结构与 stable 段短路行为
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

describe('Markdown 流式增量渲染', () => {
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
        // 无 streaming prop
        expect(xmdRenders.calls[xmdRenders.calls.length - 1].streaming).toBeUndefined()
    })

    it('流式揭示中（display < content）：拆双段，stable 无 streaming、tail 承接流式，拼接 === display', () => {
        const content = 'para1\n\npara2\n\npara3'
        displayState.current = 'para1\n\npara2\n\np'
        render(<Markdown content={content} streaming typing />)
        const segs = mountedSegments()
        expect(segs).toHaveLength(2)
        expect(segs[0]).toBe('para1\n\npara2\n\n')
        expect(segs[1]).toBe('p')
        // 稳定前缀段不传 streaming（无尾部动画/渐显）
        const lastTwo = xmdRenders.calls.slice(-2)
        expect(lastTwo[0].streaming).toBeUndefined()
        expect(lastTwo[1].streaming).toBeTruthy()
        expect(segs.join('')).toBe(displayState.current)
    })

    it('揭示收敛（display === content）：回归单段渲染全文', () => {
        const content = 'para1\n\npara2'
        displayState.current = content
        // memo 组件：rerender 须有 prop 变化才重渲染（真实场景 display 是组件内部 state）
        const { rerender } = render(<Markdown content={content} streaming typing style={{ a: 1 }} />)
        expect(mountedSegments()).toEqual([content])

        // 先进入双段
        displayState.current = 'para1\n\npar'
        rerender(<Markdown content={content} streaming typing style={{ a: 2 }} />)
        expect(mountedSegments()).toEqual(['para1\n\n', 'par'])

        // 再收敛回单段（双段结构一次性归一）
        displayState.current = content
        rerender(<Markdown content={content} streaming typing style={{ a: 3 }} />)
        expect(mountedSegments()).toEqual([content])
    })

    it('stable 段 memo：display 增长但完成块不变时，stable 段不再重渲染（只 tail 重渲染）', () => {
        const content = 'para1\n\npara2 tail tail tail'
        displayState.current = 'para1\n\npara2 t'
        const { rerender } = render(<Markdown content={content} streaming typing style={{ a: 1 }} />)

        // 帧序列：stable 不变、tail 增长（每次 rerender 传新 style 引用穿透 memo）
        const frames = ['para1\n\npara2 ta', 'para1\n\npara2 tai']
        frames.forEach((display, i) => {
            displayState.current = display
            rerender(<Markdown content={content} streaming typing style={{ a: i + 2 }} />)
        })

        // stable 内容（'para1\n\n'）只应渲染一次；每次 tail 增长各渲染一次
        const stableRenders = xmdRenders.calls.filter(c => c.content === 'para1\n\n')
        expect(stableRenders).toHaveLength(1)
        const tailRenders = xmdRenders.calls.filter(c => c.content.startsWith('para2'))
        expect(tailRenders.map(c => c.content)).toEqual(['para2 t', 'para2 ta', 'para2 tai'])
    })
})
