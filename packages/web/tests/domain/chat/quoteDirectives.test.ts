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

    it('steer 场景：同一轮内多条 user 时，回复归属最近一条 user（模型实际看到的最新引用）', () => {
        // 块序 u1, u2, r1, r2——r1/r2 都在 u2 之后产出，模型视野里最新的是 u2 的引用
        const blocks = [user('u1', quote('m1')), user('u2', quote('m2')), agent('r1'), agent('r2')]
        const map = collectQuoteAnnotationsByAgentId(blocks)
        expect(map.get('r1')?.[0].messageId).toBe('m2')
        expect(map.get('r2')?.[0].messageId).toBe('m2')
    })

    it('未回复的 user 不累积错位（2026-10-20 生产实锤：长会话 FIFO 队列越跑越偏）', () => {
        // u1 有引用但没有正文回复（工具调用轮/中断轮），u2 的回复必须拿到 u2 自己的引用
        const blocks = [
            user('u1', quote('m1')),
            user('u2', quote('m2')), agent('r2'),
            user('u3', quote('m3')), agent('r3'),
        ]
        const map = collectQuoteAnnotationsByAgentId(blocks)
        expect(map.get('r2')?.[0].messageId).toBe('m2')
        expect(map.get('r3')?.[0].messageId).toBe('m3')
    })

    it('一轮多条 agent-text 只归属本轮 user，不吞掉后续 user 的引用', () => {
        // 一个 turn 常有 thinking/text 分段产生多条 agent-text；旧实现每条都消费一个 user
        const blocks = [user('u1', quote('m1')), agent('r1a'), agent('r1b'), user('u2', quote('m2')), agent('r2')]
        const map = collectQuoteAnnotationsByAgentId(blocks)
        expect(map.get('r1a')?.[0].messageId).toBe('m1')
        expect(map.get('r1b')?.[0].messageId).toBe('m1')
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
