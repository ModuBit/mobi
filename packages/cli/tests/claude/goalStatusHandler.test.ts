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
    it('active(met=false): 上报 goalStatus + 发 goal_progress 消息(met=false)', () => {
        const deps = makeDeps()
        const h = new GoalStatusHandler(deps as unknown as ApiSessionClient, deps.sendMessage)
        h.handle({ type: 'goal_status', met: false, condition: '所有测试通过', iterations: 1 })
        expect(deps.reportGoalStatus).toHaveBeenCalledWith(expect.objectContaining({ met: false, condition: '所有测试通过' }))
        expect(deps.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'goal_progress', met: false }))
        // active 不发 null
        expect(deps.reportGoalStatus).not.toHaveBeenCalledWith(null)
        expect(deps.reportGoalStatus).toHaveBeenCalledTimes(1)
    })

    it('met=true: 立即上报 null(UI 立即清空) + 发 goal_progress(met=true) stream 标注', () => {
        const deps = makeDeps()
        const h = new GoalStatusHandler(deps as unknown as ApiSessionClient, deps.sendMessage)
        h.handle({ type: 'goal_status', met: true, condition: '所有测试通过' })
        // reportGoalStatus 立即收到 null(无 delay),且只调用一次
        expect(deps.reportGoalStatus).toHaveBeenLastCalledWith(null)
        expect(deps.reportGoalStatus).toHaveBeenCalledTimes(1)
        // goal_progress 消息仍带 met:true(stream 标注渲染 ✓ 达成 绿)
        expect(deps.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'goal_progress', met: true }))
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

    it('dispose 可安全调用(已无定时器,空操作不抛)', () => {
        const deps = makeDeps()
        const h = new GoalStatusHandler(deps as unknown as ApiSessionClient, deps.sendMessage)
        expect(() => h.dispose()).not.toThrow()
    })

    it('restore(恢复场景): 只 reportGoalStatus RPC 恢复徽标，不发 goal_progress 聊天消息（避免重连/切换注入合成消息污染历史）', () => {
        const deps = makeDeps()
        const h = new GoalStatusHandler(deps as unknown as ApiSessionClient, deps.sendMessage)
        h.restore({ type: 'goal_status', met: false, condition: '所有测试通过', iterations: 1 })
        expect(deps.reportGoalStatus).toHaveBeenCalledWith(expect.objectContaining({ met: false, condition: '所有测试通过' }))
        // 恢复不发聊天消息
        expect(deps.sendMessage).not.toHaveBeenCalled()
    })

    it('restore met=true: 上报 null（与 handle 一致的清空语义，但仍不发消息）', () => {
        const deps = makeDeps()
        const h = new GoalStatusHandler(deps as unknown as ApiSessionClient, deps.sendMessage)
        h.restore({ type: 'goal_status', met: true, condition: '所有测试通过' })
        expect(deps.reportGoalStatus).toHaveBeenLastCalledWith(null)
        expect(deps.sendMessage).not.toHaveBeenCalled()
    })
})
