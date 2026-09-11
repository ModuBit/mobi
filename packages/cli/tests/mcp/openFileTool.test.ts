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
import { createOpenFileTool, createOpenFileToolForSession, OPEN_FILE_TOOL_NAME } from '@/mcp/openFileTool'
import type { ApiSessionClient } from '@/api/apiSession'

function buildDeps(overrides?: Partial<{ sendUiCommand: ReturnType<typeof vi.fn> }>) {
    const sendUiCommand = overrides?.sendUiCommand ?? vi.fn().mockResolvedValue({ delivered: true })
    return { deps: { sendUiCommand }, sendUiCommand }
}

describe('createOpenFileTool', () => {
    it('exposes stable tool identity for mcp__mobi__open_file prefix', () => {
        const { deps } = buildDeps()
        const tool = createOpenFileTool(deps)

        expect(tool.name).toBe(OPEN_FILE_TOOL_NAME)
        expect(tool.name).toBe('open_file')
        // 检索关键词（spec 命名约定）：open file / preview / sidebar / show the user
        const desc = tool.description.toLowerCase()
        expect(desc).toContain('open')
        expect(desc).toContain('preview')
        expect(desc).toContain('sidebar')
        expect(desc).toContain('show the user')
    })

    it('sends ui-command with absolute path and reports success when delivered', async () => {
        const { deps, sendUiCommand } = buildDeps()
        const tool = createOpenFileTool(deps)

        const result = await tool.execute({ path: '/tmp/demo/a.ts' })

        expect(sendUiCommand).toHaveBeenCalledTimes(1)
        expect(sendUiCommand).toHaveBeenCalledWith({ action: 'open_file', path: '/tmp/demo/a.ts' })
        expect(result.isError).toBe(false)
        expect(result.content[0].text).toContain('/tmp/demo/a.ts')
    })

    it('succeeds (non-error) with ignored notice when no web client is online', async () => {
        const { deps } = buildDeps({
            sendUiCommand: vi.fn().mockResolvedValue({ delivered: false, reason: 'no-web-online' }),
        })
        const tool = createOpenFileTool(deps)

        const result = await tool.execute({ path: '/tmp/demo/a.ts' })

        // 离线是调用成功非错误：不伪装失败，也不谎称已打开
        expect(result.isError).toBe(false)
        expect(result.content[0].text).not.toContain('opened')
        expect(result.content[0].text.toLowerCase()).toContain('ignored')
    })

    it('returns error result when socket is disconnected or ack times out (连接故障 ≠ 离线)', async () => {
        const { deps } = buildDeps({
            sendUiCommand: vi.fn().mockRejectedValue(new Error('ack timeout')),
        })
        const tool = createOpenFileTool(deps)

        const result = await tool.execute({ path: '/tmp/demo/a.ts' })

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('ack timeout')
    })

    it('returns error result for invalid arguments', async () => {
        const { deps, sendUiCommand } = buildDeps()
        const tool = createOpenFileTool(deps)

        const result = await tool.execute({ path: '' })

        expect(result.isError).toBe(true)
        expect(sendUiCommand).not.toHaveBeenCalled()
    })
})

describe('createOpenFileToolForSession', () => {
    it('binds client.sendUiCommand as transport', async () => {
        const sendUiCommand = vi.fn().mockResolvedValue({ delivered: true })
        const client = { sendUiCommand } as unknown as ApiSessionClient

        const tool = createOpenFileToolForSession(client)
        const result = await tool.execute({ path: '/tmp/demo/a.ts' })

        expect(sendUiCommand).toHaveBeenCalledWith({ action: 'open_file', path: '/tmp/demo/a.ts' })
        expect(result.isError).toBe(false)
    })
})
