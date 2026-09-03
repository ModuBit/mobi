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
function setup(running = false) {
    const deps = {
        running,
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

    it('idle → 受理，且副作用顺序：setOutputStyle → clearSessionId → clearPending → markPendingExit → 哨兵入队', () => {
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
        // 顺序即语义：置位与哨兵入队同一同步段，置位在前（launcher 消费哨兵时读位）
        expect(vi.mocked(deps.setOutputStyle).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(deps.clearSessionId).mock.invocationCallOrder[0])
        expect(vi.mocked(deps.clearSessionId).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(deps.clearPending).mock.invocationCallOrder[0])
        expect(vi.mocked(deps.clearPending).mock.invocationCallOrder[0])
            .toBeLessThan(vi.mocked(deps.markPendingExit).mock.invocationCallOrder[0])
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
