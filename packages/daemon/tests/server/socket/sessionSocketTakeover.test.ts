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
    onCliAttached?: (sessionId: string) => void
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
        onCliAttached: opts.onCliAttached,
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

describe('CLI 附着补投（onCliAttached）', () => {
    test('连接进房后触发一次；持有点在 takeOver 之后由持有者表可查', () => {
        const owners = new SessionSocketOwners()
        const registry = new RpcRegistry()
        const sockets = new Map<string, unknown>()
        const attached: Array<{ sessionId: string; owner: boolean }> = []
        const deps = makeDeps({
            owners,
            registry,
            sockets,
            // 回调时刻即「已附着」：持有者表必须已经记上，否则唤醒判据会误判为未附着
            onCliAttached: (sessionId) => { attached.push({ sessionId, owner: owners.has(sessionId) }) },
        })

        const socket = makeFakeSocket('sock-1', 's1')
        sockets.set('sock-1', socket)
        registerCliHandlers(socket as never, deps)

        expect(attached).toEqual([{ sessionId: 's1', owner: true }])
    })

    test('重连（新 socket 接管）再次触发；无 sessionId 不触发', () => {
        const owners = new SessionSocketOwners()
        const registry = new RpcRegistry()
        const sockets = new Map<string, unknown>()
        const attached: string[] = []
        const deps = makeDeps({ owners, registry, sockets, onCliAttached: (sid) => { attached.push(sid) } })

        const first = makeFakeSocket('sock-1', 's1')
        sockets.set('sock-1', first)
        registerCliHandlers(first as never, deps)

        const second = makeFakeSocket('sock-2', 's1')
        sockets.set('sock-2', second)
        registerCliHandlers(second as never, deps)

        const anonymous = makeFakeSocket('sock-3', null)
        sockets.set('sock-3', anonymous)
        registerCliHandlers(anonymous as never, deps)

        expect(attached).toEqual(['s1', 's1'])
    })

    test('持有者断开后附着事实作废（release 生效）', () => {
        const owners = new SessionSocketOwners()
        const socket = makeFakeSocket('sock-1', 's1')
        owners.takeOver('s1', socket.id)

        expect(owners.has('s1')).toBe(true)
        owners.release('s1', socket.id)
        expect(owners.has('s1')).toBe(false)
    })
})
