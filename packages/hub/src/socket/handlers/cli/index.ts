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
import type { RpcRegistry } from '../../rpcRegistry'
import type { SyncEvent } from '../../../sync/syncEngine'
import type { BackgroundTaskTracker } from '../../../sync/backgroundTaskTracker'
import type { RewindDeleteBoundTracker } from '../../../sync/rewindDeleteBoundTracker'
import type { SessionFactsSink } from '../../../sync/sessionFacts'
import type { SnapshotDeltaAssembler } from '../../../sync/snapshotDeltaAssembler'
import type { SnapshotDeltaForwarder } from '../../../sse/snapshotDeltaForwarder'
import type { SnapshotDeltaStats } from '../../../sync/snapshotDeltaStats'
import type { TerminalRegistry } from '../../terminalRegistry'
import type { CliSocketWithData, SocketServer } from '../../socketTypes'
import type { AccessErrorReason, AccessResult } from './types'
import { registerMachineHandlers } from './machineHandlers'
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
    /** snapshot delta 拼接器（delta 协议票 01）：全量/增量帧重建全量缓存 */
    snapshotAssembler: SnapshotDeltaAssembler
    /** snapshot delta SSE 转发器（消息终态精确清游标；与 SSEManager 共用实例） */
    snapshotForwarder: SnapshotDeltaForwarder
    /** session → 当前持有 socket 的 epoch 表（共享实例）：迟到 disconnect 防误清 */
    sessionSocketIds: Map<string, string>
    /** snapshot 流量观测（票 03）：缺省关闭 */
    snapshotStats?: SnapshotDeltaStats
    /** rewind 软删除上界（SyncEngine 受理时写；与 SyncEngine 共用同一实例） */
    rewindDeleteBoundTracker?: RewindDeleteBoundTracker
    /** 机器心跳（机器级事实，经 machineHandlers 更新在线状态；不属于会话事实 sink） */
    onMachineAlive?: (payload: MachineAlivePayload) => void
    /** 会话事实上报落库入口（深化候选③：单一声明源 sync/sessionFacts.ts） */
    factsSink?: SessionFactsSink
    onWebappEvent?: (event: SyncEvent) => void
}

export function registerCliHandlers(socket: CliSocketWithData, deps: CliHandlersDeps): void {
    const { io, store, rpcRegistry, terminalRegistry, backgroundTaskTracker, snapshotAssembler, snapshotForwarder, sessionSocketIds, snapshotStats, rewindDeleteBoundTracker, onMachineAlive, factsSink, onWebappEvent } = deps
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
        // 记录该会话的当前 socket：CLI 快速重连（新 socket 先到）后，旧 socket 迟到的
        // disconnect（engine.io pingTimeout 可滞后数十秒）不再是会话的当前持有者，
        // 不得清掉新连接刚重建的 snapshot 缓存（否则后续 delta 全丢、流式冻死）
        sessionSocketIds.set(sessionId, socket.id)
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
        snapshotAssembler,
        snapshotForwarder,
        snapshotStats,
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

    socket.on('ping', (callback: () => void) => {
        callback()
    })

    socket.on('disconnect', () => {
        rpcRegistry.unregisterAll(socket)
        cleanupTerminalHandlers(socket, { terminalRegistry, terminalNamespace })
        // 会话连接断开：流已断，snapshot delta 缓存必过期（重连后 CLI 重发全量帧重建）。
        // 仅当本 socket 仍是该会话的当前持有者时清理——迟到的旧 socket disconnect
        // 不得清掉重连后新连接刚重建的缓存（A1 竞态）
        if (sessionId && sessionSocketIds.get(sessionId) === socket.id) {
            sessionSocketIds.delete(sessionId)
            snapshotAssembler.cleanupSession(sessionId)
        }
    })
}
