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

// ============ 批次 C：elicitation 受理与响应转型（spec D1/D2/D3）============

import { describe, it, expect, vi } from 'vitest'
import { PermissionHandler, coerceElicitationContent } from '../../src/claude/utils/permissionHandler'
import { ELICITATION_TOOL_NAME } from '@mobi/shared'
import type { AgentState } from '../../src/api/types'
import type { PendingPermissionRequest } from '../../src/modules/common/permission/BasePermissionHandler'

// ─── mock session 工厂（与 permissionHandler.test.ts 同一 stub 方式）─────────

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
        getPermissionMode: vi.fn(() => undefined),
        queue: { unshift: vi.fn() },
    }
    return { session, updateAgentState, registerHandler, resetIdleTimer }
}

/** 从 updateAgentState 调用中提取末次 requests 快照 */
function lastRequests(updateAgentState: ReturnType<typeof vi.fn>): Record<string, unknown> {
    let requests: Record<string, unknown> = {}
    for (const call of updateAgentState.mock.calls) {
        const fn = call[0] as (s: AgentState) => AgentState
        const after = fn({ requests: {} } as unknown as AgentState)
        if (after.requests) requests = after.requests
    }
    return requests
}

/** 取 protected pendingRequests 中的 pending（驱动 handlePermissionResponse 用） */
function getPending(handler: PermissionHandler, id: string): PendingPermissionRequest<unknown> {
    const map = (handler as unknown as { pendingRequests: Map<string, PendingPermissionRequest<unknown>> }).pendingRequests
    const pending = map.get(id)
    expect(pending).toBeDefined()
    return pending!
}

/** 取 mock session 上的 updateAgentState */
function updateAgentStateOf(session: ReturnType<typeof createMockDeps>['session']) {
    return session.client.updateAgentState
}

/** 按时序折叠全部 updateAgentState 调用（lastRequests 每次重置状态，观察不到移除） */
function foldedRequests(updateAgentState: ReturnType<typeof vi.fn>): Record<string, unknown> {
    let state: { requests?: Record<string, unknown> } = { requests: {} }
    for (const call of updateAgentState.mock.calls) {
        state = (call[0] as (s: { requests?: Record<string, unknown> }) => { requests?: Record<string, unknown> })(state)
    }
    return state.requests ?? {}
}

const FORM_SCHEMA = {
    type: 'object',
    properties: {
        name: { type: 'string' },
        count: { type: 'number' },
        flag: { type: 'boolean' },
    },
    required: ['name'],
} as const

describe('handleElicitation', () => {
    it('url 模式直接 decline，不建 pending', async () => {
        const { session, updateAgentState } = createMockDeps()
        const handler = new PermissionHandler(session as never)

        const result = await handler.handleElicitation(
            { mode: 'url', url: 'https://x', serverName: 's', message: 'm' },
            { signal: new AbortController().signal, requestId: 'el-url-1' }
        )

        expect(result).toEqual({ action: 'decline' })
        expect(lastRequests(updateAgentState)).toEqual({})
    })

    it('form 模式建 pending（agentState.requests 出现 mcp_elicitation 条目）', async () => {
        const { session, updateAgentState } = createMockDeps()
        const handler = new PermissionHandler(session as never)

        const pendingPromise = handler.handleElicitation(
            {
                mode: 'form',
                serverName: 'tester',
                message: '请填写',
                requestedSchema: { ...FORM_SCHEMA },
            },
            { signal: new AbortController().signal, requestId: 'el-form-1' }
        )

        // promise 挂起中（等用户响应）
        let settled = false
        void pendingPromise.then(() => { settled = true })
        await Promise.resolve()
        expect(settled).toBe(false)

        // agentState.requests 含合成 toolName 条目，arguments 携带 serverName/message/requestedSchema
        const entry = lastRequests(updateAgentState)['el-form-1'] as { tool: string; arguments: Record<string, unknown> } | undefined
        expect(entry).toBeDefined()
        expect(entry!.tool).toBe(ELICITATION_TOOL_NAME)
        expect(entry!.tool).toBe('mcp_elicitation')
        expect(entry!.arguments).toMatchObject({
            serverName: 'tester',
            message: '请填写',
            requestedSchema: FORM_SCHEMA,
        })

        // 收尾：走拒绝路径清掉 pending，避免悬挂
        await handler.handlePermissionResponse(
            { id: 'el-form-1', approved: false },
            getPending(handler, 'el-form-1') as never
        )
        expect(await pendingPromise).toEqual({ action: 'decline' })
    })

    it('requestedSchema 非法（缺 properties）decline', async () => {
        const { session } = createMockDeps()
        const handler = new PermissionHandler(session as never)

        const result = await handler.handleElicitation(
            {
                mode: 'form',
                serverName: 's',
                message: 'm',
                requestedSchema: { type: 'object' },
            },
            { signal: new AbortController().signal, requestId: 'el-bad-1' }
        )

        expect(result).toEqual({ action: 'decline' })
    })

    it('abort signal 触发后返回 cancel', async () => {
        const { session } = createMockDeps()
        const handler = new PermissionHandler(session as never)
        const controller = new AbortController()

        const pendingPromise = handler.handleElicitation(
            {
                mode: 'form',
                serverName: 's',
                message: 'm',
                requestedSchema: { ...FORM_SCHEMA },
            },
            { signal: controller.signal, requestId: 'el-abort-1' }
        )

        controller.abort()
        expect(await pendingPromise).toEqual({ action: 'cancel' })
    })

    it('仅 abort（无 turn 重置跟随）时 agentState.requests 中该条目被移除（spec D5 已决即消失）', async () => {
        const { session } = createMockDeps()
        const handler = new PermissionHandler(session as never)
        const controller = new AbortController()

        const pendingPromise = handler.handleElicitation(
            {
                mode: 'form',
                serverName: 's',
                message: 'm',
                requestedSchema: { ...FORM_SCHEMA },
            },
            { signal: controller.signal, requestId: 'el-abort-clean-1' }
        )

        // abort 前卡片已在 agentState.requests
        expect(foldedRequests(updateAgentStateOf(session))['el-abort-clean-1']).toBeDefined()

        controller.abort()
        expect(await pendingPromise).toEqual({ action: 'cancel' })

        // 仅 abort、无 turn 重置跟随：卡片必须被移除，不残留
        expect(foldedRequests(updateAgentStateOf(session))['el-abort-clean-1']).toBeUndefined()
    })

    it('入口即 aborted（pre-aborted signal）快速返回 cancel，不建 pending（DOM 语义：已中止信号的 abort 监听器永不触发）', async () => {
        const { session, updateAgentState } = createMockDeps()
        const handler = new PermissionHandler(session as never)
        const controller = new AbortController()
        controller.abort()

        const result = await handler.handleElicitation(
            {
                mode: 'form',
                serverName: 's',
                message: 'm',
                requestedSchema: { ...FORM_SCHEMA },
            },
            { signal: controller.signal, requestId: 'el-preabort-1' }
        )

        expect(result).toEqual({ action: 'cancel' })
        // 不建卡片（否则监听器永不触发，卡片与 promise 悬挂到 turn 重置）
        expect(foldedRequests(updateAgentState)['el-preabort-1']).toBeUndefined()
    })

    it('turn 重置（resetForNewTurn）后返回 cancel', async () => {
        const { session } = createMockDeps()
        const handler = new PermissionHandler(session as never)

        const pendingPromise = handler.handleElicitation(
            {
                mode: 'form',
                serverName: 's',
                message: 'm',
                requestedSchema: { ...FORM_SCHEMA },
            },
            { signal: new AbortController().signal, requestId: 'el-reset-1' }
        )

        handler.resetForNewTurn()
        expect(await pendingPromise).toEqual({ action: 'cancel' })
    })
})

describe('coerceElicitationContent', () => {
    it('按 requestedSchema 转型 number/boolean/string', () => {
        const content = coerceElicitationContent(
            { name: 'x', count: '3', flag: 'true' },
            { type: 'object', properties: { name: { type: 'string' }, count: { type: 'number' }, flag: { type: 'boolean' } } }
        )
        expect(content).toEqual({ name: 'x', count: 3, flag: true })
    })

    it('required 字段缺失返回 null', () => {
        const content = coerceElicitationContent(
            { count: '3' },
            {
                type: 'object',
                properties: { name: { type: 'string' }, count: { type: 'number' } },
                required: ['name'],
            }
        )
        expect(content).toBeNull()
    })

    it('number 字段收到非数值串按缺失处理（required → null，非 required → 跳过）', () => {
        const required = coerceElicitationContent(
            { count: 'abc' },
            { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] }
        )
        expect(required).toBeNull()

        const optional = coerceElicitationContent(
            { count: 'abc' },
            { type: 'object', properties: { count: { type: 'number' } } }
        )
        expect(optional).toEqual({})
    })

    it('enum 字段透传字符串，非 required 缺省跳过，schema 外字段不进 content', () => {
        const content = coerceElicitationContent(
            { mode: 'fast', extra: 'ignored' },
            {
                type: 'object',
                properties: { mode: { type: 'string', enum: ['fast', 'slow'] }, note: { type: 'string' } },
            }
        )
        expect(content).toEqual({ mode: 'fast' })
    })

    // ─── code-review 修复：integer / enum 成员校验 / 无 type 的 enum ───────────

    it('integer 类型：字符串数字转 number，非整数值按缺失处理', () => {
        const ok = coerceElicitationContent(
            { port: '8000' },
            { type: 'object', properties: { port: { type: 'integer' } }, required: ['port'] }
        )
        expect(ok).toEqual({ port: 8000 })

        // 非整数 → required 时 null，非 required 时跳过
        const req = coerceElicitationContent(
            { port: '5.5' },
            { type: 'object', properties: { port: { type: 'integer' } }, required: ['port'] }
        )
        expect(req).toBeNull()

        const opt = coerceElicitationContent(
            { port: '5.5' },
            { type: 'object', properties: { port: { type: 'integer' } } }
        )
        expect(opt).toEqual({})
    })

    it('integer 类型：number 原生值通过，浮点数按缺失处理', () => {
        const ok = coerceElicitationContent(
            { port: 8000 },
            { type: 'object', properties: { port: { type: 'integer' } } }
        )
        expect(ok).toEqual({ port: 8000 })

        const bad = coerceElicitationContent(
            { port: 5.5 },
            { type: 'object', properties: { port: { type: 'integer' } }, required: ['port'] }
        )
        expect(bad).toBeNull()
    })

    it('enum 成员校验：值不在 enum 内按缺失处理（required → null）', () => {
        const req = coerceElicitationContent(
            { mode: 'yolo' },
            { type: 'object', properties: { mode: { type: 'string', enum: ['fast', 'slow'] } }, required: ['mode'] }
        )
        expect(req).toBeNull()

        const opt = coerceElicitationContent(
            { mode: 'yolo' },
            { type: 'object', properties: { mode: { type: 'string', enum: ['fast', 'slow'] } } }
        )
        expect(opt).toEqual({})
    })

    it('enum 合法成员透传（string/number/boolean 各类型）', () => {
        expect(coerceElicitationContent(
            { mode: 'fast' },
            { type: 'object', properties: { mode: { type: 'string', enum: ['fast', 'slow'] } } }
        )).toEqual({ mode: 'fast' })

        // number enum（type:number + enum）
        expect(coerceElicitationContent(
            { level: '2' },
            { type: 'object', properties: { level: { type: 'number', enum: [1, 2, 3] } } }
        )).toEqual({ level: 2 })

        // 无 type 的 enum：成员类型即值类型，匹配成员才透传
        expect(coerceElicitationContent(
            { flag: true },
            { type: 'object', properties: { flag: { enum: [true, false] } } }
        )).toEqual({ flag: true })

        // 无 type 的 enum：非成员按缺失
        expect(coerceElicitationContent(
            { flag: 'maybe' },
            { type: 'object', properties: { flag: { enum: [true, false] } }, required: ['flag'] }
        )).toBeNull()
    })
})

describe('handlePermissionResponse elicitation 分支', () => {
    async function makeFormPending(id: string) {
        const { session } = createMockDeps()
        const handler = new PermissionHandler(session as never)
        const pendingPromise = handler.handleElicitation(
            {
                mode: 'form',
                serverName: 'tester',
                message: '请填写',
                requestedSchema: { ...FORM_SCHEMA },
            },
            { signal: new AbortController().signal, requestId: id }
        )
        return { handler, pendingPromise, pending: getPending(handler, id) }
    }

    it('approved + answers → accept + 转型后 content', async () => {
        const { handler, pendingPromise, pending } = await makeFormPending('el-approve-1')

        // @ts-expect-error 访问 protected
        await handler.handlePermissionResponse(
            { id: 'el-approve-1', approved: true, answers: { name: 'x', count: '3', flag: 'true' } },
            pending as never
        )

        expect(await pendingPromise).toEqual({
            action: 'accept',
            content: { name: 'x', count: 3, flag: true },
        })
    })

    it('approved=false → decline', async () => {
        const { handler, pendingPromise, pending } = await makeFormPending('el-deny-1')

        // @ts-expect-error 访问 protected
        await handler.handlePermissionResponse(
            { id: 'el-deny-1', approved: false, reason: 'nope' },
            pending as never
        )

        expect(await pendingPromise).toEqual({ action: 'decline' })
    })

    it('answers 缺 required 字段 → decline（cli 侧自校验，rpc 通道无 zod）', async () => {
        const { handler, pendingPromise, pending } = await makeFormPending('el-missing-1')

        // @ts-expect-error 访问 protected
        await handler.handlePermissionResponse(
            { id: 'el-missing-1', approved: true, answers: { count: '3' } },
            pending as never
        )

        expect(await pendingPromise).toEqual({ action: 'decline' })
    })
})
