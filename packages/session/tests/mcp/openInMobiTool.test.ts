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
import { createOpenInMobiTool, OPEN_IN_MOBI_TOOL_NAME } from '@/mcp/openInMobiTool'

function buildDeps(overrides?: Partial<{ sendUiCommand: ReturnType<typeof vi.fn> }>) {
    const sendUiCommand = overrides?.sendUiCommand ?? vi.fn().mockResolvedValue({ delivered: true })
    return { deps: { sendUiCommand }, sendUiCommand }
}

describe('createOpenInMobiTool', () => {
    it('exposes stable tool identity for mcp__mobi-apps__open_in_mobi prefix', () => {
        const { deps } = buildDeps()
        const tool = createOpenInMobiTool(deps)

        expect(tool.name).toBe(OPEN_IN_MOBI_TOOL_NAME)
        expect(tool.name).toBe('open_in_mobi')
        // 检索关键词（spec 命名约定）+ codex 同款"只开 UI"提示（防误用作读取通道）
        const desc = tool.description.toLowerCase()
        expect(desc).toContain('open')
        expect(desc).toContain('terminal')
        expect(desc).toContain('sidebar')
        expect(desc).toContain('show')
        expect(desc).toContain('user')
        expect(desc).toContain('only opens')
    })

    it('sends ui-command with file target and reports success when delivered', async () => {
        const { deps, sendUiCommand } = buildDeps()
        const tool = createOpenInMobiTool(deps)

        const result = await tool.execute({ target: { type: 'file', path: '/tmp/demo/a.ts' } })

        expect(sendUiCommand).toHaveBeenCalledTimes(1)
        expect(sendUiCommand).toHaveBeenCalledWith({
            action: 'open_in_mobi',
            payload: { type: 'file', path: '/tmp/demo/a.ts' },
        })
        expect(result.isError).toBe(false)
        expect(result.content[0].text).toContain('/tmp/demo/a.ts')
    })

    it('mentions line number in success text when provided', async () => {
        const { deps } = buildDeps()
        const tool = createOpenInMobiTool(deps)

        const result = await tool.execute({ target: { type: 'file', path: '/tmp/demo/a.ts', line: 42 } })

        expect(result.isError).toBe(false)
        expect(result.content[0].text).toContain('line 42')
    })

    it('sends terminal target as-is', async () => {
        const { deps, sendUiCommand } = buildDeps()
        const tool = createOpenInMobiTool(deps)

        const result = await tool.execute({ target: { type: 'terminal' } })

        expect(sendUiCommand).toHaveBeenCalledWith({
            action: 'open_in_mobi',
            payload: { type: 'terminal' },
        })
        expect(result.isError).toBe(false)
        expect(result.content[0].text).toContain('terminal')
    })

    it('succeeds (non-error) with ignored notice when no web client is online', async () => {
        const { deps } = buildDeps({
            sendUiCommand: vi.fn().mockResolvedValue({ delivered: false, reason: 'no-web-online' }),
        })
        const tool = createOpenInMobiTool(deps)

        const result = await tool.execute({ target: { type: 'file', path: '/tmp/demo/a.ts' } })

        // 离线是调用成功非错误：不伪装失败，也不谎称已打开
        expect(result.isError).toBe(false)
        expect(result.content[0].text).not.toContain('Opened')
        expect(result.content[0].text.toLowerCase()).toContain('ignored')
    })

    it('treats permanent rejection reasons as errors with the real cause (不伪装成已忽略)', async () => {
        const { deps } = buildDeps({
            sendUiCommand: vi.fn().mockResolvedValue({ delivered: false, reason: 'access-denied' }),
        })
        const tool = createOpenInMobiTool(deps)

        const result = await tool.execute({ target: { type: 'file', path: '/tmp/demo/a.ts' } })

        // access-denied 不是离线：isError 并透出真实原因，不让 agent 误以为重试有用
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('access-denied')
        expect(result.content[0].text.toLowerCase()).not.toContain('ignored')
    })

    it('returns error result when socket is disconnected or ack times out (连接故障 ≠ 离线)', async () => {
        const { deps } = buildDeps({
            sendUiCommand: vi.fn().mockRejectedValue(new Error('ack timeout')),
        })
        const tool = createOpenInMobiTool(deps)

        const result = await tool.execute({ target: { type: 'file', path: '/tmp/demo/a.ts' } })

        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain('ack timeout')
    })

    it('returns error result for invalid arguments', async () => {
        const { deps, sendUiCommand } = buildDeps()
        const tool = createOpenInMobiTool(deps)

        const result = await tool.execute({ target: { type: 'file', path: '' } })

        expect(result.isError).toBe(true)
        expect(sendUiCommand).not.toHaveBeenCalled()
    })
})
