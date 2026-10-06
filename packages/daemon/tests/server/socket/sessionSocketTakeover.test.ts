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
import { registerCliHandlers } from '../../../src/socket/handlers/cli'
import type { CliHandlersDeps } from '../../../src/socket/handlers/cli'
import { SessionSocketOwners } from '../../../src/socket/sessionSocketOwners'
import { RpcRegistry } from '../../../src/socket/rpcRegistry'
import { SnapshotSync } from '../../../src/sync/snapshotSync'

/**
 * 同 session 的 CLI socket 接管仲裁（2026-09-30 事故的根因修复）：
 * hub 重启后旧 CLI 重连与唤醒新 CLI 短暂并存，RpcRegistry 后写覆盖把方法映射判给
 * 后到者；先到者此后断开时 unregisterAll 连根拔掉唯一有效注册——幸存的 CLI 对所有
 * 会话 RPC 不可达，web 端彻底失去对 Claude Code 进程的管理。
 *
 * 仲裁规则：同一 session 的新连接接管（挤掉旧连接），保证任意时刻持有方法映射的
 * 连接与活跃连接唯一。被踢方迟到的 unregisterAll 由 RpcRegistry 的持有者守卫挡住。
 */

function makeFakeSocket(id: string, sessionId: string | null) {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    return {
        id,
        kicks: 0,
        data: { namespace: 'default' },
        handshake: { auth: sessionId ? { sessionId } : {} },
        join() {},
        on(event: string, handler: (...args: unknown[]) => void) { handlers.set(event, handler) },
        emit(event: string, ...args: unknown[]) { handlers.get(event)?.(...args) },
        disconnect(_close?: boolean) { this.kicks++ },
    }
}

function makeDeps(opts: {
    owners: SessionSocketOwners
    registry: RpcRegistry
    sockets: Map<string, unknown>
}) {
    return {
        io: { of: () => ({ sockets: opts.sockets }) } as unknown as CliHandlersDeps['io'],
        store: {
            sessions: {
                getSessionByNamespace: (sid: string) => ({
                    id: sid, tag: null, namespace: 'default',
                    createdAt: 1, updatedAt: 1, metadata: null, metadataVersion: 0,
                    agentState: null, agentStateVersion: 0, runtimeState: null,
                    runtimeStateUpdatedAt: null, workspaceId: null, pinned: false, seq: 1,
                }),
                getSession: () => null,
            },
            machines: { getMachineByNamespace: () => null, getMachine: () => null },
        } as unknown as CliHandlersDeps['store'],
        rpcRegistry: opts.registry,
        backgroundTaskTracker: {} as CliHandlersDeps['backgroundTaskTracker'],
        snapshotSync: new SnapshotSync(),
        onWebappEvent: () => {},
        sessionSocketOwners: opts.owners,
    } as CliHandlersDeps
}

describe('session CLI socket 接管仲裁', () => {
    test('同 session 第二条连接接管：旧连接被踢；旧方迟到的 disconnect 不清掉新注册', () => {
        const owners = new SessionSocketOwners()
        const registry = new RpcRegistry()
        const sockets = new Map<string, unknown>()
        const deps = makeDeps({ owners, registry, sockets })

        const oldSocket = makeFakeSocket('sock-old', 's1')
        sockets.set('sock-old', oldSocket)
        registerCliHandlers(oldSocket as never, deps)
        oldSocket.emit('rpc-register', { method: 's1:killSession' })
        expect(registry.getSocketIdForMethod('s1:killSession')).toBe('sock-old')

        // 新连接接管：旧连接被立即踢
        const newSocket = makeFakeSocket('sock-new', 's1')
        sockets.set('sock-new', newSocket)
        registerCliHandlers(newSocket as never, deps)
        expect(oldSocket.kicks).toBe(1)

        // 新连接重发注册，覆盖映射
        newSocket.emit('rpc-register', { method: 's1:killSession' })
        expect(registry.getSocketIdForMethod('s1:killSession')).toBe('sock-new')

        // 事故根因断言：被踢方迟到的 disconnect（engine.io pingTimeout 滞后）不得
        // 清掉新连接的注册——否则幸存 CLI 从此对所有会话 RPC 不可达
        oldSocket.emit('disconnect')
        expect(registry.getSocketIdForMethod('s1:killSession')).toBe('sock-new')
    })

    test('持有者自身断开 → 注册正常清理，owner 表释放', () => {
        const owners = new SessionSocketOwners()
        const registry = new RpcRegistry()
        const sockets = new Map<string, unknown>()
        const deps = makeDeps({ owners, registry, sockets })

        const socket = makeFakeSocket('sock-1', 's1')
        sockets.set('sock-1', socket)
        registerCliHandlers(socket as never, deps)
        socket.emit('rpc-register', { method: 's1:killSession' })
        expect(registry.getSocketIdForMethod('s1:killSession')).toBe('sock-1')

        socket.emit('disconnect')
        expect(registry.getSocketIdForMethod('s1:killSession')).toBeNull()
        // 释放后再次连接不误踢：takeOver 返回 null
        expect(owners.takeOver('s1', 'sock-2')).toBeNull()
    })

    test('无 sessionId 的连接不参与接管', () => {
        const owners = new SessionSocketOwners()
        const registry = new RpcRegistry()
        const sockets = new Map<string, unknown>()
        const deps = makeDeps({ owners, registry, sockets })

        const socket = makeFakeSocket('sock-1', null)
        sockets.set('sock-1', socket)
        expect(() => registerCliHandlers(socket as never, deps)).not.toThrow()
    })
})
