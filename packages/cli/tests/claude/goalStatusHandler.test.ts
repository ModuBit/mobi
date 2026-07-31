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

import { describe, it, expect, vi } from 'vitest'
import type { ApiSessionClient } from '@/lib'
import { GoalStatusHandler } from '../../src/claude/goalStatusHandler'

const makeDeps = () => ({
    reportGoalStatus: vi.fn(),
    sendMessage: vi.fn(),
})

describe('GoalStatusHandler', () => {
    it('active: 上报 goalStatus + 发 goal_progress 消息,不启定时器', () => {
        const deps = makeDeps()
        const h = new GoalStatusHandler(deps as unknown as ApiSessionClient, deps.sendMessage)
        h.handle({ type: 'goal_status', met: false, condition: 'x', iterations: 1 })
        expect(deps.reportGoalStatus).toHaveBeenCalledWith(expect.objectContaining({ met: false, condition: 'x' }))
        expect(deps.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'goal_progress' }))
        // 未达成不应排定定时器:推进时钟不应触发额外上报
        vi.useFakeTimers()
        vi.advanceTimersByTime(10_000)
        expect(deps.reportGoalStatus).toHaveBeenCalledTimes(1)
        vi.useRealTimers()
    })

    it('met=true: 上报后启定时器,到期清空 goalStatus', () => {
        vi.useFakeTimers()
        const deps = makeDeps()
        const h = new GoalStatusHandler(deps as unknown as ApiSessionClient, deps.sendMessage)
        h.handle({ type: 'goal_status', met: true, condition: 'x' })
        expect(deps.reportGoalStatus).toHaveBeenLastCalledWith(expect.objectContaining({ met: true }))
        // 到期前不应清空
        vi.advanceTimersByTime(9_999)
        expect(deps.reportGoalStatus).toHaveBeenCalledTimes(1)
        vi.advanceTimersByTime(1)
        expect(deps.reportGoalStatus).toHaveBeenLastCalledWith(null)
        expect(deps.reportGoalStatus).toHaveBeenCalledTimes(2)
        vi.useRealTimers()
    })

    it('新 status 到达取消挂起定时器', () => {
        vi.useFakeTimers()
        const deps = makeDeps()
        const h = new GoalStatusHandler(deps as unknown as ApiSessionClient, deps.sendMessage)
        h.handle({ type: 'goal_status', met: true, condition: 'x' })
        h.handle({ type: 'goal_status', met: false, condition: 'y' })
        vi.advanceTimersByTime(10_000)
        // 定时器已被取消,不应再发 null 清空
        expect(deps.reportGoalStatus).toHaveBeenLastCalledWith(expect.objectContaining({ met: false, condition: 'y' }))
        expect(deps.reportGoalStatus).toHaveBeenCalledTimes(2)
        vi.useRealTimers()
    })

    it('dispose 取消挂起定时器', () => {
        vi.useFakeTimers()
        const deps = makeDeps()
        const h = new GoalStatusHandler(deps as unknown as ApiSessionClient, deps.sendMessage)
        h.handle({ type: 'goal_status', met: true, condition: 'x' })
        h.dispose()
        vi.advanceTimersByTime(10_000)
        // dispose 后定时器不应触发
        expect(deps.reportGoalStatus).toHaveBeenCalledTimes(1)
        vi.useRealTimers()
    })

    it('可选字段透传:reason/durationMs/tokens', () => {
        const deps = makeDeps()
        const h = new GoalStatusHandler(deps as unknown as ApiSessionClient, deps.sendMessage)
        h.handle({
            type: 'goal_status',
            met: false,
            condition: '所有测试通过',
            reason: '覆盖率达标',
            durationMs: 1234,
            tokens: 9999,
        })
        expect(deps.reportGoalStatus).toHaveBeenCalledWith(expect.objectContaining({
            met: false,
            condition: '所有测试通过',
            reason: '覆盖率达标',
            durationMs: 1234,
            tokens: 9999,
        }))
        expect(deps.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: 'goal_progress',
            reason: '覆盖率达标',
            durationMs: 1234,
            tokens: 9999,
        }))
    })
})
