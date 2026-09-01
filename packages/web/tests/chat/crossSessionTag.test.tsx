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
import { getCrossSessionFrom, getTurnOrigin } from '@/domain/chat/presentation'

// mock i18next：只提供本组件用到的文案映射
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({
        t: (key: string, opts?: { from?: string }) => {
            const map: Record<string, string> = {
                'chat.message.crossSessionFrom': `来自 ${opts?.from}`,
                'chat.message.crossSessionFromUnknown': '来自其他会话',
                'chat.message.turnOriginScheduled': '⏰ 定时任务',
                'chat.message.turnOriginLoop': '🔁 /loop',
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

describe('getTurnOrigin（入站 turn 来源提取）', () => {
    it('peer / scheduled / loop 三种合法值原样返回', () => {
        expect(getTurnOrigin({ turnOrigin: 'peer' })).toBe('peer')
        expect(getTurnOrigin({ turnOrigin: 'scheduled' })).toBe('scheduled')
        expect(getTurnOrigin({ turnOrigin: 'loop' })).toBe('loop')
    })

    it('turnOrigin 缺失 / 非合法枚举 / meta 整体缺失 → 一律 null（回退 peer 行为）', () => {
        expect(getTurnOrigin({})).toBeNull()
        expect(getTurnOrigin({ turnOrigin: 'unknown' })).toBeNull()
        expect(getTurnOrigin({ turnOrigin: 42 })).toBeNull()
        expect(getTurnOrigin(undefined)).toBeNull()
    })
})

describe('CrossSessionTag（跨会话入站来源 chip）', () => {
    it('peer + 有来源：显示「来自 {from}」', () => {
        render(<CrossSessionTag from="mobi-ab" turnOrigin="peer" />)
        expect(screen.getByText('来自 mobi-ab')).toBeTruthy()
    })

    it('scheduled：显示定时任务标签（不看 from）', () => {
        render(<CrossSessionTag from={null} turnOrigin="scheduled" />)
        expect(screen.getByText('⏰ 定时任务')).toBeTruthy()
    })

    it('loop：显示 /loop 标签', () => {
        render(<CrossSessionTag from={null} turnOrigin="loop" />)
        expect(screen.getByText('🔁 /loop')).toBeTruthy()
    })

    it('无 turnOrigin（旧消息）：回退 peer 行为（from 驱动）', () => {
        render(<CrossSessionTag from="mobi-ab" />)
        expect(screen.getByText('来自 mobi-ab')).toBeTruthy()
    })

    it('无 turnOrigin 且 from 缺失：回退通用文案', () => {
        render(<CrossSessionTag from={null} />)
        expect(screen.getByText('来自其他会话')).toBeTruthy()
    })
})
