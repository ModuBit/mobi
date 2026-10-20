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

import { describe, it, expect } from 'vitest'
import { foldErrorEvents } from '@/domain/chat/reducerEvents'
import type { ChatBlock, ErrorEvent } from '@/domain/chat'

function errorBlock(id: string, attempt: number, category: ErrorEvent['category']): ChatBlock {
    return {
        kind: 'agent-event',
        id,
        createdAt: attempt,
        event: {
            type: 'error',
            attempt,
            maxRetries: 5,
            message: `${category} error`,
            isNetworkDown: false,
            category,
            evidence: { matchedBy: 'status', value: '429' },
            raw: null,
        },
    }
}

function textBlock(id: string): ChatBlock {
    return { kind: 'agent-text', id, localId: null, createdAt: 0, text: 'hello' }
}

describe('foldErrorEvents', () => {
    it('相邻同类错误折叠为最新一次，尝试次数取最大', () => {
        const out = foldErrorEvents([
            errorBlock('e1', 1, 'rate_limit'),
            errorBlock('e2', 2, 'rate_limit'),
            errorBlock('e3', 3, 'rate_limit'),
        ])
        expect(out).toHaveLength(1)
        const event = out[0]!.kind === 'agent-event' ? out[0]!.event : null
        expect(out[0]!.id).toBe('e3')
        expect(event && event.type === 'error' && event.attempt).toBe(3)
        expect(event && event.type === 'error' && event.maxRetries).toBe(5)
    })

    it('类别切换 → 新起一张卡片', () => {
        const out = foldErrorEvents([
            errorBlock('e1', 1, 'rate_limit'),
            errorBlock('e2', 1, 'overloaded'),
        ])
        expect(out).toHaveLength(2)
        expect(out.map((b) => b.id)).toEqual(['e1', 'e2'])
    })

    it('中间插入普通事件 → 不折叠', () => {
        const out = foldErrorEvents([
            errorBlock('e1', 1, 'rate_limit'),
            textBlock('t1'),
            errorBlock('e2', 1, 'rate_limit'),
        ])
        expect(out).toHaveLength(3)
        expect(out.map((b) => b.id)).toEqual(['e1', 't1', 'e2'])
    })

    it('非错误事件原样保留', () => {
        const out = foldErrorEvents([textBlock('t1'), textBlock('t2')])
        expect(out.map((b) => b.id)).toEqual(['t1', 't2'])
    })
})
