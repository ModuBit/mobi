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
import { formatEvent, type FormattedEvent } from '@/domain/chat/eventFormatter'
import { terminalReasonLabelKey } from '@/domain/chat/terminalReason'
import { formatMessageTime } from '@/core/utils/timeFormat'
import type { AgentEvent } from '@/domain/chat/types'

function abortedEvent(extra: Record<string, unknown>): AgentEvent {
    return { type: 'aborted', numTurns: null, ...extra } as unknown as AgentEvent
}

/**
 * 结构化描述扁平化（分层治理票 01 起 formatEvent 纯数据化）：
 * I18nText 断言选中的 key 与参数（不测文案本身，文案在 locales JSON），
 * 行为与旧 ReactNode 版的 firstText 断言同语义。
 */
function flat(f: FormattedEvent): string {
    if (f === null) return ''
    if (f.kind === 'lines') {
        return f.lines
            .flatMap((l) => l.segments)
            .map((s) => (typeof s === 'string' ? s : (s.params ? `${s.key}<<${JSON.stringify(s.params)}>>` : s.key)))
            .join('|')
    }
    return 'turn-result'
}

describe('aborted 灰行文案优先级（spec §4.3，自上而下首条命中）', () => {
    it('无新字段 → 会话已中断（现状）', () => {
        const out = flat(formatEvent(abortedEvent({})))
        expect(out).toContain('chat.aborted')
        expect(out).not.toContain('abortedStillQueued')
        expect(out).not.toContain('abortedQueueCleared')
        expect(out).not.toContain('abortedAllStopped')
    })

    it('stillQueuedCount>0 → 会话已中断 · N 条消息仍会执行', () => {
        const out = flat(formatEvent(abortedEvent({ stillQueuedCount: 2 })))
        expect(out).toContain('chat.abortedStillQueued')
        expect(out).toContain('"count":2')
    })

    it("stopKind='turn-queue' 且无 stillQueued → 会话已中断，队列已清空", () => {
        const out = flat(formatEvent(abortedEvent({ stopKind: 'turn-queue' })))
        expect(out).toContain('chat.abortedQueueCleared')
    })

    it("stopKind='turn-queue-tasks' 且无 stillQueued → 会话已中断，队列与后台任务已停止", () => {
        const out = flat(formatEvent(abortedEvent({ stopKind: 'turn-queue-tasks' })))
        expect(out).toContain('chat.abortedAllStopped')
    })

    it('stopKind=turn → 与现状同文案（点按只停本轮，无附加说明）', () => {
        const out = flat(formatEvent(abortedEvent({ stopKind: 'turn' })))
        expect(out).toContain('chat.aborted')
        expect(out).not.toContain('<<')  // turn 不带参数
    })

    it('优先级：stillQueued 命中时压过 stopKind 动作描述', () => {
        const out = flat(formatEvent(abortedEvent({ stopKind: 'turn-queue', stillQueuedCount: 1 })))
        expect(out).toContain('chat.abortedStillQueued')
    })

    it('带指标时概要串接 duration · tokens（mono 行 + createdAt 时间戳后缀）', () => {
        const f = formatEvent(abortedEvent({ durationMs: 65000, tokens: 2000 }), 1730000000000)
        expect(f).toEqual({
            kind: 'lines',
            lines: [{
                segments: [{ key: 'chat.aborted' }, ' · 1m 5s · 2.0k tokens'],
                mono: true,
                timeSuffix: formatMessageTime(1730000000000),
            }],
        })
    })
})

describe('formatEvent 结构化产出（分层治理票 01）', () => {
    it('title-changed 与未知类型 → null（不渲染）', () => {
        expect(formatEvent({ type: 'title-changed' })).toBeNull()
        expect(formatEvent({ type: 'unknown-event' })).toBeNull()
    })

    it('turn-duration / switch → 单行 i18n（key + 插值参数，t() 由渲染端执行）', () => {
        const dur = formatEvent({ type: 'turn-duration', durationMs: 1500 })
        expect(dur).toEqual({ kind: 'lines', lines: [{ segments: [{ key: 'chat.durationValue', params: { value: '1.5s' } }] }] })

        const sw = formatEvent({ type: 'switch', mode: 'plan' })
        expect(sw).toEqual({ kind: 'lines', lines: [{ segments: [{ key: 'chat.switchMode', params: { mode: 'plan' } }] }] })
    })

    it('api-retry → 主行 + 可选重试延时行（spaced）', () => {
        const f = formatEvent({ type: 'api-retry', attempt: 1, maxRetries: 3, retryDelayMs: 5000, errorStatus: 429 })
        expect(f).toEqual({
            kind: 'lines',
            lines: [
                { segments: [{ key: 'chat.apiRateLimit' }, ' (', { key: 'chat.retry' }, ' 1/3)'] },
                { segments: [{ key: 'chat.retryDelay', params: { seconds: 5 } }], spaced: true },
            ],
        })
    })

    it('turn-result → 委托形态（事件载荷透传，UI 归 TurnResultMeta）', () => {
        const event = { type: 'turn-result', durationMs: 1000, tokens: 10, numTurns: null }
        expect(formatEvent(event)).toEqual({ kind: 'turn-result', event, createdAt: undefined })
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
