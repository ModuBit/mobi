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

import { shouldCountAsTurnOutput } from '../../src/claude/claudeRemote'

/**
 * turn 输出观测判据（批次 A 撤回复验）：本 turn 是否已产出「模型输出」。
 * stream_event / assistant 为准；result / system / user（含 isReplay 回显）不算。
 */

describe('shouldCountAsTurnOutput', () => {
    it('stream_event 与 assistant 计为输出', () => {
        expect(shouldCountAsTurnOutput({ type: 'stream_event' })).toBe(true)
        expect(shouldCountAsTurnOutput({ type: 'assistant' })).toBe(true)
    })

    it('result/system/user 不计为输出', () => {
        expect(shouldCountAsTurnOutput({ type: 'result' })).toBe(false)
        expect(shouldCountAsTurnOutput({ type: 'system', subtype: 'init' })).toBe(false)
        expect(shouldCountAsTurnOutput({ type: 'user' })).toBe(false)
    })
})
