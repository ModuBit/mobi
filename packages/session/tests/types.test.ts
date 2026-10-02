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
import { RawJSONLinesSchema, GoalStatusAttachmentSchema } from '../src/claude/types'

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

describe('GoalStatusAttachmentSchema', () => {
    it('解析 transcript goal_status attachment', () => {
        const r = GoalStatusAttachmentSchema.safeParse({
            type: 'goal_status',
            met: true,
            condition: 'x',
            reason: 'done',
            iterations: 4,
        })
        expect(r.success).toBe(true)
    })

    it('支持可选 sentinel 字段', () => {
        const r = GoalStatusAttachmentSchema.safeParse({
            type: 'goal_status',
            met: false,
            condition: 'x',
            sentinel: true,
        })
        expect(r.success).toBe(true)
        if (r.success) {
            expect(r.data.sentinel).toBe(true)
        }
    })

    it('type 不匹配时失败', () => {
        const r = GoalStatusAttachmentSchema.safeParse({
            type: 'other',
            met: true,
            condition: 'x',
        })
        expect(r.success).toBe(false)
    })
})
