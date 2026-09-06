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
import { createChangeTitleTool, CHANGE_TITLE_TOOL_NAME } from '@/mcp/changeTitleTool'
import type { AgentSessionLocator } from '@/agent/agentCapabilities'

const LOCATOR: AgentSessionLocator = { flavor: 'claude', sessionId: 'native-1', path: '/tmp/demo' }

function buildDeps(overrides?: Partial<{
    sendSummary: ReturnType<typeof vi.fn>
    syncRename: ReturnType<typeof vi.fn>
}>) {
    const sendSummary = overrides?.sendSummary ?? vi.fn()
    const syncRename = overrides?.syncRename ?? vi.fn().mockResolvedValue(undefined)
    const deps = {
        sendSummary,
        syncRename,
        getAgentLocator: () => LOCATOR,
    }
    return { deps, sendSummary, syncRename }
}

describe('createChangeTitleTool', () => {
    it('exposes stable tool identity for mcp__mobi__change_title prefix', () => {
        const { deps } = buildDeps()
        const tool = createChangeTitleTool(deps)

        expect(tool.name).toBe(CHANGE_TITLE_TOOL_NAME)
        expect(tool.name).toBe('change_title')
        expect(tool.description).toBe('Change the title of the current chat session')
    })

    it('sends summary to hub and syncs agent rename on success', async () => {
        const { deps, sendSummary, syncRename } = buildDeps()
        const tool = createChangeTitleTool(deps)

        const result = await tool.execute({ title: '新标题' })

        expect(sendSummary).toHaveBeenCalledTimes(1)
        expect(sendSummary).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'summary', summary: '新标题' })
        )
        expect(syncRename).toHaveBeenCalledWith(LOCATOR, '新标题')
        expect(result.isError).toBe(false)
        expect(result.content[0].text).toContain('新标题')
    })

    it('still succeeds when agent rename fails (best-effort)', async () => {
        const { deps, sendSummary, syncRename } = buildDeps({
            syncRename: vi.fn().mockRejectedValue(new Error('Agent session not ready')),
        })
        const tool = createChangeTitleTool(deps)

        const result = await tool.execute({ title: '标题' })

        expect(sendSummary).toHaveBeenCalledTimes(1)
        expect(syncRename).toHaveBeenCalledTimes(1)
        expect(result.isError).toBe(false)
    })

    it('returns error result when hub summary send fails', async () => {
        const { deps, syncRename } = buildDeps({
            sendSummary: vi.fn(() => {
                throw new Error('connection lost')
            }),
        })
        const tool = createChangeTitleTool(deps)

        const result = await tool.execute({ title: '标题' })

        expect(syncRename).not.toHaveBeenCalled()
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('Failed to change chat title')
    })

    it('returns error result on invalid arguments', async () => {
        const { deps, sendSummary, syncRename } = buildDeps()
        const tool = createChangeTitleTool(deps)

        const result = await tool.execute({ wrong: 'payload' })

        expect(sendSummary).not.toHaveBeenCalled()
        expect(syncRename).not.toHaveBeenCalled()
        expect(result.isError).toBe(true)
    })
})
