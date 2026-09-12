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
import type { AgentCreateSessionAck, AgentMachineSummary, AgentSessionSummary } from '@mobi/shared'

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
type SessionsAck = { ok: true; sessions: AgentSessionSummary[] } | { ok: false; reason: string }

function makeDeps(opts?: {
    machines?: AgentMachineSummary[]
    sessions?: AgentSessionSummary[]
    createResult?: AgentCreateSessionAck
}) {
    const seenNamespaces: string[] = []
    const seenQueries: unknown[] = []
    const seenCreateInputs: unknown[] = []
    const deps: AgentSessionHandlersDeps = {
        resolveSessionAccess: (sid: string) => ({ ok: true as const, value: makeStoredSession(sid) }),
        listOnlineMachines: (namespace: string) => {
            seenNamespaces.push(namespace)
            return opts?.machines ?? []
        },
        listSessions: (namespace: string, query) => {
            seenNamespaces.push(namespace)
            seenQueries.push(query)
            return opts?.sessions ?? []
        },
        createSession: async (namespace: string, input) => {
            seenNamespaces.push(namespace)
            seenCreateInputs.push(input)
            return opts?.createResult ?? { ok: true, sessionId: 's-new' }
        },
    }
    return { deps, seenNamespaces, seenQueries, seenCreateInputs }
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

/** 触发 listSessionsForAgent 并捕获 ack 回执 */
function callListSessions(socket: ReturnType<typeof makeFakeSocket>, payload: unknown): SessionsAck {
    let answer: SessionsAck | undefined
    socket.emit('listSessionsForAgent', payload, (a: SessionsAck) => { answer = a })
    return answer!
}

describe('listSessionsForAgent handler', () => {
    const SESSIONS: AgentSessionSummary[] = [
        { sessionId: 's1', projectId: null, active: true, running: false, updatedAt: 1700, pinned: false },
    ]

    test('正常请求 → ack ok:true 带回会话清单', () => {
        const socket = makeFakeSocket()
        const { deps } = makeDeps({ sessions: SESSIONS })
        register(socket, deps)

        expect(callListSessions(socket, { sid: 's1' })).toEqual({ ok: true, sessions: SESSIONS })
    })

    test('查询条件逐项透传给服务，且 sid 不混进查询条件', () => {
        const socket = makeFakeSocket()
        const { deps, seenQueries } = makeDeps()
        register(socket, deps)

        callListSessions(socket, { sid: 's1', keyword: '重构', status: 'ALL', limit: 5, projectId: 'p1' })

        // sid 是发给 Hub 的寻址信息，不是筛选条件——混进去会变成服务看不懂的字段
        expect(seenQueries).toEqual([{ keyword: '重构', status: 'ALL', limit: 5, projectId: 'p1' }])
    })

    test('不传查询条件 → 服务收到空查询（默认行为由服务决定，handler 不预设）', () => {
        const socket = makeFakeSocket()
        const { deps, seenQueries } = makeDeps()
        register(socket, deps)

        callListSessions(socket, { sid: 's1' })

        expect(seenQueries).toEqual([{}])
    })

    test('namespace 取自鉴权会话而非入参——agent 只能看到自己 namespace 的资源', () => {
        const socket = makeFakeSocket()
        const { deps, seenNamespaces } = makeDeps()
        deps.resolveSessionAccess = (sid: string) => ({
            ok: true as const,
            value: makeStoredSession(`authoritative-${sid}`, 'ns-from-session'),
        })
        register(socket, deps)

        callListSessions(socket, { sid: 's1' })

        expect(seenNamespaces).toEqual(['ns-from-session'])
    })

    test('会话访问被拒 → ack ok:false 且不查会话', () => {
        const socket = makeFakeSocket()
        const { deps, seenQueries } = makeDeps()
        deps.resolveSessionAccess = () => ({ ok: false as const, reason: 'access-denied' })
        register(socket, deps)

        expect(callListSessions(socket, { sid: 's1' })).toEqual({ ok: false, reason: 'access-denied' })
        expect(seenQueries).toHaveLength(0)
    })

    test('非法 payload（缺 sid / status 取值越界）→ ack ok:false（invalid-payload）', () => {
        const socket = makeFakeSocket()
        const { deps, seenQueries } = makeDeps()
        register(socket, deps)

        expect(callListSessions(socket, { keyword: 'x' })).toEqual({ ok: false, reason: 'invalid-payload' })
        // status 只认三档：小写 / 未知值都不能落进服务（否则服务里那个 switch 会静默走空过滤）
        expect(callListSessions(socket, { sid: 's1', status: 'active' })).toEqual({ ok: false, reason: 'invalid-payload' })
        expect(callListSessions(socket, { sid: 's1', status: 'BOGUS' })).toEqual({ ok: false, reason: 'invalid-payload' })
        expect(seenQueries).toHaveLength(0)
    })

    test('listSessions 未装配 → ack ok:false（handler-misconfigured），不静默回空清单', () => {
        const socket = makeFakeSocket()
        const { deps } = makeDeps()
        delete deps.listSessions
        register(socket, deps)

        // 关键：绝不能返回 { ok: true, sessions: [] }——那会让 agent 以为
        //「一个会话都没有」，与「服务没接上」混淆
        expect(callListSessions(socket, { sid: 's1' })).toEqual({ ok: false, reason: 'handler-misconfigured' })
    })

    test('无匹配会话 → ack ok:true 带空数组（真实空态，不是故障）', () => {
        const socket = makeFakeSocket()
        const { deps } = makeDeps({ sessions: [] })
        register(socket, deps)

        expect(callListSessions(socket, { sid: 's1' })).toEqual({ ok: true, sessions: [] })
    })
})

/** 触发 createSessionForAgent 并等 ack。handler 是 async 的（要等 spawn），
 *  所以用 Promise 等回执而不是同步取——同步取会永远拿到 undefined。 */
function callCreateSession(socket: ReturnType<typeof makeFakeSocket>, payload: unknown): Promise<AgentCreateSessionAck> {
    return new Promise((resolve) => {
        socket.emit('createSessionForAgent', payload, (a: AgentCreateSessionAck) => resolve(a))
    })
}

describe('createSessionForAgent handler', () => {
    test('正常请求 → ack ok:true 带回 sessionId', async () => {
        const socket = makeFakeSocket()
        const { deps } = makeDeps({ createResult: { ok: true, sessionId: 's-new' } })
        register(socket, deps)

        expect(await callCreateSession(socket, { sid: 's1', machineId: 'm1', directory: '/work/app' }))
            .toEqual({ ok: true, sessionId: 's-new' })
    })

    test('入参逐项透传给服务，且 sid 不混进业务入参', async () => {
        const socket = makeFakeSocket()
        const { deps, seenCreateInputs } = makeDeps()
        register(socket, deps)

        await callCreateSession(socket, {
            sid: 's1',
            machineId: 'm1',
            directory: '/work/app',
            projectId: 'p1',
            model: 'opus',
            effort: 'high',
            permissionMode: 'plan',
        })

        // sid 是发给 Hub 的寻址信息，不是建会话的参数——混进去会变成服务看不懂的字段
        expect(seenCreateInputs).toEqual([{
            machineId: 'm1',
            directory: '/work/app',
            projectId: 'p1',
            model: 'opus',
            effort: 'high',
            permissionMode: 'plan',
        }])
    })

    test('namespace 取自鉴权会话而非入参', async () => {
        const socket = makeFakeSocket()
        const { deps, seenNamespaces } = makeDeps()
        deps.resolveSessionAccess = (sid: string) => ({
            ok: true as const,
            value: makeStoredSession(`authoritative-${sid}`, 'ns-from-session'),
        })
        register(socket, deps)

        await callCreateSession(socket, { sid: 's1', machineId: 'm1', directory: '/work/app' })

        expect(seenNamespaces).toEqual(['ns-from-session'])
    })

    test('非法 payload（缺 machineId / directory 为空 / effort 越界）→ 拒绝且不调服务', async () => {
        const socket = makeFakeSocket()
        const { deps, seenCreateInputs } = makeDeps()
        register(socket, deps)

        // 空串会一路走到 spawn 才炸（runner 报 "Directory is required"），在这里挡下来更清楚
        const missing = await callCreateSession(socket, { sid: 's1', directory: '/work/app' })
        const blank = await callCreateSession(socket, { sid: 's1', machineId: 'm1', directory: '' })
        const badEffort = await callCreateSession(socket, { sid: 's1', machineId: 'm1', directory: '/d', effort: 'max' })

        expect(missing.ok).toBe(false)
        expect(blank.ok).toBe(false)
        expect(badEffort.ok).toBe(false)
        expect(seenCreateInputs).toHaveLength(0)
    })

    test('会话访问被拒 → 拒绝且不调服务', async () => {
        const socket = makeFakeSocket()
        const { deps, seenCreateInputs } = makeDeps()
        deps.resolveSessionAccess = () => ({ ok: false as const, reason: 'access-denied' })
        register(socket, deps)

        expect((await callCreateSession(socket, { sid: 's1', machineId: 'm1', directory: '/d' })).ok).toBe(false)
        expect(seenCreateInputs).toHaveLength(0)
    })

    test('createSession 未装配 → 拒绝且明说这是 mobi 的问题，别让 agent 反复改入参重试', async () => {
        const socket = makeFakeSocket()
        const { deps } = makeDeps()
        delete deps.createSession
        register(socket, deps)

        const answer = await callCreateSession(socket, { sid: 's1', machineId: 'm1', directory: '/d' })

        expect(answer.ok).toBe(false)
        expect(answer.ok ? '' : answer.error).toContain('do not retry')
    })

    test('服务给的失败文案原样回给 CLI（翻译只发生在服务一处）', async () => {
        const socket = makeFakeSocket()
        const { deps } = makeDeps({ createResult: { ok: false, error: 'No online machine with id "m1".' } })
        register(socket, deps)

        expect(await callCreateSession(socket, { sid: 's1', machineId: 'm1', directory: '/d' }))
            .toEqual({ ok: false, error: 'No online machine with id "m1".' })
    })
})
