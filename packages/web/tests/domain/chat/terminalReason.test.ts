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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
    isTerminalUserLifecycle,
    terminalLifecycleLabelKey,
    terminalReasonLabelKey,
} from '@/domain/chat/terminalReason'

describe('isTerminalUserLifecycle（footer 终态标注判据）', () => {
    it('cancelled / discarded / refused 为终态（refused = peer 拒收，同样「这条没被处理」）', () => {
        expect(isTerminalUserLifecycle('cancelled')).toBe(true)
        expect(isTerminalUserLifecycle('discarded')).toBe(true)
        expect(isTerminalUserLifecycle('refused')).toBe(true)
    })

    it('done 与非终态 lifecycle 不标注', () => {
        expect(isTerminalUserLifecycle('done')).toBe(false)
        expect(isTerminalUserLifecycle('queued')).toBe(false)
        expect(isTerminalUserLifecycle('pushed')).toBe(false)
        expect(isTerminalUserLifecycle('acked')).toBe(false)
        expect(isTerminalUserLifecycle('processing')).toBe(false)
        expect(isTerminalUserLifecycle(null)).toBe(false)
        expect(isTerminalUserLifecycle(undefined)).toBe(false)
    })
})

describe('terminalLifecycleLabelKey（终态 → footer 文案 key）', () => {
    it('三种终态各出文案 key', () => {
        expect(terminalLifecycleLabelKey('cancelled')).toBe('chat.message.terminalCancelled')
        expect(terminalLifecycleLabelKey('discarded')).toBe('chat.message.terminalDiscarded')
        expect(terminalLifecycleLabelKey('refused')).toBe('chat.message.terminalRefused')
    })

    it('非终态返回 null（不出标注）', () => {
        expect(terminalLifecycleLabelKey('done')).toBeNull()
        expect(terminalLifecycleLabelKey(null)).toBeNull()
    })
})

describe('terminalReasonLabelKey（terminal_reason 原因标注）', () => {
    it('已知 key 出标注，未知/缺省不出', () => {
        expect(terminalReasonLabelKey('api_error')).toBe('chat.terminalReason.api_error')
        expect(terminalReasonLabelKey('budget_exhausted')).toBe('chat.terminalReason.budget_exhausted')
        expect(terminalReasonLabelKey('unknown_reason')).toBeNull()
        expect(terminalReasonLabelKey(null)).toBeNull()
    })
})

describe('i18n 文案齐备（zh/en 同构）', () => {
    const readLocale = (locale: string) =>
        JSON.parse(readFileSync(resolve(__dirname, '../../../src/core/config/i18n/locales', `${locale}.json`), 'utf-8'))

    it('三种终态文案 key 在 zh/en 均存在', () => {
        for (const locale of ['zh', 'en']) {
            const dict = readLocale(locale)
            expect(dict.chat.message.terminalCancelled, `${locale} terminalCancelled`).toBeTruthy()
            expect(dict.chat.message.terminalDiscarded, `${locale} terminalDiscarded`).toBeTruthy()
            expect(dict.chat.message.terminalRefused, `${locale} terminalRefused`).toBeTruthy()
        }
    })

    it('已知 terminal_reason 文案 key 在 zh/en 均存在', () => {
        for (const locale of ['zh', 'en']) {
            const dict = readLocale(locale)
            expect(dict.chat.terminalReason.api_error, `${locale} api_error`).toBeTruthy()
            expect(dict.chat.terminalReason.budget_exhausted, `${locale} budget_exhausted`).toBeTruthy()
        }
    })
})
