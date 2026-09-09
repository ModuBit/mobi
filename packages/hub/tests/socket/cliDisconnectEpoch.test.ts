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
import { registerCliHandlers } from '../../src/socket/handlers/cli'
import type { CliHandlersDeps } from '../../src/socket/handlers/cli'
import { SnapshotDeltaAssembler } from '../../src/sync/snapshotDeltaAssembler'
import { SnapshotDeltaForwarder } from '../../src/sse/snapshotDeltaForwarder'
import { textEnvelope } from '../helpers/snapshotDelta'
import type { StoredSession } from '../../src/store/types'

/**
 * A1 迟到 disconnect 竞态（code-review）：CLI 快速重连后，旧 socket 的 disconnect
 * （engine.io pingTimeout 滞后数十秒）不得清掉新连接刚 forceFull 重建的 snapshot 缓存。
 * 断言外部行为：竞态后 delta 链仍衔接（流不冻死）。
 */

function makeStoredSession(sid: string): StoredSession {
    return {
        id: sid, tag: null, namespace: 'default', machineId: null,
        createdAt: 1, updatedAt: 1, metadata: null, metadataVersion: 0,
        agentState: null, agentStateVersion: 0, runtimeState: null,
        runtimeStateUpdatedAt: null, projectId: null, pinned: false, seq: 1,
    }
}

function makeDeps(assembler: SnapshotDeltaAssembler) {
    return {
        io: { of: () => ({ sockets: new Map() }) } as unknown as CliHandlersDeps['io'],
        // resolveSessionAccess 在 registerCliHandlers 内部从 store 构建（namespace 过滤），stub store 层
        store: {
            sessions: {
                getSessionByNamespace: (sid: string) => makeStoredSession(sid),
                getSession: () => null,
            },
            machines: { getMachineByNamespace: () => null, getMachine: () => null },
        } as unknown as CliHandlersDeps['store'],
        rpcRegistry: { unregisterAll: () => {} } as unknown as CliHandlersDeps['rpcRegistry'],
        terminalRegistry: { removeByCliSocket: () => [] } as unknown as CliHandlersDeps['terminalRegistry'],
        backgroundTaskTracker: {} as CliHandlersDeps['backgroundTaskTracker'],
        snapshotAssembler: assembler,
        snapshotForwarder: new SnapshotDeltaForwarder(assembler),
        sessionSocketIds: new Map<string, string>(),
        onWebappEvent: () => {},
    } as CliHandlersDeps
}

/** 最小 fake socket：记录事件 handler，供测试手动触发 disconnect / 发帧 */
function makeFakeSocket(id: string, sessionId: string | null) {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    return {
        id,
        data: { namespace: 'default' },
        handshake: { auth: sessionId ? { sessionId } : {} },
        join() {},
        on(event: string, handler: (...args: unknown[]) => void) { handlers.set(event, handler) },
        emit(event: string, ...args: unknown[]) { handlers.get(event)?.(...args) },
    }
}

describe('A1：迟到 disconnect 竞态——sessionSocketIds epoch 守卫', () => {
    test('旧 socket 迟到的 disconnect 不清新连接重建的缓存（delta 链不冻死）', () => {
        const assembler = new SnapshotDeltaAssembler()
        const deps = makeDeps(assembler)

        // 旧连接：建链 rev=1
        const oldSocket = makeFakeSocket('sock-old', 's1')
        registerCliHandlers(oldSocket as never, deps)
        assembler.applyFull('s1', 'u1', textEnvelope('a'), 1)

        // 快速重连：新 socket 接管会话（sessionSocketIds 指向新 id），forceFull 重建 rev=2
        const newSocket = makeFakeSocket('sock-new', 's1')
        registerCliHandlers(newSocket as never, deps)
        assembler.applyFull('s1', 'u1', textEnvelope('ab'), 2)

        // 旧 socket 迟到 disconnect：不得清理（否则后续 delta 全丢、流式冻死）
        oldSocket.emit('disconnect')

        // 缓存仍健在：衔接 rev=2 的增量可被接受（流不冻死）
        const kept = assembler.getActiveEntries('s1').find(e => e.localId === 'u1')
        expect(kept).toBeDefined()
        expect(kept!.rev).toBe(2)
    })

    test('当前持有者的 disconnect 正常清会话缓存（流已断，缓存必过期）', () => {
        const assembler = new SnapshotDeltaAssembler()
        const deps = makeDeps(assembler)

        const socket = makeFakeSocket('sock-1', 's1')
        registerCliHandlers(socket as never, deps)
        assembler.applyFull('s1', 'u1', textEnvelope('a'), 1)

        socket.emit('disconnect')
        expect(assembler.getActiveEntries('s1')).toHaveLength(0)
    })

    test('非会话 socket（无 sessionId）disconnect 不影响任何缓存', () => {
        const assembler = new SnapshotDeltaAssembler()
        const deps = makeDeps(assembler)
        assembler.applyFull('s1', 'u1', textEnvelope('a'), 1)

        const plain = makeFakeSocket('sock-x', null)
        registerCliHandlers(plain as never, deps)
        plain.emit('disconnect')
        expect(assembler.getActiveEntries('s1')).toHaveLength(1)
    })
})
