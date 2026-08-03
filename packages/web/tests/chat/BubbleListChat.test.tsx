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

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
    return {
        key,
        role: 'user',
        content: key,
        block: { kind: 'user-text', id: key, localId: null, createdAt: 0, text: key } as never,
    }
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
