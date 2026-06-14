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
import { decideToastAction, parseActiveSessionId } from '@/core/notifications'

/**
 * patchSessionCache 中 effort delta 合并逻辑的等价纯函数实现
 * 用于验证 SSE 心跳数据中 effort 字段正确合并到 runtimeState
 */
function mergeRuntimeStateDelta(
    existingRuntimeState: Record<string, unknown> | undefined,
    delta: Record<string, unknown>,
): Record<string, unknown> | undefined {
    let runtimeStatePatch: Record<string, unknown> | null = null

    if ('model' in delta) {
        runtimeStatePatch = { model: delta.model }
    }
    if ('effort' in delta) {
        runtimeStatePatch = { ...runtimeStatePatch, effort: delta.effort }
    }

    if (!runtimeStatePatch) return existingRuntimeState

    return { ...existingRuntimeState, ...runtimeStatePatch }
}

describe('SSE effort delta 合并', () => {
    it('effort 单独出现时正确合并到 runtimeState', () => {
        const existing = { model: 'sonnet' }
        const result = mergeRuntimeStateDelta(existing, { effort: 'high' })
        expect(result).toEqual({ model: 'sonnet', effort: 'high' })
    })

    it('effort 与 model 同时出现时正确合并', () => {
        const existing = { model: 'sonnet', effort: 'medium' }
        const result = mergeRuntimeStateDelta(existing, { model: 'opus', effort: 'high' })
        expect(result).toEqual({ model: 'opus', effort: 'high' })
    })

    it('仅 model 出现时 effort 不受影响', () => {
        const existing = { effort: 'xhigh' }
        const result = mergeRuntimeStateDelta(existing, { model: 'sonnet' })
        expect(result).toEqual({ model: 'sonnet', effort: 'xhigh' })
    })

    it('无 model 无 effort 时返回原始状态', () => {
        const existing = { todos: [{ content: 'test', status: 'pending' }] }
        const result = mergeRuntimeStateDelta(existing, { running: false })
        expect(result).toBe(existing)
    })

    it('delta 中 effort 为 null 时覆盖', () => {
        const existing = { effort: 'high' }
        const result = mergeRuntimeStateDelta(existing, { effort: null })
        expect(result).toEqual({ effort: null })
    })
})

describe('toast 处理集成(decideToastAction + parseActiveSessionId)', () => {
    it('前台且在该 session → ignore(不产生角标)', () => {
        const action = decideToastAction('s1', {
            activeSessionId: parseActiveSessionId('/sessions/s1'),
            isHidden: false,
        })
        expect(action).toBe('ignore')
    })

    it('前台但路由在别的 session → page-toast', () => {
        const action = decideToastAction('s1', {
            activeSessionId: parseActiveSessionId('/sessions/s2'),
            isHidden: false,
        })
        expect(action).toBe('page-toast')
    })

    it('后台 → system-notification', () => {
        const action = decideToastAction('s1', {
            activeSessionId: parseActiveSessionId('/sessions/s1'),
            isHidden: true,
        })
        expect(action).toBe('system-notification')
    })
})
