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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from '@testing-library/react'
import { BubbleListChat, type ChatBubbleItem } from '@/components/chat/BubbleListChat'

// jsdom 无 ResizeObserver / IntersectionObserver，Bubble.List 与 useStickToBottom 依赖它们
const origRO = globalThis.ResizeObserver
const origIO = globalThis.IntersectionObserver
class FakeRO {
    observe() {}
    unobserve() {}
    disconnect() {}
}
class FakeIO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
}
beforeEach(() => {
    globalThis.ResizeObserver = FakeRO as unknown as typeof ResizeObserver
    globalThis.IntersectionObserver = FakeIO as unknown as typeof IntersectionObserver
})
afterEach(() => {
    globalThis.ResizeObserver = origRO
    globalThis.IntersectionObserver = origIO
})

function item(key: string): ChatBubbleItem {
    // 模拟上游 reconcileBubbleItems 输出：已挂 data-bubble-key（供 restore offsetTop 测量 + 调试定位）
    return {
        key,
        role: 'user',
        content: key,
        block: { kind: 'user-text', id: key, localId: null, createdAt: 0, text: key } as never,
        'data-bubble-key': key,
    } as ChatBubbleItem
}

describe('BubbleListChat window', () => {
    it('items <= VISIBLE_WINDOW 时全量渲染', () => {
        const items = Array.from({ length: 100 }, (_, i) => item(`k${i}`))
        const { container } = render(
            <BubbleListChat
                items={items}
                hasNextPage={false}
                isFetchingNextPage={false}
                onLoadMore={() => {}}
            />,
        )
        // 100 item 全渲染（无 window slice）
        expect(container.querySelectorAll('[data-bubble-key]').length).toBe(100)
    })

    it('following=true（默认贴底）+ items > 400 时只渲染最新 400', () => {
        const items = Array.from({ length: 500 }, (_, i) => item(`k${i}`))
        const { container } = render(
            <BubbleListChat
                items={items}
                hasNextPage={false}
                isFetchingNextPage={false}
                onLoadMore={() => {}}
            />,
        )
        expect(container.querySelectorAll('[data-bubble-key]').length).toBe(400)
        // 旧的 k0..k99 被裁掉
        expect(container.querySelector('[data-bubble-key="k99"]')).toBeNull()
        // k100 是窗口最新侧的最老一条
        expect(container.querySelector('[data-bubble-key="k100"]')).not.toBeNull()
    })
})

// ──────────────────────────────────────────────────────────────
// fill 级联语义：fill 是几何概念——内容未撑满视口时才补拉（注释「初始加载内容未溢出时连续拉页」）。
// jsdom 元素无布局，scrollHeight/clientHeight 恒 0，用原型 getter 覆写模拟几何。
// ──────────────────────────────────────────────────────────────

/** 覆写 HTMLElement 原型布局属性（scrollHeight/clientHeight），返回还原函数 */
function mockLayout({ scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }): () => void {
    // jsdom 把布局属性定义在 Element.prototype 上；还原时无描述符则直接删除
    const proto = Element.prototype as HTMLElement
    const sh = Object.getOwnPropertyDescriptor(proto, 'scrollHeight')
    const ch = Object.getOwnPropertyDescriptor(proto, 'clientHeight')
    Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => scrollHeight })
    Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => clientHeight })
    return () => {
        if (sh) Object.defineProperty(proto, 'scrollHeight', sh)
        else delete (proto as unknown as Record<string, unknown>).scrollHeight
        if (ch) Object.defineProperty(proto, 'clientHeight', ch)
        else delete (proto as unknown as Record<string, unknown>).clientHeight
    }
}

describe('BubbleListChat fill 级联', () => {
    it('内容已溢出视口时挂载不触发 onLoadMore（不得按 bubble 数量补拉）', () => {
        const restore = mockLayout({ scrollHeight: 30419, clientHeight: 143 })
        try {
            const onLoadMore = vi.fn()
            const items = Array.from({ length: 100 }, (_, i) => item(`k${i}`))
            render(
                <BubbleListChat
                    items={items}
                    hasNextPage
                    isFetchingNextPage={false}
                    onLoadMore={onLoadMore}
                />,
            )
            // 内容溢出视口 200 倍：fill 语义（补足视口）不成立，一次都不该拉。
            // 回归背景：曾用 renderItems < VISIBLE_WINDOW(400) 数量条件，tool-heavy 会话
            // ~6 消息/bubble，循环拉取直到凑够 400 bubble（实测 28 请求 / 82% 会话历史）
            expect(onLoadMore).not.toHaveBeenCalled()
        } finally {
            restore()
        }
    })

    it('内容未撑满视口且 items 变化时主动补拉（rewind 截断后 fill 重启路径）', () => {
        const restore = mockLayout({ scrollHeight: 50, clientHeight: 143 })
        try {
            const onLoadMore = vi.fn()
            const items = Array.from({ length: 100 }, (_, i) => item(`k${i}`))
            const utils = render(
                <BubbleListChat
                    items={items}
                    hasNextPage={false}
                    isFetchingNextPage={false}
                    onLoadMore={onLoadMore}
                />,
            )
            expect(onLoadMore).not.toHaveBeenCalled()
            // rewind 截断后：内容不足视口 + 变得还有历史 → effect 重启分支应主动补拉
            utils.rerender(
                <BubbleListChat
                    items={items.slice(0, 40)}
                    hasNextPage
                    isFetchingNextPage={false}
                    onLoadMore={onLoadMore}
                />,
            )
            expect(onLoadMore).toHaveBeenCalled()
        } finally {
            restore()
        }
    })
})
