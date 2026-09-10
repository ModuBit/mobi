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
import { applyOutputStyleSwitch } from '../../src/claude/utils/outputStyleSwitch'
import { QueryRestartController } from '../../src/claude/utils/queryRestart'
import type { EnhancedMode } from '../../src/claude/types'
import { MessageQueue } from '../../src/utils/MessageQueue'

/** 用真实本地队列装配 restart module，只替换 output style 的领域副作用。 */
function setup(running = false) {
    const queue = new MessageQueue<EnhancedMode>(message => JSON.stringify(message))
    const restart = new QueryRestartController(queue)
    const deps = {
        running,
        restart,
        setOutputStyle: vi.fn(),
        clearSessionId: vi.fn(),
    }
    return { deps, queue, restart }
}

/**
 * output style 切换受理（/clear 语义）：running 守卫、副作用顺序与哨兵入队。
 * @see packages/cli/src/claude/utils/outputStyleSwitch.ts
 */
describe('applyOutputStyleSwitch', () => {
    it('running 中 → 拒绝，所有副作用均未触发', () => {
        const { deps, restart } = setup(true)

        const result = applyOutputStyleSwitch(deps, 'Explanatory')

        expect(result.accepted).toBe(false)
        expect(result.reason).toContain('running')
        expect(deps.setOutputStyle).not.toHaveBeenCalled()
        expect(deps.clearSessionId).not.toHaveBeenCalled()
        expect(restart.current()).toBeNull()
    })

    it('重启通道占用中 → 拒绝且不执行 output style 副作用', () => {
        // rewind 受理后哨兵消费前的窗口内受理切换会 clearPending 吞掉对方哨兵，
        // 产生「已清 sessionId + 残留对方请求」坏组合——拒绝优于清位
        const { deps, restart } = setup()
        const pending = { kind: 'rewind', nativeId: 'u1', resumeAt: 'a1', filesRestored: false } as const
        expect(restart.trySchedule(pending)).toBe(true)

        const result = applyOutputStyleSwitch(deps, 'Explanatory')

        expect(result.accepted).toBe(false)
        expect(result.reason).toContain('rewind')
        expect(deps.setOutputStyle).not.toHaveBeenCalled()
        expect(deps.clearSessionId).not.toHaveBeenCalled()
        expect(restart.current()).toBe(pending)
    })

    it('idle → 受理，设置 style 并向 restart module 提交请求', () => {
        const { deps, queue, restart } = setup()

        const result = applyOutputStyleSwitch(deps, 'Explanatory')

        expect(result.accepted).toBe(true)
        expect(deps.setOutputStyle).toHaveBeenCalledWith('Explanatory')
        expect(deps.clearSessionId).toHaveBeenCalledTimes(1)
        expect(restart.current()).toEqual({ kind: 'outputStyle' })
        expect(queue.size()).toBe(1)
    })

    it('同值切换也受理（幂等重启是用户明确请求的 /clear 语义）', () => {
        const { deps, restart } = setup()

        const result = applyOutputStyleSwitch(deps, 'default')

        expect(result.accepted).toBe(true)
        expect(deps.setOutputStyle).toHaveBeenCalledWith('default')
        expect(restart.current()).toEqual({ kind: 'outputStyle' })
    })
})
