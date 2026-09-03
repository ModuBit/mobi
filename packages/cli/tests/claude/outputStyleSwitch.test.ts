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
import { OUTPUT_STYLE_EXIT_SENTINEL } from '../../src/claude/utils/outputStyleSentinel'

/** 装配纯函数依赖替身（结构化注入，无需拉起真实 Session / MessageQueue） */
function setup(running = false, opts: { rewindBusy?: boolean } = {}) {
    const deps = {
        running,
        rewindBusy: opts.rewindBusy ?? false,
        setOutputStyle: vi.fn(),
        clearSessionId: vi.fn(),
        markPendingExit: vi.fn(),
        clearPending: vi.fn(),
        pushIsolateAndClear: vi.fn(),
    }
    return deps
}

/**
 * output style 切换受理（/clear 语义）：running 守卫、副作用顺序与哨兵入队。
 * @see packages/cli/src/claude/utils/outputStyleSwitch.ts
 */
describe('applyOutputStyleSwitch', () => {
    it('running 中 → 拒绝，所有副作用均未触发', () => {
        const deps = setup(true)

        const result = applyOutputStyleSwitch(deps, 'explanatory')

        expect(result.accepted).toBe(false)
        expect(result.reason).toContain('running')
        expect(deps.setOutputStyle).not.toHaveBeenCalled()
        expect(deps.clearSessionId).not.toHaveBeenCalled()
        expect(deps.markPendingExit).not.toHaveBeenCalled()
        expect(deps.clearPending).not.toHaveBeenCalled()
        expect(deps.pushIsolateAndClear).not.toHaveBeenCalled()
    })

    it('rewind 占用中（pendingRewind / rewindInFlight）→ 拒绝且五步副作用零调用', () => {
        // rewind 受理后哨兵消费前的窗口内受理切换会 clearPending 吞掉 rewind 哨兵，
        // 产生「已清 sessionId + 残留 pendingRewind」坏组合——拒绝优于清位
        const deps = setup(false, { rewindBusy: true });

        const result = applyOutputStyleSwitch(deps, 'explanatory')

        expect(result.accepted).toBe(false)
        expect(result.reason).toContain('rewind')
        expect(deps.setOutputStyle).not.toHaveBeenCalled()
        expect(deps.clearSessionId).not.toHaveBeenCalled()
        expect(deps.markPendingExit).not.toHaveBeenCalled()
        expect(deps.clearPending).not.toHaveBeenCalled()
        expect(deps.pushIsolateAndClear).not.toHaveBeenCalled()
    })

    it('idle → 受理，且置位先于哨兵入队', () => {
        const deps = setup(false)

        const result = applyOutputStyleSwitch(deps, 'explanatory')

        expect(result.accepted).toBe(true)
        expect(deps.setOutputStyle).toHaveBeenCalledWith('explanatory')
        expect(deps.clearSessionId).toHaveBeenCalledTimes(1)
        expect(deps.clearPending).toHaveBeenCalledTimes(1)
        expect(deps.markPendingExit).toHaveBeenCalledTimes(1)
        expect(deps.pushIsolateAndClear).toHaveBeenCalledWith(
            OUTPUT_STYLE_EXIT_SENTINEL,
            { permissionMode: 'default' },
        )
        // 唯一真时序约束：markPendingExit 置位必须先于哨兵入队（launcher 消费哨兵时读位，
        // 哨兵先到而标志后置会被判 stale 白耗一次哨兵）。其余三步顺序无语义，不锁定
        expect(vi.mocked(deps.markPendingExit).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(deps.pushIsolateAndClear).mock.invocationCallOrder[0])
    })

    it('同值切换也受理（幂等重启是用户明确请求的 /clear 语义）', () => {
        const deps = setup(false)

        const result = applyOutputStyleSwitch(deps, 'default')

        expect(result.accepted).toBe(true)
        expect(deps.setOutputStyle).toHaveBeenCalledWith('default')
        expect(deps.pushIsolateAndClear).toHaveBeenCalledWith(
            OUTPUT_STYLE_EXIT_SENTINEL,
            { permissionMode: 'default' },
        )
    })
})
