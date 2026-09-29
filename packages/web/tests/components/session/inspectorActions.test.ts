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

/**
 * 检视面板动作清单契约：审查动作（审查重写后全量可用）不得回退为置灰占位。
 * 背景：review 动作曾是 disabled:true 占位，审查视图上线后未接线，空态按钮点不动（票09 E2E 发现）。
 */
import { describe, it, expect, vi } from 'vitest'
import { INSPECTOR_ACTIONS, type InspectorActionContext } from '@/components/session/inspectorActions'

const ctx: InspectorActionContext = {
    terminalLimitReached: false,
    openFile: vi.fn(),
    openTerminal: vi.fn(),
    openReview: vi.fn(),
}

describe('INSPECTOR_ACTIONS', () => {
    it('review 动作可用且执行 openReview', () => {
        const review = INSPECTOR_ACTIONS.find((a) => a.key === 'review')!
        expect(review.disabled).toBe(false)
        review.run(ctx)
        expect(ctx.openReview).toHaveBeenCalledTimes(1)
    })
})
