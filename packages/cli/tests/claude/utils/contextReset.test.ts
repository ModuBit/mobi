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
import { applyContextReset } from '../../../src/claude/utils/contextReset'

/**
 * 上下文重置副作用收口（/clear 检测与 output style 切换哨兵共用）。
 * 背景：output style 切换复刻 /clear 语义（清 sessionId + 哨兵退轮 + 重启），
 * 但水位清空只挂在 /clear 的 onContextCleared 回调上，切换路径水位残留。
 * @see packages/cli/src/claude/utils/contextReset.ts
 */
describe('applyContextReset', () => {
    it('发 context-cleared 边界事件 + 清水位上报 + 归零三份记忆', () => {
        const sendSessionEvent = vi.fn()
        const clearContextUsage = vi.fn()
        const memory = {
            lastMaxTokens: 200000,
            lastCostUsd: 1.23,
            lastAssistantUsage: { input_tokens: 100 },
        }

        applyContextReset({ sendSessionEvent, clearContextUsage }, memory)

        // 边界事件：web 渲染「上下文已重置」分隔线（与 /clear 一致）
        expect(sendSessionEvent).toHaveBeenCalledWith({ type: 'context-cleared' })
        // hub runtimeState.contextUsage 落 null（水位线隐藏，直到下个真实 turn）
        expect(clearContextUsage).toHaveBeenCalledTimes(1)
        expect(memory.lastMaxTokens).toBe(0)
        expect(memory.lastCostUsd).toBe(0)
        expect(memory.lastAssistantUsage).toBeUndefined()
    })
})
