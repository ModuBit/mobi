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
import { formatEvent } from '@/domain/chat/eventFormatter'
import { terminalReasonLabelKey } from '@/domain/chat/terminalReason'
import type { AgentEvent } from '@/domain/chat/types'

// t 直通：断言选中的 i18n key 与参数（不测文案本身，文案在 locales JSON）
const t = (key: string, params?: Record<string, unknown>) =>
    params ? `${key}<<${JSON.stringify(params)}>>` : key

function abortedEvent(extra: Record<string, unknown>): AgentEvent {
    return { type: 'aborted', numTurns: null, ...extra } as unknown as AgentEvent
}

function firstText(node: unknown): string {
    // formatEvent 返回 ReactNode（div 包 span），递归抽取文本子串供断言
    if (node == null || typeof node === 'boolean') return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(firstText).join('|')
    const el = node as { props?: { children?: unknown } }
    return el.props ? firstText(el.props.children) : ''
}

describe('aborted 灰行文案优先级（spec §4.3，自上而下首条命中）', () => {
    it('无新字段 → 会话已中断（现状）', () => {
        const out = firstText(formatEvent(abortedEvent({}), t))
        expect(out).toContain('chat.aborted')
        expect(out).not.toContain('abortedStillQueued')
        expect(out).not.toContain('abortedQueueCleared')
        expect(out).not.toContain('abortedAllStopped')
    })

    it('stillQueuedCount>0 → 会话已中断 · N 条消息仍会执行', () => {
        const out = firstText(formatEvent(abortedEvent({ stillQueuedCount: 2 }), t))
        expect(out).toContain('chat.abortedStillQueued')
        expect(out).toContain('"count":2')
    })

    it("stopKind='turn-queue' 且无 stillQueued → 会话已中断，队列已清空", () => {
        const out = firstText(formatEvent(abortedEvent({ stopKind: 'turn-queue' }), t))
        expect(out).toContain('chat.abortedQueueCleared')
    })

    it("stopKind='turn-queue-tasks' 且无 stillQueued → 会话已中断，队列与后台任务已停止", () => {
        const out = firstText(formatEvent(abortedEvent({ stopKind: 'turn-queue-tasks' }), t))
        expect(out).toContain('chat.abortedAllStopped')
    })

    it('stopKind=turn → 与现状同文案（点按只停本轮，无附加说明）', () => {
        const out = firstText(formatEvent(abortedEvent({ stopKind: 'turn' }), t))
        expect(out).toContain('chat.aborted')
        expect(out).not.toContain('<<')  // turn 不带参数
    })

    it('优先级：stillQueued 命中时压过 stopKind 动作描述', () => {
        const out = firstText(formatEvent(abortedEvent({ stopKind: 'turn-queue', stillQueuedCount: 1 }), t))
        expect(out).toContain('chat.abortedStillQueued')
    })
})

describe('terminalReasonLabelKey（cancelled 终态原因标注，spec §7.6）', () => {
    it('命中已知 key 出文案 key', () => {
        expect(terminalReasonLabelKey('api_error')).toBe('chat.terminalReason.api_error')
        expect(terminalReasonLabelKey('budget_exhausted')).toBe('chat.terminalReason.budget_exhausted')
    })
    it('未知 key / 缺省 不出（开放透传，web 只解释已知集合）', () => {
        expect(terminalReasonLabelKey('policy')).toBeNull()
        expect(terminalReasonLabelKey(undefined)).toBeNull()
        expect(terminalReasonLabelKey(null)).toBeNull()
    })
})
