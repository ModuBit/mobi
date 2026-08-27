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
import { isClearInProgress, isCommandInProgress, COMPACT_COMMAND, isCompactCompletion } from '../../src/domain/chat/presentation'
import type { ChatBlock } from '../../src/domain/chat/types'

function userText(text: string): ChatBlock {
    return { kind: 'user-text', id: 'u', localId: null, createdAt: 0, blocks: [{ type: 'text', text }] }
}
function contextCleared(): ChatBlock {
    return { kind: 'agent-event', id: 'a', createdAt: 0, event: { type: 'context-cleared' } }
}
function agentText(text: string): ChatBlock {
    return { kind: 'agent-text', id: 't', localId: null, createdAt: 0, text }
}
/** compact 成功完成标志：compact-summary block */
function compactSummary(): ChatBlock {
    return { kind: 'compact-summary', id: 'c', localId: null, createdAt: 0, text: 'summary', preTokens: 100, postTokens: 50, durationMs: 10 }
}
/** compact 通用完成标志：CLI 在 compact 结束时（无论成功失败）发出的结构化事件 */
function compactCompleted(): ChatBlock {
    return { kind: 'agent-event', id: 'd', createdAt: 0, event: { type: 'compact-completed' } }
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

describe('isCommandInProgress (/compact)', () => {
    const isCompressing = (blocks: ChatBlock[]) =>
        isCommandInProgress(blocks, COMPACT_COMMAND, isCompactCompletion)

    it('末尾是 /compact user-text，无完成标志 → 进行中', () => {
        expect(isCompressing([agentText('hi'), userText('/compact')])).toBe(true)
    })

    it('/compact 后出现 compact-summary → 已完成（成功路径）', () => {
        expect(isCompressing([userText('/compact'), compactSummary()])).toBe(false)
    })

    it('/compact 后出现 compact-completed 事件 → 已完成（失败路径兜底）', () => {
        // 失败路径：SDK 返回 "Not enough messages to compact."，无 compact-summary，
        // 仅 CLI 发出的 compact-completed 结构化事件作为完成标志
        expect(isCompressing([userText('/compact'), agentText('Not enough messages to compact.'), compactCompleted()])).toBe(false)
    })

    it('/compact 后只有 assistant 回复而无任何完成标志 → 仍进行中（未收到完成信号）', () => {
        // 这是缺陷场景的反例：若 compact-completed 事件丢失，仍应判定进行中而非误判完成
        expect(isCompressing([userText('/compact'), agentText('Not enough messages to compact.')])).toBe(true)
    })

    it('/compact 后又发了普通消息 → 不在 compact 中', () => {
        expect(isCompressing([userText('/compact'), compactCompleted(), userText('hello')])).toBe(false)
    })

    it('空列表 → false', () => {
        expect(isCompressing([])).toBe(false)
    })
})
