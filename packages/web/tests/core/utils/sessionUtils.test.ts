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

import { getSessionDisplayName } from '@/core/utils/sessionUtils'
import type { Session } from '@/core/data/api/types'

function makeSession(metadata: Record<string, unknown>): Session {
    return {
        id: 's-1',
        metadata,
    } as unknown as Session
}

describe('getSessionDisplayName', () => {
    it('普通会话：summary.text 优先于 name', () => {
        const session = makeSession({ name: '命名', summary: { text: '动态摘要' } })
        expect(getSessionDisplayName(session)).toBe('动态摘要')
    })

    it('fork 行（forkedFrom 在场）：name 优先，CLI 回填的 summary 不盖「· 分叉」标题', () => {
        const session = makeSession({
            name: '父会话 · 分叉',
            summary: { text: 'fork 自身产出的动态摘要' },
            forkedFrom: { sessionId: 'parent-1' },
        })
        expect(getSessionDisplayName(session)).toBe('父会话 · 分叉')
    })

    it('fork 待激活行（forkFrom 在场）同样 name 优先', () => {
        const session = makeSession({
            name: '父会话 · 分叉',
            summary: { text: '继承的摘要' },
            forkFrom: { parentSessionId: 'parent-1', parentNativeId: 'pn', anchorNativeId: 'an' },
        })
        expect(getSessionDisplayName(session)).toBe('父会话 · 分叉')
    })

    it('fork 行无 name：降级 path 基名，再降级 id 前 8 位', () => {
        const byPath = makeSession({
            path: '/tmp/demo',
            summary: { text: '摘要' },
            forkedFrom: { sessionId: 'parent-1' },
        })
        expect(getSessionDisplayName(byPath)).toBe('demo')

        const byId = makeSession({ forkedFrom: { sessionId: 'parent-1' } })
        expect(getSessionDisplayName(byId)).toBe(byId.id.slice(0, 8))
    })
})
