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
import { createNativeAttachReporter } from '../../src/claude/utils/nativeAttachReporter'

/**
 * onSessionFound 的 attach 变化检测（launcher 侧接线，emit = session.client.emitNativeAttached）
 * @see packages/cli/src/claude/utils/nativeAttachReporter.ts
 */
describe('createNativeAttachReporter', () => {
    it('首启（null→id）也上报', () => {
        const emit = vi.fn()
        const report = createNativeAttachReporter(emit)

        report('sess-1')

        expect(emit).toHaveBeenCalledTimes(1)
        expect(emit).toHaveBeenCalledWith('sess-1')
    })

    it('同 id 重复触发不重复上报（resume 回放/多轮 init）', () => {
        const emit = vi.fn()
        const report = createNativeAttachReporter(emit)

        report('sess-1')
        report('sess-1')
        report('sess-1')

        expect(emit).toHaveBeenCalledTimes(1)
    })

    it('id 变化时上报新 id（新会话 / /clear / compact fork）', () => {
        const emit = vi.fn()
        const report = createNativeAttachReporter(emit)

        report('sess-1')
        report('sess-2')

        expect(emit).toHaveBeenCalledTimes(2)
        expect(emit).toHaveBeenLastCalledWith('sess-2')
    })

    it('切回旧 id（A→B→A）视为变化再次上报', () => {
        const emit = vi.fn()
        const report = createNativeAttachReporter(emit)

        report('sess-1')
        report('sess-2')
        report('sess-1')

        expect(emit).toHaveBeenCalledTimes(3)
        expect(emit).toHaveBeenLastCalledWith('sess-1')
    })
})
