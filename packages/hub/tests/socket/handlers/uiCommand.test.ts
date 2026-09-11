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

import { describe, test, expect } from 'bun:test'
import { registerUiCommandHandlers } from '../../../src/socket/handlers/cli/uiCommandHandlers'
import type { UiCommandHandlersDeps } from '../../../src/socket/handlers/cli/uiCommandHandlers'
import type { StoredSession } from '../../../src/store/types'
import type { SyncEvent } from '../../../src/sync/syncEngine'
import type { UiCommandAction } from '@mobi/shared/types'

/** 构造最小 StoredSession mock（仅含必要字段） */
function makeStoredSession(sid: string): StoredSession {
    return {
        id: sid, tag: null, namespace: 'default', machineId: null,
        createdAt: 1, updatedAt: 1, metadata: null, metadataVersion: 0,
        agentState: null, agentStateVersion: 0, runtimeState: null,
        runtimeStateUpdatedAt: null, projectId: null, pinned: false, seq: 1,
    }
}

/** 最小化 fake socket：按 event 名捕获 handler，便于直接触发 */
function makeFakeSocket() {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    return {
        on(event: string, handler: (...args: unknown[]) => void) {
            handlers.set(event, handler)
        },
        emit(event: string, ...args: unknown[]) {
            handlers.get(event)?.(...args)
        },
    }
}

function makeDeps(opts?: { hasWeb?: boolean }) {
    const published: SyncEvent[] = []
    const deps: UiCommandHandlersDeps = {
        resolveSessionAccess: (sid: string) => ({ ok: true as const, value: makeStoredSession(sid) }),
        hasActiveSseConnection: () => opts?.hasWeb ?? true,
        publishUiCommand: (event: SyncEvent) => { published.push(event) },
    }
    return { deps, published }
}

/** 触发 sendUiCommand 并捕获 ack 回执 */
function callSendUiCommand(
    socket: ReturnType<typeof makeFakeSocket>,
    payload: unknown,
): { delivered: boolean; reason?: string } {
    let answer: { delivered: boolean; reason?: string } | undefined
    socket.emit('sendUiCommand', payload, (a: { delivered: boolean; reason?: string }) => { answer = a })
    return answer!
}

describe('sendUiCommand handler', () => {
    test('有 web 连接 → 发布 ui-command 事件且 ack delivered:true', () => {
        const socket = makeFakeSocket()
        const { deps, published } = makeDeps({ hasWeb: true })
        registerUiCommandHandlers(socket as unknown as Parameters<typeof registerUiCommandHandlers>[0], deps)

        const action: UiCommandAction = { action: 'open_file', path: '/tmp/demo/a.ts' }
        const answer = callSendUiCommand(socket, { sid: 's1', action })

        expect(answer).toEqual({ delivered: true })
        expect(published).toHaveLength(1)
        const event = published[0] as Extract<SyncEvent, { type: 'ui-command' }>
        expect(event.type).toBe('ui-command')
        expect(event.sessionId).toBe('s1')
        expect(event.action).toEqual(action)
    })

    test('无 web 连接 → ack delivered:false（no-web-online）且不发布', () => {
        const socket = makeFakeSocket()
        const { deps, published } = makeDeps({ hasWeb: false })
        registerUiCommandHandlers(socket as unknown as Parameters<typeof registerUiCommandHandlers>[0], deps)

        const answer = callSendUiCommand(socket, {
            sid: 's1',
            action: { action: 'open_file', path: '/tmp/demo/a.ts' },
        })

        expect(answer).toEqual({ delivered: false, reason: 'no-web-online' })
        expect(published).toHaveLength(0)
    })

    test('会话访问被拒 → ack delivered:false 且不发布', () => {
        const socket = makeFakeSocket()
        const { deps, published } = makeDeps()
        deps.resolveSessionAccess = () => ({ ok: false as const, reason: 'access-denied' })
        registerUiCommandHandlers(socket as unknown as Parameters<typeof registerUiCommandHandlers>[0], deps)

        const answer = callSendUiCommand(socket, {
            sid: 's1',
            action: { action: 'open_file', path: '/tmp/demo/a.ts' },
        })

        expect(answer).toEqual({ delivered: false, reason: 'access-denied' })
        expect(published).toHaveLength(0)
    })

    test('非法 payload（缺 path）→ ack delivered:false 且不发布', () => {
        const socket = makeFakeSocket()
        const { deps, published } = makeDeps()
        registerUiCommandHandlers(socket as unknown as Parameters<typeof registerUiCommandHandlers>[0], deps)

        const answer = callSendUiCommand(socket, { sid: 's1', action: { action: 'open_file' } })

        expect(answer!.delivered).toBe(false)
        expect(published).toHaveLength(0)
    })
})
