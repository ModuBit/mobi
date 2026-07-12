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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PermissionHandler } from '../../src/claude/utils/permissionHandler'
import type { AgentState } from '../../src/api/types'

// ─── mock session 工厂 ─────────────────────────────────────────

function createMockDeps() {
    const updateAgentState = vi.fn((fn: (s: AgentState) => AgentState) => {})
    const registerHandler = vi.fn()
    const resetIdleTimer = vi.fn()
    const session = {
        client: {
            rpcHandlerManager: { registerHandler },
            updateAgentState,
            resetIdleTimer,
        },
        setPermissionMode: vi.fn(),
        queue: { unshift: vi.fn() },
    }
    return { session, updateAgentState, registerHandler, resetIdleTimer }
}

// 从 updateAgentState 的调用中提取最后一次注册的 permission request id集合
function registeredRequestIds(updateAgentState: ReturnType<typeof vi.fn>): string[] {
    const ids: string[] = []
    for (const call of updateAgentState.mock.calls) {
        const fn = call[0] as (s: AgentState) => AgentState
        const before: AgentState = { requests: {} } as unknown as AgentState
        const after = fn(before)
        if (after.requests) {
            ids.push(...Object.keys(after.requests))
        }
    }
    return ids
}

describe('PermissionHandler — 模式模拟死代码已移除', () => {
    let abortSignal: AbortSignal

    beforeEach(() => {
        abortSignal = new AbortController().signal
    })

    it('bypassPermissions 模式下 handleToolCall 不提前放行，进入正常审批 pending', () => {
        // SDK 文档：bypassPermissions 下 canUseTool 不会被 SDK 调用。
        // 即便被直接调用（防御），也不应自行 allow —— 决策权归 SDK。
        const { session, updateAgentState } = createMockDeps()
        const handler = new PermissionHandler(session as never)
        handler.handleModeChange('bypassPermissions')

        handler.handleToolCall(
            'Bash',
            { command: 'ls -la' },
            { signal: abortSignal, toolUseID: 't-bypass-1' } as never
        )

        // 进入 pending 会通过 addPendingRequest → updateAgentState 注册 request
        const ids = registeredRequestIds(updateAgentState)
        expect(ids).toContain('t-bypass-1')
    })

    it('acceptEdits 模式下编辑工具不提前放行，进入正常审批 pending', () => {
        const { session, updateAgentState } = createMockDeps()
        const handler = new PermissionHandler(session as never)
        handler.handleModeChange('acceptEdits')

        handler.handleToolCall(
            'Edit',
            { file_path: '/tmp/a.txt', old_string: 'x', new_string: 'y' },
            { signal: abortSignal, toolUseID: 't-edit-1' } as never
        )

        const ids = registeredRequestIds(updateAgentState)
        expect(ids).toContain('t-edit-1')
    })

    it('default 模式下普通工具进入正常审批 pending（回归保护）', () => {
        const { session, updateAgentState } = createMockDeps()
        const handler = new PermissionHandler(session as never)

        handler.handleToolCall(
            'Bash',
            { command: 'rm -rf /' },
            { signal: abortSignal, toolUseID: 't-default-1' } as never
        )

        const ids = registeredRequestIds(updateAgentState)
        expect(ids).toContain('t-default-1')
    })
})

describe('PermissionHandler — suggestions 观测日志', () => {
    it('有无 suggestions 都进入正常审批 pending（日志不改变行为）', () => {
        const { session, updateAgentState } = createMockDeps()
        const handler = new PermissionHandler(session as never)

        // 带 suggestions
        handler.handleToolCall(
            'Bash',
            { command: 'ls' },
            {
                signal: new AbortController().signal,
                toolUseID: 't-sugg-1',
                suggestions: [{ behavior: 'allow', destination: 'session' } as never],
            } as never
        )

        // 不带 suggestions
        handler.handleToolCall(
            'Bash',
            { command: 'pwd' },
            { signal: new AbortController().signal, toolUseID: 't-sugg-2' } as never
        )

        const ids = registeredRequestIds(updateAgentState)
        expect(ids).toContain('t-sugg-1')
        expect(ids).toContain('t-sugg-2')
    })
})

import type { SDKTaskStartedMessage } from '@anthropic-ai/claude-agent-sdk'

describe('PermissionHandler — toolCallId 直接用 SDK toolUseID', () => {
    it('handleToolCall 直接以 options.toolUseID 注册 pending（不经 name+input 反查）', () => {
        const { session, updateAgentState } = createMockDeps()
        const handler = new PermissionHandler(session as never)

        handler.handleToolCall(
            'Bash',
            { command: 'complex-cmd with args' },
            { signal: new AbortController().signal, toolUseID: 'tooluse-xyz-789' } as never
        )

        const ids = registeredRequestIds(updateAgentState)
        expect(ids).toContain('tooluse-xyz-789')
    })

    it('未提供 toolUseID 时抛明确错误（SDK 契约：toolUseID 必给）', async () => {
        const { session } = createMockDeps()
        const handler = new PermissionHandler(session as never)

        await expect(
            handler.handleToolCall(
                'Bash',
                { command: 'ls' },
                { signal: new AbortController().signal } as never
            )
        ).rejects.toThrow(/toolUseID/)
    })
})

describe('PermissionHandler — onMessage task_started 仍填充 agentInfo', () => {
    it('收到 task_started 系统消息后不抛错（agentInfoMap 保留逻辑）', () => {
        const { session } = createMockDeps()
        const handler = new PermissionHandler(session as never)

        const taskMsg = {
            type: 'system',
            subtype: 'task_started',
            task_id: 'agent-1',
            description: '研究权限流程',
            subagent_type: 'general-purpose',
        } as unknown as SDKTaskStartedMessage

        expect(() => handler.onMessage(taskMsg)).not.toThrow()
    })
})
