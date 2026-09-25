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

// quoteDirectives 行为锁定：quote 指令注册语义 + 批注↔回复配对（spec .scratch/response-annotations 票 03）
// 通用指令语法/扫描/去重管线的行为锁定在 directives.test.ts
import { describe, expect, it } from 'vitest'
import { collectQuoteAnnotationsByAgentId } from '@/domain/chat/quoteDirectives'
import type { UserContentBlock } from '@mobi/shared'
import type { ChatBlock } from '@/domain/chat/types'

describe('collectQuoteAnnotationsByAgentId（批注↔回复 turn 配对）', () => {
    const quote = (messageId: string, excerpt = `摘录-${messageId}`) =>
        ({ type: 'quote', messageId, role: 'agent', excerpt }) as UserContentBlock
    const user = (id: string, ...quotes: UserContentBlock[]): ChatBlock =>
        ({ kind: 'user-text', id, localId: id, createdAt: 0, blocks: quotes })
    const agent = (id: string): ChatBlock =>
        ({ kind: 'agent-text', id, localId: id, createdAt: 0, text: `回复-${id}` })

    it('常规一轮：同轮多条 agent 消息共享该轮引用；下一轮 user 换血', () => {
        const blocks = [user('u1', quote('m1')), agent('r1'), agent('r2'), user('u2', quote('m2')), agent('r3')]
        const map = collectQuoteAnnotationsByAgentId(blocks)
        expect(map.get('r1')?.[0].messageId).toBe('m1')
        expect(map.get('r2')?.[0].messageId).toBe('m1')
        expect(map.get('r3')?.[0].messageId).toBe('m2')
    })

    it('steer 场景：回复落库前用户连发多条，回复按 FIFO 消费最早未配对的 user 引用', () => {
        // 块序 u1, u2, r1, r2（r1 是对 u1 的回复，r2 才处理 u2 的 steer）——线性覆盖会让 r1 错配 u2
        const blocks = [user('u1', quote('m1')), user('u2', quote('m2')), agent('r1'), agent('r2')]
        const map = collectQuoteAnnotationsByAgentId(blocks)
        expect(map.get('r1')?.[0].messageId).toBe('m1')
        expect(map.get('r2')?.[0].messageId).toBe('m2')
    })

    it('无引用 user 是边界：其后的回复不沿用上一轮引用', () => {
        const blocks = [user('u1', quote('m1')), agent('r1'), user('u2'), agent('r2')]
        const map = collectQuoteAnnotationsByAgentId(blocks)
        expect(map.get('r1')?.[0].messageId).toBe('m1')
        expect(map.has('r2')).toBe(false)
    })

    it('会话无任何引用返回共享空 Map', () => {
        expect(collectQuoteAnnotationsByAgentId([user('u1'), agent('r1')])).toBe(collectQuoteAnnotationsByAgentId([]))
    })
})
