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

import type { ContextUsage, EffortLevel, GoalStatus, PermissionMode } from '@mobi/shared/types'
import type { Store, StoredMachine, StoredSession } from '../../../store'
import type { RpcRegistry } from '../../rpcRegistry'
import type { SyncEvent } from '../../../sync/syncEngine'
import type { BackgroundTaskTracker } from '../../../sync/backgroundTaskTracker'
import type { RewindDeleteBoundTracker } from '../../../sync/rewindDeleteBoundTracker'
import type { TerminalRegistry } from '../../terminalRegistry'
import type { CliSocketWithData, SocketServer } from '../../socketTypes'
import type { AccessErrorReason, AccessResult } from './types'
import { registerMachineHandlers } from './machineHandlers'
import { registerRpcHandlers } from './rpcHandlers'
import { registerSessionHandlers } from './sessionHandlers'
import { cleanupTerminalHandlers, registerTerminalHandlers } from './terminalHandlers'

type SessionAlivePayload = {
    sid: string
    time: number
    running?: boolean
    mode?: 'local' | 'remote'
    permissionMode?: PermissionMode
    model?: string | null
    effort?: EffortLevel
    outputStyle?: string
}

type SessionEndPayload = {
    sid: string
    time: number
}

type MachineAlivePayload = {
    machineId: string
    time: number
}

export type ContextUsagePayload = {
    sid: string
    /** null 表示清空（/clear 后新会话从 0 开始） */
    contextUsage: ContextUsage | null
}

export type GoalStatusPayload = {
    sid: string
    /** null 表示清空（达成 10s 后 / 手动清理） */
    goalStatus: GoalStatus | null
}

export type RunStartedPayload = {
    sid: string
    /** 轮次起点（epoch ms，CLI running 翻转 false→true 时上报） */
    runStartedAt: number
}

export type CliHandlersDeps = {
    io: SocketServer
    store: Store
    rpcRegistry: RpcRegistry
    terminalRegistry: TerminalRegistry
    /** 活跃后台任务集合（CLI 事件维护，rewind API 闸门读取；与 web 路由层共用同一实例） */
    backgroundTaskTracker: BackgroundTaskTracker
    /** rewind 软删除上界（SyncEngine 受理时写；与 SyncEngine 共用同一实例） */
    rewindDeleteBoundTracker?: RewindDeleteBoundTracker
    onSessionAlive?: (payload: SessionAlivePayload) => void
    onSessionEnd?: (payload: SessionEndPayload) => void
    onMachineAlive?: (payload: MachineAlivePayload) => void
    /** CLI 事件驱动上报上下文用量 → 落库 runtimeState.contextUsage + SSE 推 */
    onContextUsage?: (payload: ContextUsagePayload) => void
    /** CLI 事件驱动上报 goal 状态 → 落库 runtimeState.goalStatus + SSE 推 */
    onGoalStatus?: (payload: GoalStatusPayload) => void
    /** CLI 轮次起点上报（running 翻转）→ 落库 runtimeState.runStartedAt + SSE 推 */
    onRunStarted?: (payload: RunStartedPayload) => void
    onWebappEvent?: (event: SyncEvent) => void
}

export function registerCliHandlers(socket: CliSocketWithData, deps: CliHandlersDeps): void {
    const { io, store, rpcRegistry, terminalRegistry, backgroundTaskTracker, rewindDeleteBoundTracker, onSessionAlive, onSessionEnd, onMachineAlive, onContextUsage, onGoalStatus, onRunStarted, onWebappEvent } = deps
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
    if (sessionId && resolveSessionAccess(sessionId).ok) {
        socket.join(`session:${sessionId}`)
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
        rewindDeleteBoundTracker,
        onSessionAlive,
        onSessionEnd,
        onContextUsage,
        onGoalStatus,
        onRunStarted,
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

    socket.on('ping', (callback: () => void) => {
        callback()
    })

    socket.on('disconnect', () => {
        rpcRegistry.unregisterAll(socket)
        cleanupTerminalHandlers(socket, { terminalRegistry, terminalNamespace })
    })
}
