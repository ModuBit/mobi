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
import { RawJSONLinesSchema } from '../src/claude/types'

describe('RawJSONLinesSchema goal_progress', () => {
    it('解析 goal_progress 消息', () => {
        const r = RawJSONLinesSchema.safeParse({
            type: 'goal_progress',
            uuid: 'u1',
            timestamp: '2026-07-31T00:00:00Z',
            met: false,
            condition: 'all tests pass',
            iterations: 2,
        })
        expect(r.success).toBe(true)
    })

    it('解析 goal_progress 消息（met=true，含可选字段）', () => {
        const r = RawJSONLinesSchema.safeParse({
            type: 'goal_progress',
            uuid: 'u2',
            met: true,
            condition: 'x',
            reason: 'done',
            iterations: 4,
            durationMs: 1200,
            tokens: 5000,
        })
        expect(r.success).toBe(true)
        if (r.success) {
            expect(r.data.type).toBe('goal_progress')
            expect(r.data.met).toBe(true)
        }
    })

    it('goal_progress 缺少必填 met 字段时失败', () => {
        const r = RawJSONLinesSchema.safeParse({
            type: 'goal_progress',
            uuid: 'u3',
            condition: 'x',
        })
        expect(r.success).toBe(false)
    })
})

describe('goal_status 载荷校验（shared GoalStatusSchema 口径，sentinel/type 仅校验视角 strip）', () => {
    it('解析 transcript goal_status attachment 行', () => {
        const r = RawJSONLinesSchema.safeParse({
            type: 'attachment',
            uuid: 'g-1',
            attachment: { type: 'goal_status', met: true, condition: 'x', reason: 'done', iterations: 4 },
        })
        expect(r.success).toBe(true)
    })

    it('可选 sentinel 字段合法（载荷 unknown 透传，行原样保留）', () => {
        const payload = { type: 'goal_status', met: false, condition: 'x', sentinel: true }
        const r = RawJSONLinesSchema.safeParse({ type: 'attachment', uuid: 'g-1', attachment: payload })
        expect(r.success).toBe(true)
        if (r.success) {
            expect(r.data.type === 'attachment' && r.data.attachment).toBe(payload)
        }
    })

    it('缺 condition 的坏载荷拒绝（管道静默跳过）', () => {
        const r = RawJSONLinesSchema.safeParse({
            type: 'attachment',
            uuid: 'g-1',
            attachment: { type: 'goal_status', met: true },
        })
        expect(r.success).toBe(false)
    })
})

describe('RawJSONLinesSchema attachment 行（mods-goal-channel 票 02）', () => {
    const goalLine = {
        type: 'attachment',
        uuid: 'a-1',
        timestamp: '2026-10-22T00:00:00Z',
        attachment: { type: 'goal_status', met: false, condition: '测试通过', iterations: 1, sentinel: true },
    }

    it('接受合法 attachment.goal_status 行（原始行透传语义，额外字段保留）', () => {
        const r = RawJSONLinesSchema.safeParse(goalLine)
        expect(r.success).toBe(true)
        if (r.success) {
            expect(r.data.type).toBe('attachment')
            expect(r.data.uuid).toBe('a-1')
            expect(r.data.attachment).toEqual(goalLine.attachment)
        }
    })

    it('未知 name 的 attachment 静默跳过（code-review 收口：注册即「持久化+广播」白名单，防广播面无界）', () => {
        const r = RawJSONLinesSchema.safeParse({
            type: 'attachment',
            uuid: 'a-2',
            attachment: { type: 'future_attachment', foo: 'bar' },
        })
        expect(r.success).toBe(false)
    })

    it('goal_status 坏载荷（缺 met/condition）按静默跳过语义校验失败', () => {
        const r = RawJSONLinesSchema.safeParse({
            type: 'attachment',
            uuid: 'a-3',
            attachment: { type: 'goal_status', reason: 'broken' },
        })
        expect(r.success).toBe(false)
    })
})
