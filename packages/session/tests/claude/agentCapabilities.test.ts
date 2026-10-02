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

import { describe, test, expect, vi } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    renameSession: vi.fn(),
}))

import { renameSession } from '@anthropic-ai/claude-agent-sdk'
import { claudeCapabilities, claudeLocator } from '@/claude/agentCapabilities'
import type { Session } from '@/claude/session'

describe('claudeCapabilities.renameSession', () => {
    test('用 sessionId + path 调 SDK renameSession', async () => {
        vi.mocked(renameSession).mockResolvedValue(undefined)
        await claudeCapabilities.renameSession!(
            { flavor: 'claude', sessionId: 'cs-uuid-1', path: '/tmp/proj' },
            '新标题'
        )
        expect(renameSession).toHaveBeenCalledWith('cs-uuid-1', '新标题', { dir: '/tmp/proj' })
    })
})

describe('claudeLocator', () => {
    function makeSession(over: Partial<Pick<Session, 'sessionId' | 'path'>>): Session {
        return { sessionId: over.sessionId ?? null, path: over.path ?? '/tmp' } as Session
    }

    test('Session → locator（flavor 固定 claude）', () => {
        const locator = claudeLocator(makeSession({ sessionId: 'cs-1', path: '/work' }))
        expect(locator).toEqual({ flavor: 'claude', sessionId: 'cs-1', path: '/work' })
    })

    test('sessionId 为 null 时 locator 仍带 null（由 syncAgentRename 守卫）', () => {
        const locator = claudeLocator(makeSession({ sessionId: null, path: '/work' }))
        expect(locator).toEqual({ flavor: 'claude', sessionId: null, path: '/work' })
    })

    test('Session 为 null → 返回 null', () => {
        expect(claudeLocator(null)).toBeNull()
    })
})
