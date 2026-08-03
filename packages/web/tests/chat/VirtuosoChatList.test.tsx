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

import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { VirtuosoChatList, type ChatBubbleItem } from '@/components/chat/VirtuosoChatList'

/**
 * 捕获传给 Virtuoso 的 props，用来断言 computeItemKey / firstItemIndex 契约。
 * 真实 Virtuoso 需要布局测量（jsdom 无高度），这里只验证我们的 props 约定。
 */
const capturedProps: Record<string, unknown>[] = []

vi.mock('react-virtuoso', () => ({
    Virtuoso: (props: Record<string, unknown>) => {
        capturedProps.push(props)
        return null
    },
}))

afterEach(() => {
    cleanup()
    capturedProps.length = 0
})

function makeItems(count: number): ChatBubbleItem[] {
    return Array.from({ length: count }, (_, i) => ({
        key: `block-${i}`,
        role: 'assistant' as const,
        content: `msg ${i}`,
    }))
}

function renderList(items: ChatBubbleItem[]) {
    return render(<VirtuosoChatList items={items} />)
}

describe('VirtuosoChatList — React key 稳定性', () => {
    it('computeItemKey 用 item.key，不用 index 算术', () => {
        renderList(makeItems(3))
        const { computeItemKey } = capturedProps[0] as {
            computeItemKey: (i: number, item: ChatBubbleItem) => string
        }
        const items = makeItems(3)
        expect(computeItemKey(0, items[0])).toBe('block-0')
        expect(computeItemKey(2, items[2])).toBe('block-2')
    })

    it('key 与位置解耦：同一条消息 prepend 后仍是同一个 key', () => {
        renderList(makeItems(2))
        const { computeItemKey } = capturedProps[0] as {
            computeItemKey: (i: number, item: ChatBubbleItem) => string
        }
        const item = { key: 'block-1', role: 'assistant' as const, content: 'x' }
        // 位置从 1 变到 51（prepend 50 条历史），key 必须不变，否则整列表重挂载
        expect(computeItemKey(1, item)).toBe(computeItemKey(51, item))
    })

    it('大量 item 的 key 全部唯一（回归：MAX_SAFE_INTEGER 浮点坍缩致 key 碰撞）', () => {
        const items = makeItems(500)
        renderList(items)
        const { computeItemKey } = capturedProps[0] as {
            computeItemKey: (i: number, item: ChatBubbleItem) => string
        }
        const keys = items.map((it, i) => computeItemKey(i, it))
        expect(new Set(keys).size).toBe(items.length)
    })
})

describe('VirtuosoChatList — 稳定引用（memo 生效前提）', () => {
    it('itemContent / computeItemKey / components 跨渲染保持同一引用', () => {
        const items = makeItems(3)
        const { rerender } = render(<VirtuosoChatList items={items} />)
        // 换 items 引用触发重渲染（真实场景：SSE 到达）
        rerender(<VirtuosoChatList items={[...items]} />)

        expect(capturedProps.length).toBeGreaterThanOrEqual(2)
        const [a, b] = capturedProps
        expect(b.itemContent).toBe(a.itemContent)
        expect(b.computeItemKey).toBe(a.computeItemKey)
        expect(b.components).toBe(a.components)
    })

    it('Header 组件类型恒定，加载态经 context 传入（回归：闭包 Header 致卸载重挂）', () => {
        const items = makeItems(2)
        const { rerender } = render(<VirtuosoChatList items={items} isFetchingNextPage={false} />)
        rerender(<VirtuosoChatList items={items} isFetchingNextPage={true} />)

        const [a, b] = capturedProps as Array<{
            components: { Header: unknown }
            context: { isFetchingNextPage: boolean }
        }>
        // 组件类型必须是同一个引用，否则 React 卸载旧子树 → Header 输出不进 DOM
        expect(b.components.Header).toBe(a.components.Header)
        // 状态变化体现在 context 上
        expect(a.context.isFetchingNextPage).toBe(false)
        expect(b.context.isFetchingNextPage).toBe(true)
    })
})

describe('VirtuosoChatList — firstItemIndex 安全区间', () => {
    it('起始值远离 2^53 边界，index 算术不丢精度', () => {
        renderList(makeItems(1))
        const { firstItemIndex } = capturedProps[0] as { firstItemIndex: number }

        expect(firstItemIndex).toBeGreaterThan(0)
        // 关键回归断言：起点 + 大量 prepend 后仍必须落在整数安全区，
        // 且相邻 index 不能坍缩成同一个值（MAX_SAFE_INTEGER 起点会）
        expect(firstItemIndex).toBeLessThan(Number.MAX_SAFE_INTEGER / 1000)
        expect(firstItemIndex + 1).not.toBe(firstItemIndex + 2)
        expect(Number.isSafeInteger(firstItemIndex)).toBe(true)
    })
})

describe('VirtuosoChatList — firstItemIndex prepend 检测（末项锚）', () => {
    /**
     * prepend 检测用「末项 key 锚」而非「首项 key findIndex」——
     * 因为 reducer 重新归约时边界 block 的 id 会变化（孤立 permission block 在对应 tool_use
     * 加载后消失/并入），prevFirstKey 在新 items 里 findIndex 返回 -1，旧逻辑直接跳过不减，
     * 导致 Virtuoso 误判 prepend 为 append，首次加载历史后 startReached 永久失效。
     * 改用末项锚：末项 key 不变 + 长度增长 = prepend，增量 = 长度差。
     */
    it('prepend（末项 key 不变 + 长度增长）时 firstItemIndex 减小 prepend 量', () => {
        const initial = makeItems(5) // 末项 key = block-4
        const { rerender } = render(<VirtuosoChatList items={initial} />)
        const fiiBefore = capturedProps.at(-1)!.firstItemIndex as number

        // 开头插入 3 条，末项仍是 block-4
        const prepended: ChatBubbleItem[] = [
            { key: 'new-0', role: 'assistant', content: 'n0' },
            { key: 'new-1', role: 'assistant', content: 'n1' },
            { key: 'new-2', role: 'assistant', content: 'n2' },
            ...initial,
        ]
        rerender(<VirtuosoChatList items={prepended} />)
        const fiiAfter = capturedProps.at(-1)!.firstItemIndex as number

        expect(fiiAfter).toBe(fiiBefore - 3)
    })

    it('append（末项 key 变）时 firstItemIndex 不变', () => {
        const initial = makeItems(5)
        const { rerender } = render(<VirtuosoChatList items={initial} />)
        const fiiBefore = capturedProps.at(-1)!.firstItemIndex as number

        // 末尾追加 1 条，末项 key 变成 new-5
        const appended: ChatBubbleItem[] = [
            ...initial,
            { key: 'new-5', role: 'assistant', content: 'n5' },
        ]
        rerender(<VirtuosoChatList items={appended} />)
        const fiiAfter = capturedProps.at(-1)!.firstItemIndex as number

        expect(fiiAfter).toBe(fiiBefore)
    })

    it('末项不变但 reducer 重组（prevFirstKey 消失）仍按长度差减——容忍边界 block 重组', () => {
        // 模拟实测场景：prepend 前 items[0]="call-x"（孤立 permission block），
        // prepend 后该 block 消失（并入真实 tool-call），但末项不变、整体仍增长
        const initial: ChatBubbleItem[] = [
            { key: 'call-orphan', role: 'assistant', content: 'orphan' },
            ...makeItems(4), // block-0..block-3，末项 block-3
        ]
        const { rerender } = render(<VirtuosoChatList items={initial} />)
        const fiiBefore = capturedProps.at(-1)!.firstItemIndex as number

        // prepend 2 条 + 旧的 call-orphan 消失（重组），末项 block-3 不变，长度 5 → 6
        const reorganized: ChatBubbleItem[] = [
            { key: 'old-1', role: 'assistant', content: 'o1' },
            { key: 'old-2', role: 'assistant', content: 'o2' },
            ...makeItems(4), // block-0..block-3，末项 block-3 不变
        ]
        rerender(<VirtuosoChatList items={reorganized} />)
        const fiiAfter = capturedProps.at(-1)!.firstItemIndex as number

        // 末项 block-3 不变，长度从 5 → 6，按长度差减 1（容忍 call-orphan 消失）
        expect(fiiAfter).toBe(fiiBefore - 1)
    })
})
