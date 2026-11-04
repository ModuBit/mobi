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

/**
 * engine.deleteSession 编排（session-retention 票 10）：删除语义的唯一编排点——
 * transcript 处置、worktree 处置（注入）、墓碑、快照清理全部收口 engine，
 * routes 只做传输语义。断言编排事实：处置顺序、retainedWorktree 透传、
 * worktree 处置失败不阻塞删除。
 */

import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Server } from 'socket.io'

import { Store } from '../../../src/store'
import { SyncEngine } from '../../../src/sync/syncEngine'
import { LocalExecutor } from '../../../src/executor/localExecutor'
import type { ExecutorBridge } from '../../../src/executor/lifecycle'
import type { RpcRegistry } from '../../../src/socket/rpcRegistry'
import type { SSEManager } from '../../../src/sse/sseManager'
import type { SessionWorktreeDisposal } from '../../../src/worktree/service'

function makeEngine(worktreeLifecycle?: SessionWorktreeDisposal): { engine: SyncEngine; store: Store; cwd: string; cleanup: () => void } {
    const store = new Store(':memory:')
    const io = {
        of() {
            return { sockets: new Map(), emit: () => {} }
        },
        emit: () => {},
    } as unknown as Server
    const registry = { getSocketIdForMethod: () => null } as unknown as RpcRegistry
    const sseManager = { broadcast: () => {} } as unknown as SSEManager
    const bridge = {
        spawnSession: async () => ({ type: 'success' as const, sessionId: 'spawned' }),
        stopSession: () => true,
        clearTurnSnapshots: async () => {},
    } as unknown as ExecutorBridge
    const engine = new SyncEngine(
        store, io, registry, sseManager, undefined,
        new LocalExecutor(() => bridge),
        worktreeLifecycle,
    )
    const cwd = mkdtempSync(join(tmpdir(), 'e2e-delete-'))
    const cleanup = () => rmSync(cwd, { recursive: true, force: true })
    return { engine, store, cwd, cleanup }
}

/** 造一个 inactive、带 worktree 元数据的会话行 */
function seedSession(store: Store, cwd: string) {
    const workspace = store.workspaces.createWorkspace({ namespace: 'default', name: 'W', folders: [{ path: cwd, primary: true }] })
    const session = store.sessions.getOrCreateSession(
        'tag-delete-1',
        {
            path: cwd,
            host: 'test',
            name: '保留期删除编排',
            nativeSessionId: 'native-does-not-exist',
            worktree: { worktreePath: '/tmp/wt/x', basePath: cwd, name: 'x', branch: 'mobi-x' },
        },
        {},
        'default',
        undefined,
        workspace.id,
    )
    // inactive：删除守卫只拦 active 行
    store.sessions.setSessionStatus(session.id, 'default', { status: 'dormant', at: Date.now() })
    return store.sessions.getSessionByNamespace(session.id, 'default')!
}

describe('SyncEngine.deleteSession 编排（票 10）', () => {
    const cleanups: Array<() => void> = []
    afterEach(() => { for (const fn of cleanups.reverse()) fn() })

    it('worktree 处置结果透传：retainedWorktree 进返回值', async () => {
        const disposeCalls: Array<{ id?: string }> = []
        const { engine, cwd, cleanup } = makeEngine({
            disposeAfterSessionDelete: async (session: { id?: string }) => {
                disposeCalls.push(session)
                return { retained: { name: 'x', branch: 'mobi-x', worktreePath: '/tmp/wt/x', state: 'dirty', dirtyFileCount: 2 } }
            },
        })
        cleanups.push(cleanup)
        const stored = seedSession(engine['store'] as Store, cwd)

        const result = await engine.deleteSession(stored.id)

        expect(result.transcriptDeleted).toBe(true)
        expect(result.retainedWorktree).toEqual({ name: 'x', branch: 'mobi-x', worktreePath: '/tmp/wt/x', state: 'dirty', dirtyFileCount: 2 })
        // 处置收到删除前的行身份（删后 store 无行可查）
        expect(disposeCalls[0]?.id).toBe(stored.id)
    })

    it('worktree 处置失败不阻塞删除：best-effort，返回无 retainedWorktree', async () => {
        const { engine, cwd, cleanup } = makeEngine({
            disposeAfterSessionDelete: async () => { throw new Error('git exploded') },
        })
        cleanups.push(cleanup)
        const stored = seedSession(engine['store'] as Store, cwd)

        const result = await engine.deleteSession(stored.id)

        expect(result.transcriptDeleted).toBe(true)
        expect(result.retainedWorktree).toBeUndefined()
        // 行确实删了
        expect(engine.getSession(stored.id)).toBeUndefined()
    })

    it('未注入时自建处置（真实服务形态）：无 worktree 会话零处置行为', async () => {
        const { engine, cwd, cleanup } = makeEngine()
        cleanups.push(cleanup)
        const store = engine['store'] as Store
        const workspace = store.workspaces.createWorkspace({ namespace: 'default', name: 'W', folders: [{ path: cwd, primary: true }] })
        const session = store.sessions.getOrCreateSession('tag-delete-2', { path: cwd, host: 'test', name: '无 worktree', nativeSessionId: 'native-does-not-exist-2' }, {}, 'default', undefined, workspace.id)
        store.sessions.setSessionStatus(session.id, 'default', { status: 'dormant', at: Date.now() })

        const result = await engine.deleteSession(session.id)
        expect(result.transcriptDeleted).toBe(true)
        expect(result.retainedWorktree).toBeUndefined()
    })
})
