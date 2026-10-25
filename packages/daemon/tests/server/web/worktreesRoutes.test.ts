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
 * worktree 列表 HTTP 路由（bun 运行器：Store 依赖 bun:sqlite）：授权与扫描画像。
 * 真 git 仓库 + 真 worktree，断言外部行为。
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Server } from 'socket.io'
import { SyncEngine } from '../../../src/sync/syncEngine'
import { Store } from '../../../src/store'
import type { RpcRegistry } from '../../../src/socket/rpcRegistry'
import type { SSEManager } from '../../../src/sse/sseManager'
import { clearWorktreeStatusCache } from '../../../src/worktree/status'
import { setupTestApp, getAuthToken } from '../helpers/setupTestApp'
import { createTempRepo, type TempRepo } from '../../worktree/testRepo'

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path)
        return true
    } catch {
        return false
    }
}

describe('worktree 生命周期 REST 路由', () => {
    let temp: TempRepo
    let store: Store
    let engine: SyncEngine
    let app: ReturnType<typeof import('../../../src/web/server').createWebApp>
    let cleanup: () => void
    let headers: Record<string, string>

    beforeEach(async () => {
        clearWorktreeStatusCache()
        temp = await createTempRepo()
        store = new Store(':memory:')
        const io = { of() { return { sockets: new Map() } } } as unknown as Server
        const registry = { getSocketIdForMethod() { return null } } as unknown as RpcRegistry
        const sseManager = { broadcast: () => {} } as unknown as SSEManager
        engine = new SyncEngine(store, io, registry, sseManager)
        const setup = await setupTestApp(engine, { store })
        app = setup.app
        cleanup = setup.cleanup
        const token = await getAuthToken(app)
        headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        store.workspaces.createWorkspace({
            namespace: 'default',
            name: 'ws',
            folders: [{ path: temp.repo, primary: true }]
        })
    })

    afterEach(async () => {
        clearWorktreeStatusCache()
        engine.stop()
        cleanup()
        await temp.cleanup()
    })

    function insertSession(worktree: { name: string; worktreePath: string }) {
        return store.sessions.getOrCreateSession(
            `tag-${worktree.name}`,
            {
                path: temp.repo,
                host: 'test-host',
                worktree: {
                    basePath: temp.repo,
                    branch: `mobi-${worktree.name}`,
                    name: worktree.name,
                    worktreePath: worktree.worktreePath,
                    createdAt: Date.now()
                }
            },
            null,
            'default',
            undefined,
            null
        )
    }

    test('未授权 → 401', async () => {
        const res = await app.request('/api/worktrees')
        expect(res.status).toBe(401)
    })

    test('GET /api/worktrees 返回扫描画像', async () => {
        const worktreePath = await temp.addWorktree('scan')
        await writeFile(join(worktreePath, 'dirty.txt'), 'x\n')

        const res = await app.request('/api/worktrees', { headers })
        expect(res.status).toBe(200)
        const body = await res.json() as { worktrees: Array<Record<string, unknown>> }
        expect(body.worktrees).toHaveLength(1)
        expect(body.worktrees[0]).toMatchObject({
            name: 'scan',
            branch: 'mobi-scan',
            worktreePath,
            state: 'dirty',
            dirtyFileCount: 1
        })
    })
})
