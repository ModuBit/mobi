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

/**
 * 有状态的 mock session：permissionMode 由 setPermissionMode 写、getPermissionMode 读，
 * 模拟真实 Session（sessionBase.ts:58）——方案 A 下它是权限模式的唯一真相源。
 */
function createMockDeps() {
    const updateAgentState = vi.fn((fn: (s: AgentState) => AgentState) => {})
    const registerHandler = vi.fn()
    const resetIdleTimer = vi.fn()
    let permissionMode: string | undefined
    const session = {
        client: {
            rpcHandlerManager: { registerHandler },
            updateAgentState,
            resetIdleTimer,
        },
        setPermissionMode: vi.fn((mode: string) => { permissionMode = mode }),
        getPermissionMode: vi.fn(() => permissionMode),
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

    it('未提供 toolUseID 时返回 deny（不中断流程）', async () => {
        const { session } = createMockDeps()
        const handler = new PermissionHandler(session as never)

        const result = await handler.handleToolCall(
            'Bash',
            { command: 'ls' },
            { signal: new AbortController().signal } as never
        )

        expect(result.behavior).toBe('deny')
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

describe('PermissionHandler — handlePermissionResponse 透传 updatedPermissions', () => {
    function createSession(): {
        session: unknown
        setPermissionMode: ReturnType<typeof vi.fn>
        queueUnshift: ReturnType<typeof vi.fn>
    } {
        const setPermissionMode = vi.fn()
        const queueUnshift = vi.fn()
        const session = {
            client: {
                rpcHandlerManager: { registerHandler: () => {} },
                updateAgentState: () => {},
                resetIdleTimer: () => {},
            },
            setPermissionMode,
            getPermissionMode: vi.fn(() => undefined),
            queue: { unshift: queueUnshift },
        }
        return { session, setPermissionMode, queueUnshift }
    }

    function makePending() {
        return {
            resolve: vi.fn(),
            reject: vi.fn(),
            toolName: 'Bash',
            input: {},
            toolUseID: 't1',
        }
    }

    it('response 带 updatedPermissions → pending.resolve 收到 user_permanent + updatedPermissions', async () => {
        const { session } = createSession()
        const handler = new PermissionHandler(session as never)
        const pending = makePending()

        const updatedPermissions = [
            {
                type: 'addRules' as const,
                rules: [{ toolName: 'Bash', ruleContent: 'ls' }],
                behavior: 'allow' as const,
                destination: 'session' as const,
            }
        ]

        // @ts-expect-error 访问 protected
        await handler.handlePermissionResponse(
            { id: 't1', approved: true, updatedPermissions },
            pending
        )

        expect(pending.resolve).toHaveBeenCalledTimes(1)
        const result = pending.resolve.mock.calls[0][0]
        expect(result.behavior).toBe('allow')
        expect(result.decisionClassification).toBe('user_permanent')
        expect(result.updatedPermissions).toHaveLength(1)
        expect(result.updatedPermissions).toEqual(updatedPermissions)
    })

    it('response 无 updatedPermissions → user_temporary 且不写 updatedPermissions', async () => {
        const { session } = createSession()
        const handler = new PermissionHandler(session as never)
        const pending = makePending()

        // @ts-expect-error 访问 protected
        await handler.handlePermissionResponse(
            { id: 't1', approved: true },
            pending
        )

        expect(pending.resolve).toHaveBeenCalledTimes(1)
        const result = pending.resolve.mock.calls[0][0]
        expect(result.behavior).toBe('allow')
        expect(result.decisionClassification).toBe('user_temporary')
        expect(result.updatedPermissions).toBeUndefined()
    })
})

describe('PermissionHandler — updatedPermissions 填 mobi Set 兜底持久化', () => {
    // SDK updatedPermissions 经 E2E 验证不跨 turn 持久，mobi 自有 Set 兜底：
    // handlePermissionResponse 把选中档 rules 填进 Set，handleToolCall 命中放行，真正跨 turn 持久
    function makeHandler() {
        const session = {
            client: {
                rpcHandlerManager: { registerHandler: () => {} },
                updateAgentState: () => {},
                resetIdleTimer: () => {},
            },
            setPermissionMode: vi.fn(),
            getPermissionMode: vi.fn(() => undefined),
            queue: { unshift: vi.fn() },
        }
        return { handler: new PermissionHandler(session as never), session }
    }

    it('Bash 前缀 rule 填 Set 后，同前缀命令 handleToolCall 命中放行', async () => {
        const { handler } = makeHandler()
        const pending = { resolve: vi.fn(), reject: vi.fn(), toolName: 'Bash', input: { command: 'echo hi' }, toolUseID: 't1' }
        // @ts-expect-error 访问 protected
        await handler.handlePermissionResponse({
            id: 't1', approved: true,
            updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'echo:*' }], behavior: 'allow', destination: 'session' }],
        }, pending)

        const result = await handler.handleToolCall(
            'Bash',
            { command: 'echo bye' },
            { signal: new AbortController().signal } as never
        )
        expect(result.behavior).toBe('allow')
    })

    it('Bash 字面 rule 填 Set 后，同精确命令命中放行', async () => {
        const { handler } = makeHandler()
        const pending = { resolve: vi.fn(), reject: vi.fn(), toolName: 'Bash', input: { command: 'echo hi' }, toolUseID: 't1' }
        // @ts-expect-error 访问 protected
        await handler.handlePermissionResponse({
            id: 't1', approved: true,
            updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'echo hi' }], behavior: 'allow', destination: 'session' }],
        }, pending)

        const result = await handler.handleToolCall(
            'Bash',
            { command: 'echo hi' },
            { signal: new AbortController().signal } as never
        )
        expect(result.behavior).toBe('allow')
    })

    it('非 Bash 工具 rule 填 Set 后，同工具命中放行', async () => {
        const { handler } = makeHandler()
        const pending = { resolve: vi.fn(), reject: vi.fn(), toolName: 'Read', input: { file_path: '/tmp/a' }, toolUseID: 't1' }
        // @ts-expect-error 访问 protected
        await handler.handlePermissionResponse({
            id: 't1', approved: true,
            updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'Read' }], behavior: 'allow', destination: 'session' }],
        }, pending)

        const result = await handler.handleToolCall(
            'Read',
            { file_path: '/tmp/b' },
            { signal: new AbortController().signal } as never
        )
        expect(result.behavior).toBe('allow')
    })

    it('不同命令不命中 Set，进入正常 pending（不误放行）', async () => {
        const { handler, session } = makeHandler()
        const pending = { resolve: vi.fn(), reject: vi.fn(), toolName: 'Bash', input: { command: 'echo hi' }, toolUseID: 't1' }
        // @ts-expect-error 访问 protected
        await handler.handlePermissionResponse({
            id: 't1', approved: true,
            updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'echo:*' }], behavior: 'allow', destination: 'session' }],
        }, pending)

        // rm 不匹配 echo:* 前缀，应进入 pending（updateAgentState 被调）
        const updateSpy = vi.spyOn(session.client, 'updateAgentState')
        handler.handleToolCall('Bash', { command: 'rm -rf /' }, { signal: new AbortController().signal, toolUseID: 't2' } as never)
        expect(updateSpy).toHaveBeenCalled()
    })

    it('SDK 给 addDirectories（suggestion 不可用）时回退命令字面填 Set，同命令命中放行', async () => {
        const { handler } = makeHandler()
        const pending = { resolve: vi.fn(), reject: vi.fn(), toolName: 'Bash', input: { command: 'echo hi > test-bash.txt' }, toolUseID: 't1' }
        // @ts-expect-error 访问 protected
        await handler.handlePermissionResponse({
            id: 't1', approved: true,
            updatedPermissions: [{ type: 'addDirectories', directories: ['/Users/manerfan/workspace/demo'], destination: 'session' }],
        }, pending)

        // 同命令字面命中 Set 放行
        const result = await handler.handleToolCall(
            'Bash',
            { command: 'echo hi > test-bash.txt' },
            { signal: new AbortController().signal } as never
        )
        expect(result.behavior).toBe('allow')
    })

    it('addDirectories 回退字面后，不同命令不命中（进 pending 不误放行）', () => {
        const { handler, session } = makeHandler()
        const pending = { resolve: vi.fn(), reject: vi.fn(), toolName: 'Bash', input: { command: 'echo hi > test-bash.txt' }, toolUseID: 't1' }
        // @ts-expect-error 访问 protected
        void handler.handlePermissionResponse({
            id: 't1', approved: true,
            updatedPermissions: [{ type: 'addDirectories', directories: ['/x'], destination: 'session' }],
        }, pending)

        const updateSpy = vi.spyOn(session.client, 'updateAgentState')
        handler.handleToolCall('Bash', { command: 'rm -rf /' }, { signal: new AbortController().signal, toolUseID: 't2' } as never)
        expect(updateSpy).toHaveBeenCalled()
    })

    it('removeRules 不触发命令字面兜底（移除语义不应反转为放行）', () => {
        const { handler, session } = makeHandler()
        const pending = { resolve: vi.fn(), reject: vi.fn(), toolName: 'Bash', input: { command: 'echo hi' }, toolUseID: 't1' }
        // @ts-expect-error 访问 protected
        void handler.handlePermissionResponse({
            id: 't1', approved: true,
            updatedPermissions: [{ type: 'removeRules', rules: [{ toolName: 'Bash', ruleContent: 'echo:*' }], behavior: 'deny', destination: 'session' }],
        }, pending)

        // removeRules 不触发字面兜底，同命令仍进 pending
        const updateSpy = vi.spyOn(session.client, 'updateAgentState')
        handler.handleToolCall('Bash', { command: 'echo hi' }, { signal: new AbortController().signal, toolUseID: 't2' } as never)
        expect(updateSpy).toHaveBeenCalled()
    })

    it('addRules Bash 无 ruleContent 不填裸 Bash（不放行所有 Bash）', () => {
        const { handler, session } = makeHandler()
        const pending = { resolve: vi.fn(), reject: vi.fn(), toolName: 'Bash', input: { command: 'echo hi' }, toolUseID: 't1' }
        // @ts-expect-error 访问 protected
        void handler.handlePermissionResponse({
            id: 't1', approved: true,
            updatedPermissions: [{ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'session' }],
        }, pending)

        // Bash 无 ruleContent 不填 Set，同命令仍进 pending（不放行裸 Bash）
        const updateSpy = vi.spyOn(session.client, 'updateAgentState')
        handler.handleToolCall('Bash', { command: 'echo hi' }, { signal: new AbortController().signal, toolUseID: 't2' } as never)
        expect(updateSpy).toHaveBeenCalled()
    })
})

// ─── 方案 A：权限模式单一真相源 = session ─────────────────────
// 背景：running 中 web 切换权限模式后，若权限判断仍以「消息入队时快照」为准，
// 消费旧消息会把 session 回写成旧值，心跳随即把旧值顶回 web（bug）。
// 修复语义：权限判断读 session 当前值，消息快照不再回写 session。
import { logger } from '../../src/ui/logger'

describe('PermissionHandler — 权限模式单一真相源 = session（方案 A）', () => {
    let abortSignal: AbortSignal

    beforeEach(() => {
        abortSignal = new AbortController().signal
    })

    it('handleModeChange 把模式写入 session，getPermissionMode 读到该值', () => {
        const { session } = createMockDeps()
        const handler = new PermissionHandler(session as never)
        handler.handleModeChange('acceptEdits')
        expect(session.getPermissionMode()).toBe('acceptEdits')
    })

    it('web 切换（只写 session）后，防御日志读到 session 当前值而非内部副本', () => {
        const { session } = createMockDeps()
        const handler = new PermissionHandler(session as never)
        const debugSpy = vi.spyOn(logger, 'debug')
        try {
            // 模拟 RPC set-session-config → syncSessionModes 直接写 session，不经过 handler
            session.setPermissionMode('bypassPermissions')

            handler.handleToolCall(
                'Bash',
                { command: 'ls' },
                { signal: abortSignal, toolUseID: 't-a1' } as never
            )

            // 防御日志（:299）打印的是 session 当前值 'bypassPermissions'
            const warnLog = debugSpy.mock.calls.find(([msg]) =>
                String(msg).includes('canUseTool invoked in')
            )
            expect(warnLog).toBeDefined()
            expect(String(warnLog![0])).toContain('bypassPermissions')
        } finally {
            debugSpy.mockRestore()
        }
    })

    it('handlePermissionResponse 带 mode 时更新 session（plan 退出等路径仍同步 session）', async () => {
        const { session } = createMockDeps()
        const handler = new PermissionHandler(session as never)
        handler.handleModeChange('plan')
        const pending = { resolve: vi.fn(), reject: vi.fn(), toolName: 'Bash', input: {}, toolUseID: 't1' }

        // @ts-expect-error 访问 protected
        await handler.handlePermissionResponse(
            { id: 't1', approved: true, mode: 'default' },
            pending
        )
        expect(session.getPermissionMode()).toBe('default')
    })
})
