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
import { getSentFrom, isCliOrigin, isQueueableUserSubmission } from '../src/messages'

describe('getSentFrom / isCliOrigin', () => {
    it('读取 content.meta.sentFrom', () => {
        expect(getSentFrom({ role: 'user', content: {}, meta: { sentFrom: 'cli' } })).toBe('cli')
        expect(getSentFrom({ role: 'user', content: {}, meta: { sentFrom: 'webapp' } })).toBe('webapp')
    })

    it('缺失 meta / sentFrom 时返回 null', () => {
        expect(getSentFrom({ role: 'user', content: {} })).toBeNull()
        expect(getSentFrom({ role: 'user', content: {}, meta: {} })).toBeNull()
        expect(getSentFrom(null)).toBeNull()
        expect(getSentFrom(undefined)).toBeNull()
    })

    it('isCliOrigin 仅对 cli 来源为 true', () => {
        expect(isCliOrigin({ role: 'user', content: {}, meta: { sentFrom: 'cli' } })).toBe(true)
        expect(isCliOrigin({ role: 'user', content: {}, meta: { sentFrom: 'webapp' } })).toBe(false)
        expect(isCliOrigin({ role: 'user', content: {} })).toBe(false)
    })
})

describe('isQueueableUserSubmission', () => {
    // 语义：只有 CLI 一定不排队（CLI 消息是 Claude Code 输出流回显）；
    // 其余端（webapp 及未来端）默认排队。
    it('webapp 来源的 user 消息 + localId → 可排队', () => {
        expect(isQueueableUserSubmission(
            { role: 'user', content: { type: 'text', text: 'hi' }, meta: { sentFrom: 'webapp' } },
            'loc-1',
        )).toBe(true)
    })

    it('未知来源（未来端）的 user 消息 + localId → 可排队（denylist 默认开放）', () => {
        expect(isQueueableUserSubmission(
            { role: 'user', content: { type: 'text', text: 'hi' }, meta: { sentFrom: 'future-client' } },
            'loc-1',
        )).toBe(true)
        expect(isQueueableUserSubmission(
            { role: 'user', content: { type: 'text', text: 'hi' } },
            'loc-1',
        )).toBe(true)
    })

    it('CLI 来源（local-command-stdout 等回显）→ 不排队', () => {
        expect(isQueueableUserSubmission(
            { role: 'user', content: { type: 'text', text: '<local-command-stdout>x</local-command-stdout>' }, meta: { sentFrom: 'cli' } },
            'sdk-uuid',
        )).toBe(false)
    })

    it('无 localId → 不排队（无追踪标识，无法走排队消费链路）', () => {
        expect(isQueueableUserSubmission(
            { role: 'user', content: {}, meta: { sentFrom: 'webapp' } },
            null,
        )).toBe(false)
        expect(isQueueableUserSubmission(
            { role: 'user', content: {}, meta: { sentFrom: 'webapp' } },
            undefined,
        )).toBe(false)
    })

    it('非 user 角色（agent/CLI output 等）→ 不排队', () => {
        expect(isQueueableUserSubmission(
            { role: 'agent', content: {}, meta: { sentFrom: 'cli' } },
            'loc-1',
        )).toBe(false)
    })
})
