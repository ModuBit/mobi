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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { memo, type ReactNode } from 'react'
import { render, cleanup } from '@testing-library/react'
import { Bubble } from '@ant-design/x'

/** 带渲染计数的 memo block，模拟 TextBlock / ReasoningBlock 等 memo 化的 block 组件 */
function makeCountedBlock(label: string) {
    let count = 0
    const Block = memo(function CountedBlock({ children }: { children: ReactNode }) {
        count++
        return <div data-testid={label}>{children}</div>
    })
    return {
        Block,
        getCount: () => count,
    }
}

/**
 * 验证：Bubble.List 全量重渲（items 数组每次重建、content 每次是新 React 元素）时，
 * memo 化的 block 子组件因 props 浅比较相等而跳过 reconcile。
 *
 * 这复现 ChatContainer 的真实路径：流式 snapshot 到达 → decoratedItems useMemo 重算 →
 * buildChatBubbleItems 对每个 block 调 renderChatBlock 产生新 JSX → Bubble.List 收到新 items。
 * 关键问题：前面的、未变化的 block 是否被 memo 拦截而不重渲。
 */
describe('Bubble.List 流式渲染隔离', () => {
    beforeEach(() => {
        // Bubble.List 的 useCompatibleScroll 依赖 ResizeObserver，jsdom 无原生实现
        vi.stubGlobal('ResizeObserver', class {
            observe() { /* noop */ }
            unobserve() { /* noop */ }
            disconnect() { /* noop */ }
        })
        // Bubble.List 的 useCompatibleScroll 还用到 IntersectionObserver
        vi.stubGlobal('IntersectionObserver', class {
            observe() { /* noop */ }
            unobserve() { /* noop */ }
            disconnect() { /* noop */ }
            takeRecords() { return [] }
        })
    })
    afterEach(() => {
        vi.unstubAllGlobals()
        cleanup()
    })

    it('流式只改最后一个 item 时，前面的 memo block 不重渲', () => {
        const a = makeCountedBlock('block-a')
        const b = makeCountedBlock('block-b')
        const c = makeCountedBlock('block-c')

        const buildItems = (cText: string) => [
            { key: '1', role: 'user' as const, content: <a.Block>aaa</a.Block> },
            { key: '2', role: 'user' as const, content: <b.Block>bbb</b.Block> },
            { key: '3', role: 'user' as const, content: <c.Block>{cText}</c.Block> },
        ]

        const { rerender } = render(<Bubble.List items={buildItems('c1')} />)
        expect(a.getCount()).toBe(1)
        expect(b.getCount()).toBe(1)
        expect(c.getCount()).toBe(1)

        // 模拟流式 snapshot 到达：重建整个 items 数组，仅最后一个内容变化
        rerender(<Bubble.List items={buildItems('c2')} />)

        // 未变化的 block 应被 memo 拦截
        expect(a.getCount()).toBe(1)
        expect(b.getCount()).toBe(1)
        // 变化的 block 重渲一次
        expect(c.getCount()).toBe(2)
    })

    it('变化发生在中间 item 时，只有该 item 重渲（非「只有最后一个」）', () => {
        // 模拟：tool-call 完成（中间 item 状态变化），最后 item 不变
        const a = makeCountedBlock('mid-a')
        const b = makeCountedBlock('mid-b')
        const c = makeCountedBlock('mid-c')

        const buildItems = (bText: string) => [
            { key: '1', role: 'user' as const, content: <a.Block>aaa</a.Block> },
            { key: '2', role: 'user' as const, content: <b.Block>{bText}</b.Block> },
            { key: '3', role: 'user' as const, content: <c.Block>ccc</c.Block> },
        ]

        const { rerender } = render(<Bubble.List items={buildItems('b1')} />)
        expect(a.getCount()).toBe(1)
        expect(b.getCount()).toBe(1)
        expect(c.getCount()).toBe(1)

        // 只改中间的 b（模拟 tool 完成/分组等中间变化）
        rerender(<Bubble.List items={buildItems('b2')} />)
        expect(a.getCount()).toBe(1) // 未变 → 跳过
        expect(b.getCount()).toBe(2) // 变了 → 重渲
        expect(c.getCount()).toBe(1) // 未变 → 跳过
    })

    it('若传入不稳定 prop（如新对象），memo 失效 → 全量重渲（反例对照）', () => {
        const a = makeCountedBlock('block-a2')
        const b = makeCountedBlock('block-b2')
        const c = makeCountedBlock('block-c2')

        // 给每个 block 传一个每次新建的对象 prop（模拟 metadata 引用不稳）
        const buildItems = (cText: string, tag: number) => [
            { key: '1', role: 'user' as const, content: <a.Block><span data-tag={tag}>aaa</span></a.Block> },
            { key: '2', role: 'user' as const, content: <b.Block><span data-tag={tag}>bbb</span></b.Block> },
            { key: '3', role: 'user' as const, content: <c.Block>{cText}</c.Block> },
        ]

        const { rerender } = render(<Bubble.List items={buildItems('c1', 1)} />)
        rerender(<Bubble.List items={buildItems('c2', 2)} />)

        // children 每次是新 span 元素 → memo 失效 → 全部重渲
        expect(a.getCount()).toBe(2)
        expect(b.getCount()).toBe(2)
        expect(c.getCount()).toBe(2)
    })
})
