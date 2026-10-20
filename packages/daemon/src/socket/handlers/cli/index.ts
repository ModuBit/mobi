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

import type { Store, StoredSession } from '../../../store'
import type { RpcRegistry } from '../../rpcRegistry'
import type { SessionSocketOwners } from '../../sessionSocketOwners'
import type { SessionSocketCapabilities } from '../../capabilities'
import type { BackgroundTaskTracker } from '../../../sync/backgroundTaskTracker'
import type { RewindDeleteBoundTracker } from '../../../sync/rewindDeleteBoundTracker'
import type { SnapshotCliLease, SnapshotSync } from '../../../sync/snapshotSync'
import type { CliSocketWithData, SocketServer } from '../../socketTypes'
import type { AccessErrorReason, AccessResult } from './types'
import { registerUiCommandHandlers } from './uiCommandHandlers'
import { registerAgentSessionHandlers } from './agentSessionHandlers'
import { registerRpcHandlers } from './rpcHandlers'
import { registerSessionHandlers } from './sessionHandlers'

/** 连接级 CLI handler 的依赖：私有依赖（io/仲裁表/共享实例）+ 能力投影
 *  （能力签名单源 ../../capabilities.ts，架构评审候选⑥票①） */
export type CliHandlersDeps = {
    io: SocketServer
    store: Store
    rpcRegistry: RpcRegistry
    /** 活跃后台任务集合（CLI 事件维护，rewind API 闸门读取；与 web 路由层共用同一实例） */
    backgroundTaskTracker: BackgroundTaskTracker
    /** 快照同步 module：统一拥有缓存、CLI lease 与订阅游标。 */
    snapshotSync: SnapshotSync
    /** rewind 软删除上界（SyncEngine 受理时写；与 SyncEngine 共用同一实例） */
    rewindDeleteBoundTracker?: RewindDeleteBoundTracker
    /**
     * 同 session CLI socket 的接管仲裁表（单一持有者保证方法映射不悬空）。
     * 由 server.ts 组装传入；缺省（部分单测直接调 registerCliHandlers）时跳过仲裁。
     */
    sessionSocketOwners?: SessionSocketOwners
} & Partial<SessionSocketCapabilities>

export function registerCliHandlers(socket: CliSocketWithData, deps: CliHandlersDeps): void {
    const { io, store, rpcRegistry, sessionSocketOwners, backgroundTaskTracker, snapshotSync, rewindDeleteBoundTracker, factsSink, emitCliNewMessage, onWebappEvent, hasActiveSseConnection, publishUiCommand, agentSessions } = deps
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

    const auth = socket.handshake.auth as Record<string, unknown> | undefined
    const sessionId = typeof auth?.sessionId === 'string' ? auth.sessionId : null
    const sessionSlotClaimed = Boolean(sessionId && resolveSessionAccess(sessionId).ok)
    let snapshotLease: SnapshotCliLease | null = null
    if (sessionId && sessionSlotClaimed) {
        socket.join(`session:${sessionId}`)
        snapshotLease = snapshotSync.attachCli(sessionId)
        // 同 session 新连接接管、踢掉旧连接（类注释写明为什么要仲裁）：没有这一步，
        // 新旧连接并存时 RpcRegistry 的后写覆盖 + 旧方断开的 unregisterAll 会让
        // 幸存 CLI 的注册无声丢失，web 从此对它不可管控（2026-09-30 事故）
        const prevOwnerId = sessionSocketOwners?.takeOver(sessionId, socket.id) ?? null
        if (prevOwnerId) {
            io.of('/cli').sockets.get(prevOwnerId)?.disconnect(true)
        }
    }

    const emitAccessError = (scope: 'session', id: string, reason: AccessErrorReason) => {
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
        emitCliNewMessage,
        onWebappEvent
    })
    registerUiCommandHandlers(socket, {
        resolveSessionAccess,
        hasActiveSseConnection: hasActiveSseConnection ?? (() => false),
        publishUiCommand
    })
    registerAgentSessionHandlers(socket, { resolveSessionAccess, agentSessions })

    socket.on('ping', (callback: () => void) => {
        callback()
    })

    socket.on('disconnect', () => {
        if (sessionId && sessionSlotClaimed) {
            sessionSocketOwners?.release(sessionId, socket.id)
        }
        rpcRegistry.unregisterAll(socket)
        // lease 内部校验当前持有者，旧连接迟到 disconnect 不会清掉新连接的基线。
        snapshotLease?.disconnect()
    })
}
