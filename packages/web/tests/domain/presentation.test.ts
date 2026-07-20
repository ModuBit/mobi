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
import { isClearInProgress } from '../../src/domain/chat/presentation'
import type { ChatBlock } from '../../src/domain/chat/types'

function userText(text: string): ChatBlock {
    return { kind: 'user-text', id: 'u', localId: null, createdAt: 0, text }
}
function contextCleared(): ChatBlock {
    return { kind: 'agent-event', id: 'a', createdAt: 0, event: { type: 'context-cleared' } }
}
function agentText(text: string): ChatBlock {
    return { kind: 'agent-text', id: 't', localId: null, createdAt: 0, text }
}

describe('isClearInProgress', () => {
    it('末尾是 /clear user-text → 进行中', () => {
        expect(isClearInProgress([agentText('hi'), userText('/clear')])).toBe(true)
    })

    it('/clear 后出现 context-cleared → 已完成', () => {
        expect(isClearInProgress([userText('/clear'), contextCleared()])).toBe(false)
    })

    it('/clear 后又发了普通消息 → 不在 clear 中', () => {
        expect(isClearInProgress([userText('/clear'), contextCleared(), userText('hello')])).toBe(false)
    })

    it('末尾是普通用户消息 → false', () => {
        expect(isClearInProgress([userText('/clear'), agentText('ok'), userText('hello')])).toBe(false)
    })

    it('空列表 → false', () => {
        expect(isClearInProgress([])).toBe(false)
    })

    it('/clear 带前后空白仍识别', () => {
        expect(isClearInProgress([userText('  /clear  ')])).toBe(true)
    })

    it('非 /clear 的斜杠命令 → false', () => {
        expect(isClearInProgress([userText('/compact')])).toBe(false)
    })
})
