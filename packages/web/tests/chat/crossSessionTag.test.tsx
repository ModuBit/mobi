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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { CrossSessionTag } from '@/components/chat/blocks/CrossSessionTag'
import { getCrossSessionFrom } from '@/domain/chat/presentation'

// mock i18next：只提供本组件用到的文案映射
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string, opts?: { from?: string }) => {
            const map: Record<string, string> = {
                'chat.message.crossSessionFrom': `来自 ${opts?.from}`,
                'chat.message.crossSessionFromUnknown': '来自其他会话',
            }
            return map[key] ?? key
        },
    }),
}))

afterEach(cleanup)

describe('getCrossSessionFrom（跨会话入站来源提取）', () => {
    it('meta.crossSession.from 为非空 string 时返回它', () => {
        expect(getCrossSessionFrom({ crossSession: { from: 'mobi-ab' } })).toBe('mobi-ab')
    })

    it('from 缺失 / 空 string / 非 string / meta 整体缺失 → 一律 null（降级通用文案）', () => {
        expect(getCrossSessionFrom({})).toBeNull()
        expect(getCrossSessionFrom({ crossSession: { from: '' } })).toBeNull()
        expect(getCrossSessionFrom({ crossSession: { from: 42 } })).toBeNull()
        expect(getCrossSessionFrom(undefined)).toBeNull()
    })
})

describe('CrossSessionTag（跨会话入站来源 chip）', () => {
    it('有来源：显示「来自 {from}」', () => {
        render(<CrossSessionTag from="mobi-ab" />)
        expect(screen.getByText('来自 mobi-ab')).toBeTruthy()
    })

    it('来源缺失（信封降级落库）：显示通用文案', () => {
        render(<CrossSessionTag from={null} />)
        expect(screen.getByText('来自其他会话')).toBeTruthy()
    })
})
