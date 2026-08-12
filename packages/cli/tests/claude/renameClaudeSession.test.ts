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

import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    renameSession: vi.fn(),
}))

// logger.debug 仅打日志，mock 掉避免噪音 / 依赖链
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn() } }))

import { renameSession } from '@anthropic-ai/claude-agent-sdk'
import { syncClaudeRename } from '@/claude/utils/renameClaudeSession'

describe('syncClaudeRename', () => {
    const mockedRenameSession = vi.mocked(renameSession)

    beforeEach(() => {
        mockedRenameSession.mockReset()
    })

    test('正常回写：用 claudeSessionId + path 调 SDK renameSession', async () => {
        mockedRenameSession.mockResolvedValue(undefined)
        await syncClaudeRename(
            { sessionId: 'cs-uuid-1', path: '/tmp/proj' },
            '新标题'
        )
        expect(mockedRenameSession).toHaveBeenCalledWith('cs-uuid-1', '新标题', { dir: '/tmp/proj' })
    })

    test('locator 为 null → throw（会话未就绪），不调 SDK', async () => {
        await expect(syncClaudeRename(null, '标题')).rejects.toThrow(/not ready/)
        expect(mockedRenameSession).not.toHaveBeenCalled()
    })

    test('sessionId 为 null → throw（会话未就绪），不调 SDK', async () => {
        await expect(
            syncClaudeRename({ sessionId: null, path: '/tmp' }, '标题')
        ).rejects.toThrow(/not ready/)
        expect(mockedRenameSession).not.toHaveBeenCalled()
    })
})
