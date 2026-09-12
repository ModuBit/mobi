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
import { registerAgentSessionHandlers } from '../../../src/socket/handlers/cli/agentSessionHandlers'
import type { AgentSessionHandlersDeps } from '../../../src/socket/handlers/cli/agentSessionHandlers'
import type { StoredSession } from '../../../src/store/types'
import type { AgentMachineSummary } from '@mobi/shared'

/** 构造最小 StoredSession mock（仅含必要字段） */
function makeStoredSession(sid: string, namespace = 'default'): StoredSession {
    return {
        id: sid, tag: null, namespace, machineId: null,
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

type Ack = { ok: true; machines: AgentMachineSummary[] } | { ok: false; reason: string }

function makeDeps(opts?: { machines?: AgentMachineSummary[] }) {
    const seenNamespaces: string[] = []
    const deps: AgentSessionHandlersDeps = {
        resolveSessionAccess: (sid: string) => ({ ok: true as const, value: makeStoredSession(sid) }),
        listOnlineMachines: (namespace: string) => {
            seenNamespaces.push(namespace)
            return opts?.machines ?? []
        },
    }
    return { deps, seenNamespaces }
}

/** 触发 listMachinesForAgent 并捕获 ack 回执 */
function callListMachines(socket: ReturnType<typeof makeFakeSocket>, payload: unknown): Ack {
    let answer: Ack | undefined
    socket.emit('listMachinesForAgent', payload, (a: Ack) => { answer = a })
    return answer!
}

function register(
    socket: ReturnType<typeof makeFakeSocket>,
    deps: AgentSessionHandlersDeps,
): void {
    registerAgentSessionHandlers(socket as unknown as Parameters<typeof registerAgentSessionHandlers>[0], deps)
}

describe('listMachinesForAgent handler', () => {
    test('正常请求 → ack ok:true 带回机器清单', () => {
        const socket = makeFakeSocket()
        const machines: AgentMachineSummary[] = [
            { machineId: 'm1', name: 'Mac Mini', hostname: 'host-a', activeAt: 1700 },
        ]
        const { deps } = makeDeps({ machines })
        register(socket, deps)

        expect(callListMachines(socket, { sid: 's1' })).toEqual({ ok: true, machines })
    })

    test('namespace 取自鉴权会话而非入参——agent 只能看到自己 namespace 的资源', () => {
        const socket = makeFakeSocket()
        const { deps, seenNamespaces } = makeDeps()
        // 入参 sid 与鉴权解析出的会话不同（resume 换 id 场景）：必须用后者的 namespace
        deps.resolveSessionAccess = (sid: string) => ({
            ok: true as const,
            value: makeStoredSession(`authoritative-${sid}`, 'ns-from-session'),
        })
        register(socket, deps)

        callListMachines(socket, { sid: 's1' })

        expect(seenNamespaces).toEqual(['ns-from-session'])
    })

    test('会话访问被拒 → ack ok:false 且不查机器', () => {
        const socket = makeFakeSocket()
        const { deps, seenNamespaces } = makeDeps()
        deps.resolveSessionAccess = () => ({ ok: false as const, reason: 'access-denied' })
        register(socket, deps)

        expect(callListMachines(socket, { sid: 's1' })).toEqual({ ok: false, reason: 'access-denied' })
        expect(seenNamespaces).toHaveLength(0)
    })

    test('非法 payload（缺 sid）→ ack ok:false（invalid-payload）', () => {
        const socket = makeFakeSocket()
        const { deps, seenNamespaces } = makeDeps()
        register(socket, deps)

        expect(callListMachines(socket, {})).toEqual({ ok: false, reason: 'invalid-payload' })
        expect(seenNamespaces).toHaveLength(0)
    })

    test('listOnlineMachines 未装配 → ack ok:false（handler-misconfigured），不静默回空清单', () => {
        const socket = makeFakeSocket()
        const { deps } = makeDeps()
        delete deps.listOnlineMachines
        register(socket, deps)

        // 关键：绝不能返回 { ok: true, machines: [] }——那会把"服务没接上"
        // 伪装成"一台机器都没有"
        expect(callListMachines(socket, { sid: 's1' })).toEqual({ ok: false, reason: 'handler-misconfigured' })
    })

    test('无在线机器 → ack ok:true 带空数组（真实空态，不是故障）', () => {
        const socket = makeFakeSocket()
        const { deps } = makeDeps({ machines: [] })
        register(socket, deps)

        expect(callListMachines(socket, { sid: 's1' })).toEqual({ ok: true, machines: [] })
    })
})
