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

import { describe, expect, it } from 'vitest'
import { reconcileBubbleItems, type BubbleItemsCache } from '@/components/chat/reconcileBubbleItems'
import type { ChatBubbleItem } from '@/components/chat/BubbleListChat'
import type { ChatBlock } from '@/domain/chat'

function block(id: string): ChatBlock {
    return { kind: 'agent-text', id, createdAt: 1, text: `t-${id}` } as ChatBlock
}

/** 模拟 buildChatBubbleItems：每次都产出全新 item 对象与全新 content */
function makeItem(b: ChatBlock, overrides: Partial<ChatBubbleItem> = {}): ChatBubbleItem {
    return {
        key: b.id,
        role: 'assistant',
        content: `rendered-${b.id}`,
        block: b,
        ...overrides,
    }
}

describe('reconcileBubbleItems', () => {
    it('block 引用未变时复用上一帧 item 对象（memo 得以生效）', () => {
        const b = block('a')
        const first = reconcileBubbleItems([makeItem(b)], new Map())
        // 第二帧：全新 item 对象，但 block 引用相同
        const second = reconcileBubbleItems([makeItem(b)], first.cache)

        expect(second.items[0]).toBe(first.items[0])
    })

    it('block 引用变化时重建（内容已更新，不能复用旧 content）', () => {
        const first = reconcileBubbleItems([makeItem(block('a'))], new Map())
        // 流式更新：同 id 但新 block 对象（reconcileChatBlocks 判定内容有变）
        const nextItem = makeItem(block('a'))
        const second = reconcileBubbleItems([nextItem], first.cache)

        expect(second.items[0]).toBe(nextItem)
        expect(second.items[0]).not.toBe(first.items[0])
    })

    it.each([
        ['role', { role: 'user' as const }],
        ['typing', { typing: true }],
        ['variant', { variant: 'borderless' as const }],
    ])('影响渲染的 %s 变化时重建', (_label, override) => {
        const b = block('a')
        const first = reconcileBubbleItems([makeItem(b)], new Map())
        const second = reconcileBubbleItems([makeItem(b, override)], first.cache)

        expect(second.items[0]).not.toBe(first.items[0])
    })

    it('无 block 的合成项（compressing / divider 占位）不复用', () => {
        const synthetic: ChatBubbleItem = { key: '__compressing__', role: 'assistant', content: 'x' }
        const first = reconcileBubbleItems([synthetic], new Map())
        const nextSynthetic: ChatBubbleItem = { key: '__compressing__', role: 'assistant', content: 'x' }
        const second = reconcileBubbleItems([nextSynthetic], first.cache)

        expect(second.items[0]).toBe(nextSynthetic)
    })

    it('prepend 历史后，原有项仍复用旧引用（只有新项是新对象）', () => {
        const older = block('older')
        const existing = block('existing')
        const first = reconcileBubbleItems([makeItem(existing)], new Map())

        const second = reconcileBubbleItems(
            [makeItem(older), makeItem(existing)],
            first.cache,
        )

        expect(second.items[1]).toBe(first.items[0])
        expect(second.items[0].key).toBe('older')
    })

    it('缓存只保留当帧 item，移除的项不泄漏（/clear 后不占内存）', () => {
        const a = block('a')
        const bb = block('b')
        const first = reconcileBubbleItems([makeItem(a), makeItem(bb)], new Map())
        expect(first.cache.size).toBe(2)

        const second = reconcileBubbleItems([makeItem(a)], first.cache)
        expect(second.cache.size).toBe(1)
        expect(second.cache.has('b')).toBe(false)
    })

    it('空输入返回空结果，不抛错', () => {
        const cache: BubbleItemsCache = new Map()
        const { items, cache: next } = reconcileBubbleItems([], cache)
        expect(items).toEqual([])
        expect(next.size).toBe(0)
    })
})
