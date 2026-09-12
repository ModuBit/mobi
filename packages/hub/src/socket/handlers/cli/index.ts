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

import type { Store, StoredMachine, StoredSession } from '../../../store'
import type { AgentCreateSessionAck, AgentMachineSummary, AgentSessionSummary } from '@mobi/shared'
import type { RpcRegistry } from '../../rpcRegistry'
import type { SyncEvent } from '../../../sync/syncEngine'
import type { BackgroundTaskTracker } from '../../../sync/backgroundTaskTracker'
import type { RewindDeleteBoundTracker } from '../../../sync/rewindDeleteBoundTracker'
import type { SessionFactsSink } from '../../../sync/sessionFacts'
import type { AgentCreateSessionInput, AgentSessionQuery } from '../../../sync/agentSessionService'
import type { SnapshotCliLease, SnapshotSync } from '../../../sync/snapshotSync'
import type { TerminalRegistry } from '../../terminalRegistry'
import type { CliSocketWithData, SocketServer } from '../../socketTypes'
import type { AccessErrorReason, AccessResult } from './types'
import { registerMachineHandlers } from './machineHandlers'
import { registerUiCommandHandlers } from './uiCommandHandlers'
import { registerAgentSessionHandlers } from './agentSessionHandlers'
import { registerRpcHandlers } from './rpcHandlers'
import { registerSessionHandlers } from './sessionHandlers'
import { cleanupTerminalHandlers, registerTerminalHandlers } from './terminalHandlers'

type MachineAlivePayload = {
    machineId: string
    time: number
}

export type CliHandlersDeps = {
    io: SocketServer
    store: Store
    rpcRegistry: RpcRegistry
    terminalRegistry: TerminalRegistry
    /** 活跃后台任务集合（CLI 事件维护，rewind API 闸门读取；与 web 路由层共用同一实例） */
    backgroundTaskTracker: BackgroundTaskTracker
    /** 快照同步 module：统一拥有缓存、CLI lease 与订阅游标。 */
    snapshotSync: SnapshotSync
    /** rewind 软删除上界（SyncEngine 受理时写；与 SyncEngine 共用同一实例） */
    rewindDeleteBoundTracker?: RewindDeleteBoundTracker
    /** 机器心跳（机器级事实，经 machineHandlers 更新在线状态；不属于会话事实 sink） */
    onMachineAlive?: (payload: MachineAlivePayload) => void
    /** Web SSE 在线检查（ui-command 离线静默判定；hidden 后台 tab 也算在线） */
    hasActiveSseConnection?: (namespace: string) => boolean
    /** ui-command SyncEvent 发布（经 EventPublisher 盖章 namespace 并 SSE 广播） */
    publishUiCommand?: (event: Extract<SyncEvent, { type: 'ui-command' }>) => void
    /** Agent 会话操作：列可派活的在线机器（AgentSessionService.listMachines）。
     *  缺装配时 handler 回 handler-misconfigured，不静默返回空清单 */
    listOnlineMachinesForAgent?: (namespace: string) => AgentMachineSummary[]
    /** Agent 会话操作：列可派活的会话（AgentSessionService.listSessions）。同上守卫 */
    listSessionsForAgent?: (namespace: string, query: AgentSessionQuery) => AgentSessionSummary[]
    /** Agent 会话操作：在某台机器上起新会话（AgentSessionService.createSession）。同上守卫 */
    createSessionForAgent?: (namespace: string, input: AgentCreateSessionInput) => Promise<AgentCreateSessionAck>
    /** 会话事实上报落库入口（深化候选③：单一声明源 sync/sessionFacts.ts） */
    factsSink?: SessionFactsSink
    onWebappEvent?: (event: SyncEvent) => void
}

export function registerCliHandlers(socket: CliSocketWithData, deps: CliHandlersDeps): void {
    const { io, store, rpcRegistry, terminalRegistry, backgroundTaskTracker, snapshotSync, rewindDeleteBoundTracker, onMachineAlive, factsSink, onWebappEvent, hasActiveSseConnection, publishUiCommand, listOnlineMachinesForAgent, listSessionsForAgent, createSessionForAgent } = deps
    const terminalNamespace = io.of('/terminal')
    const namespace = typeof socket.data.namespace === 'string' ? socket.data.namespace : null

    const resolveSessionAccess = (sessionId: string): AccessResult<StoredSession> => {
        if (!namespace) {
            return { ok: false, reason: 'namespace-missing' }
        }
        const session = store.sessions.getSessionByNamespace(sessionId, namespace)
        if (session) {
            return { ok: true, value: session }
        }
        if (store.sessions.getSession(sessionId)) {
            return { ok: false, reason: 'access-denied' }
        }
        return { ok: false, reason: 'not-found' }
    }

    const resolveMachineAccess = (machineId: string): AccessResult<StoredMachine> => {
        if (!namespace) {
            return { ok: false, reason: 'namespace-missing' }
        }
        const machine = store.machines.getMachineByNamespace(machineId, namespace)
        if (machine) {
            return { ok: true, value: machine }
        }
        if (store.machines.getMachine(machineId)) {
            return { ok: false, reason: 'access-denied' }
        }
        return { ok: false, reason: 'not-found' }
    }

    const auth = socket.handshake.auth as Record<string, unknown> | undefined
    const sessionId = typeof auth?.sessionId === 'string' ? auth.sessionId : null
    let snapshotLease: SnapshotCliLease | null = null
    if (sessionId && resolveSessionAccess(sessionId).ok) {
        socket.join(`session:${sessionId}`)
        snapshotLease = snapshotSync.attachCli(sessionId)
    }

    const machineId = typeof auth?.machineId === 'string' ? auth.machineId : null
    if (machineId && resolveMachineAccess(machineId).ok) {
        socket.join(`machine:${machineId}`)
    }

    const emitAccessError = (scope: 'session' | 'machine', id: string, reason: AccessErrorReason) => {
        const message = reason === 'access-denied'
            ? `${scope} access denied`
            : reason === 'not-found'
                ? `${scope} not found`
                : 'Namespace missing'
        socket.emit('error', { message, code: reason, scope, id })
    }

    registerRpcHandlers(socket, rpcRegistry)
    registerSessionHandlers(socket, {
        store,
        resolveSessionAccess,
        emitAccessError,
        backgroundTaskTracker,
        snapshotSync,
        rewindDeleteBoundTracker,
        factsSink,
        onWebappEvent
    })
    registerMachineHandlers(socket, {
        store,
        resolveMachineAccess,
        emitAccessError,
        onMachineAlive,
        onWebappEvent
    })
    registerTerminalHandlers(socket, {
        terminalRegistry,
        terminalNamespace,
        resolveSessionAccess,
        emitAccessError
    })
    registerUiCommandHandlers(socket, {
        resolveSessionAccess,
        hasActiveSseConnection: hasActiveSseConnection ?? (() => false),
        publishUiCommand
    })
    registerAgentSessionHandlers(socket, {
        resolveSessionAccess,
        listOnlineMachines: listOnlineMachinesForAgent,
        listSessions: listSessionsForAgent,
        createSession: createSessionForAgent
    })

    socket.on('ping', (callback: () => void) => {
        callback()
    })

    socket.on('disconnect', () => {
        rpcRegistry.unregisterAll(socket)
        cleanupTerminalHandlers(socket, { terminalRegistry, terminalNamespace })
        // lease 内部校验当前持有者，旧连接迟到 disconnect 不会清掉新连接的基线。
        snapshotLease?.disconnect()
    })
}
