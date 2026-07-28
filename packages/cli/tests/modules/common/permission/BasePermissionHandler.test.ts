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
import {
    BasePermissionHandler,
    type PermissionCompletion
} from '@/modules/common/permission/BasePermissionHandler'
import type { AgentState } from '@/api/types'
import type { PermissionUpdate, SDKUIHints } from '@mobi/shared'

// 最小子类：仅满足 BasePermissionHandler 的两个抽象方法，便于直接测 addPendingRequest
class H extends BasePermissionHandler<{ id: string }, PermissionCompletion> {
    register(
        id: string,
        toolName: string,
        input: unknown,
        handlers: { resolve: (v: PermissionCompletion) => void; reject: (e: Error) => void },
        extra?: { suggestions?: PermissionUpdate[]; toolUseID?: string; sdkHints?: SDKUIHints }
    ): void {
        this.addPendingRequest(id, toolName, input, handlers, extra)
    }

    protected handlePermissionResponse(): Promise<PermissionCompletion> {
        return Promise.resolve({ status: 'approved' })
    }

    protected handleMissingPendingResponse(): void {
        // no-op
    }
}

describe('BasePermissionHandler — addPendingRequest 写入 suggestions', () => {
    it('注册 pending request 时透传 suggestions 到 agentState.requests[id]', () => {
        const captured: AgentState[] = []
        const client = {
            rpcHandlerManager: { registerHandler: () => {} },
            updateAgentState: (fn: (s: AgentState) => AgentState) => {
                captured.push(fn({ requests: {} } as AgentState))
            }
        }

        const handler = new H(client)
        const suggestions: PermissionUpdate[] = [
            {
                type: 'addRules',
                rules: [{ toolName: 'Bash', ruleContent: 'ls' }],
                behavior: 'allow',
                destination: 'session'
            }
        ]

        handler.register(
            't-1',
            'Bash',
            { command: 'ls' },
            { resolve: () => {}, reject: () => {} },
            { suggestions }
        )

        expect(captured).toHaveLength(1)
        const request = captured[0].requests?.['t-1']
        expect(request).toBeDefined()
        expect(request.tool).toBe('Bash')
        // suggestions 数组原样透传，destination 保持不变
        expect(request.suggestions).toEqual(suggestions)
        expect(request.suggestions?.[0].destination).toBe('session')
    })

    it('未传 suggestions 时 requests[id].suggestions 为 undefined', () => {
        const captured: AgentState[] = []
        const client = {
            rpcHandlerManager: { registerHandler: () => {} },
            updateAgentState: (fn: (s: AgentState) => AgentState) => {
                captured.push(fn({ requests: {} } as AgentState))
            }
        }

        const handler = new H(client)
        handler.register(
            't-2',
            'Read',
            { file_path: '/tmp/x' },
            { resolve: () => {}, reject: () => {} }
        )

        const request = captured[0].requests?.['t-2']
        expect(request).toBeDefined()
        expect(request.suggestions).toBeUndefined()
    })
})
