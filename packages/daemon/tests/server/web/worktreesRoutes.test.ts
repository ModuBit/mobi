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
 * worktree 生命周期 HTTP 路由（bun 运行器：Store 依赖 bun:sqlite）：授权、body
 * schema 校验、转发断言，以及 DELETE /sessions/:id 的「worktree 已保留」事实。
 * 真 git 仓库 + 真 worktree，断言外部行为。
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Server } from 'socket.io'
import { SyncEngine } from '../../../src/sync/syncEngine'
import { Store } from '../../../src/store'
import type { RpcRegistry } from '../../../src/socket/rpcRegistry'
import type { SSEManager } from '../../../src/sse/sseManager'
import { clearWorktreeStatusCache } from '../../../src/worktree/status'
import { setupTestApp, getAuthToken } from '../helpers/setupTestApp'
import { createTempRepo, git, type TempRepo } from '../../worktree/testRepo'

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

    test('POST merge-back：body 非法 → 400；路径不符约定 → 200 + invalid-worktree', async () => {
        const badBody = await app.request('/api/worktrees/merge-back', {
            method: 'POST',
            headers,
            body: JSON.stringify({ strategy: 'bogus' })
        })
        expect(badBody.status).toBe(400)

        const res = await app.request('/api/worktrees/merge-back', {
            method: 'POST',
            headers,
            body: JSON.stringify({ worktreePath: join(temp.dir, 'nope') })
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ ok: false, reason: 'invalid-worktree' })
    })

    test('POST merge-back：合回成功并把内容落入主仓库', async () => {
        const worktreePath = await temp.addWorktree('feature')
        await writeFile(join(worktreePath, 'feature.txt'), 'done\n')

        const res = await app.request('/api/worktrees/merge-back', {
            method: 'POST',
            headers,
            body: JSON.stringify({ worktreePath })
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ ok: true, worktreeRemoved: true, branchDeleted: true })
        expect(await readFile(join(temp.repo, 'feature.txt'), 'utf8')).toBe('done\n')
        expect(await exists(worktreePath)).toBe(false)
    })

    test('POST discard：连根删除 worktree 与分支', async () => {
        const worktreePath = await temp.addWorktree('trash')
        await writeFile(join(worktreePath, 'uncommitted.txt'), 'bye\n')

        const res = await app.request('/api/worktrees/discard', {
            method: 'POST',
            headers,
            body: JSON.stringify({ worktreePath })
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ ok: true, worktreeRemoved: true, branchDeleted: true })
        expect(await exists(worktreePath)).toBe(false)
        expect((await git(temp.repo, ['branch', '--list', 'mobi-trash'])).trim()).toBe('')
    })

    test('DELETE /sessions/:id：脏 worktree 保留并在响应带回保留事实', async () => {
        const worktreePath = await temp.addWorktree('kept')
        await writeFile(join(worktreePath, 'left.txt'), 'todo\n')
        const session = insertSession({ name: 'kept', worktreePath })

        const res = await app.request(`/api/sessions/${session.id}`, { method: 'DELETE', headers })

        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({
            ok: true,
            retainedWorktree: {
                name: 'kept',
                branch: 'mobi-kept',
                worktreePath,
                state: 'dirty',
                dirtyFileCount: 1
            }
        })
        expect(await exists(worktreePath)).toBe(true)
    })

    test('DELETE /sessions/:id：干净 worktree 自动清理且响应无保留事实', async () => {
        const worktreePath = await temp.addWorktree('idle')
        const session = insertSession({ name: 'idle', worktreePath })

        const res = await app.request(`/api/sessions/${session.id}`, { method: 'DELETE', headers })

        expect(res.status).toBe(200)
        const body = await res.json() as { ok: boolean; retainedWorktree?: unknown }
        expect(body).toEqual({ ok: true })
        expect(body.retainedWorktree).toBeUndefined()
        expect(await exists(worktreePath)).toBe(false)
        expect((await git(temp.repo, ['branch', '--list', 'mobi-idle'])).trim()).toBe('')
    })

    test('非 worktree 会话删除：零行为变化，响应无保留事实', async () => {
        const session = store.sessions.getOrCreateSession(
            'tag-plain',
            { path: temp.repo, host: 'test-host' },
            null,
            'default',
            undefined,
            null
        )

        const res = await app.request(`/api/sessions/${session.id}`, { method: 'DELETE', headers })

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ ok: true })
        // 主仓库不受影响
        expect(await exists(temp.repo)).toBe(true)
    })
})
