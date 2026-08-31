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

import { resolveStopAction } from '../../src/claude/utils/stopAction'

/**
 * stopKind='turn' 的撤回三分支（spec §3.3）：初判只定意向；
 * 复验在 interrupt 返回后由 handleAbortRequest 做（两段式）。
 */

describe('resolveStopAction（stopKind=turn 时的撤回三分支）', () => {
    it('有输出 → stop', () => {
        expect(resolveStopAction({ turnHasOutput: true, pumpQueueEmpty: true, hasLastPushed: true })).toBe('stop')
    })
    it('pump 队列非空 → stop（队列下一条照跑）', () => {
        expect(resolveStopAction({ turnHasOutput: false, pumpQueueEmpty: false, hasLastPushed: true })).toBe('stop')
    })
    it('无输出 + 队列空 + 有 lastPushed → withdraw', () => {
        expect(resolveStopAction({ turnHasOutput: false, pumpQueueEmpty: true, hasLastPushed: true })).toBe('withdraw')
    })
    it('无 lastPushed（丢失/无 push 记录）→ 安全降级 stop', () => {
        expect(resolveStopAction({ turnHasOutput: false, pumpQueueEmpty: true, hasLastPushed: false })).toBe('stop')
    })
})
