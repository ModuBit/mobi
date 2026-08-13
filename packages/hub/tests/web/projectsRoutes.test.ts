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

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import type { Server } from 'socket.io'
import { SyncEngine } from '../../src/sync/syncEngine'
import { Store } from '../../src/store'
import type { RpcRegistry } from '../../src/socket/rpcRegistry'
import type { SSEManager } from '../../src/sse/sseManager'
import { setupTestApp, getAuthToken, testCliApiToken } from '../helpers/setupTestApp'

/** 构造真实 SyncEngine（内存 Store + 空 socket/SSE），路由集成测试用 */
function makeEngineHandle(): { engine: SyncEngine; cleanup: () => void } {
    const store = new Store(':memory:')
    const io = {
        of() { return { sockets: new Map() } },
    } as unknown as Server
    const registry = {
        getSocketIdForMethod() { return null },
    } as unknown as RpcRegistry
    const sseManager = { broadcast: () => {} } as unknown as SSEManager

    const engine = new SyncEngine(store, io, registry, sseManager)
    return {
        engine,
        cleanup: () => {
            engine.stop()
            store.close()
        },
    }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('projects REST 路由 + 会话归属', () => {
    let app: ReturnType<typeof import('../../src/web/server').createWebApp>
    let engine: SyncEngine
    let engineCleanup: () => void
    let appCleanup: () => void
    let authHeaders: Record<string, string>
    let cliHeaders: Record<string, string>

    beforeAll(async () => {
        const handle = makeEngineHandle()
        engine = handle.engine
        engineCleanup = handle.cleanup

        const setup = await setupTestApp(engine)
        app = setup.app
        appCleanup = setup.cleanup

        const token = await getAuthToken(app)
        authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        cliHeaders = { Authorization: `Bearer ${testCliApiToken}`, 'Content-Type': 'application/json' }
    })

    afterAll(() => {
        appCleanup()
        engineCleanup()
    })

    /** 经 API 创建项目，返回 project */
    async function createProject(input: { name: string; machineId: string; folders?: Array<{ path: string; primary: boolean }> }) {
        const res = await app.request('/api/projects', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
                name: input.name,
                machineId: input.machineId,
                folders: input.folders ?? [{ path: `/a/${input.name}`, primary: true }],
            }),
        })
        return { res, data: await res.json() as { project?: { id: string; name: string } } }
    }

    describe('POST /api/projects', () => {
        test('合法创建返回 { project }', async () => {
            const { res, data } = await createProject({ name: 'mobi', machineId: 'm1' })
            expect(res.status).toBe(200)
            expect(data.project?.name).toBe('mobi')
        })

        test('双 primary → 400', async () => {
            const res = await app.request('/api/projects', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    name: 'bad', machineId: 'm1',
                    folders: [{ path: '/a', primary: true }, { path: '/b', primary: true }],
                }),
            })
            expect(res.status).toBe(400)
        })
    })

    describe('GET /api/projects', () => {
        test('支持 ?machineId= 过滤', async () => {
            await createProject({ name: 'p-m1', machineId: 'm1' })
            await createProject({ name: 'p-m2', machineId: 'm2' })

            const res = await app.request('/api/projects?machineId=m1', { headers: authHeaders })
            expect(res.status).toBe(200)
            const data = await res.json() as { projects: Array<{ id: string; name: string; machineId: string }> }
            expect(data.projects.every(p => p.machineId === 'm1')).toBe(true)
            expect(data.projects.some(p => p.name === 'p-m1')).toBe(true)
            expect(data.projects.some(p => p.name === 'p-m2')).toBe(false)
        })
    })

    describe('GET/PATCH/DELETE /api/projects/:id', () => {
        test('GET 不存在 → 404；存在 → { project }', async () => {
            const missing = await app.request('/api/projects/nope', { headers: authHeaders })
            expect(missing.status).toBe(404)

            const { data } = await createProject({ name: 'get-me', machineId: 'm1' })
            const res = await app.request(`/api/projects/${data.project!.id}`, { headers: authHeaders })
            expect(res.status).toBe(200)
            const body = await res.json() as { project: { id: string } }
            expect(body.project.id).toBe(data.project!.id)
        })

        test('PATCH 改名；folders 非法 → 400', async () => {
            const { data } = await createProject({ name: 'rename-me', machineId: 'm1' })
            const res = await app.request(`/api/projects/${data.project!.id}`, {
                method: 'PATCH',
                headers: authHeaders,
                body: JSON.stringify({ name: 'renamed' }),
            })
            expect(res.status).toBe(200)
            const body = await res.json() as { project: { name: string } }
            expect(body.project.name).toBe('renamed')

            const bad = await app.request(`/api/projects/${data.project!.id}`, {
                method: 'PATCH',
                headers: authHeaders,
                body: JSON.stringify({ folders: [] }),
            })
            expect(bad.status).toBe(400)
        })

        test('DELETE 后名下会话进 unbound，项目 404', async () => {
            const { data } = await createProject({ name: 'del-me', machineId: 'mA' })
            const projectId = data.project!.id
            const session = engine.getOrCreateSession(
                'tag-del-1', { path: '/a', host: 'h', machineId: 'mA' }, null, 'default', undefined, undefined, projectId
            )

            const res = await app.request(`/api/projects/${projectId}`, {
                method: 'DELETE',
                headers: authHeaders,
            })
            expect(res.status).toBe(200)

            const gone = await app.request(`/api/projects/${projectId}`, { headers: authHeaders })
            expect(gone.status).toBe(404)

            const unbound = await app.request('/api/projects/sessions/unbound?limit=100', { headers: authHeaders })
            expect(unbound.status).toBe(200)
            const body = await unbound.json() as { sessions: Array<{ id: string }> }
            expect(body.sessions.some(s => s.id === session.id)).toBe(true)
        })
    })

    describe('PATCH /api/sessions/:id 归入项目', () => {
        test('machine 不匹配 → 400', async () => {
            const session = engine.getOrCreateSession(
                'tag-patch-1', { path: '/a', host: 'h', machineId: 'mA' }, null, 'default'
            )
            const { data } = await createProject({ name: 'on-mB', machineId: 'mB' })

            const res = await app.request(`/api/sessions/${session.id}`, {
                method: 'PATCH',
                headers: authHeaders,
                body: JSON.stringify({ projectId: data.project!.id }),
            })
            expect(res.status).toBe(400)
            expect(await res.json()).toMatchObject({ error: expect.stringContaining('machine') })
        })

        test('跨 namespace 项目 → 404', async () => {
            const session = engine.getOrCreateSession(
                'tag-patch-ns', { path: '/a', host: 'h', machineId: 'mA' }, null, 'default'
            )
            const other = engine.createProject('other', {
                machineId: 'mA', name: 'other-ns', folders: [{ path: '/o', primary: true }],
            })

            const res = await app.request(`/api/sessions/${session.id}`, {
                method: 'PATCH',
                headers: authHeaders,
                body: JSON.stringify({ projectId: other.id }),
            })
            expect(res.status).toBe(404)
        })

        test('会话机器未知（老数据）放行；同 machine → 200 且分组生效', async () => {
            // 老数据：metadata 无 machineId
            const legacy = engine.getOrCreateSession(
                'tag-patch-legacy', { path: '/a', host: 'h' }, null, 'default'
            )
            const { data } = await createProject({ name: 'legacy-ok', machineId: 'mB' })
            const legacyRes = await app.request(`/api/sessions/${legacy.id}`, {
                method: 'PATCH',
                headers: authHeaders,
                body: JSON.stringify({ projectId: data.project!.id }),
            })
            expect(legacyRes.status).toBe(200)

            // 同 machine 正常路径
            const session = engine.getOrCreateSession(
                'tag-patch-2', { path: '/a', host: 'h', machineId: 'mA' }, null, 'default'
            )
            const { data: projA } = await createProject({ name: 'on-mA', machineId: 'mA' })
            const res = await app.request(`/api/sessions/${session.id}`, {
                method: 'PATCH',
                headers: authHeaders,
                body: JSON.stringify({ projectId: projA.project!.id }),
            })
            expect(res.status).toBe(200)

            const list = await app.request(`/api/projects/${projA.project!.id}/sessions?limit=100`, { headers: authHeaders })
            expect(list.status).toBe(200)
            const body = await list.json() as { sessions: Array<{ id: string }> }
            expect(body.sessions.some(s => s.id === session.id)).toBe(true)
        })

        test('PATCH { projectId: null } 移回「最近」', async () => {
            const { data } = await createProject({ name: 'unassign', machineId: 'mA' })
            const session = engine.getOrCreateSession(
                'tag-patch-3', { path: '/a', host: 'h', machineId: 'mA' }, null, 'default', undefined, undefined, data.project!.id
            )

            const res = await app.request(`/api/sessions/${session.id}`, {
                method: 'PATCH',
                headers: authHeaders,
                body: JSON.stringify({ projectId: null }),
            })
            expect(res.status).toBe(200)

            const unbound = await app.request('/api/projects/sessions/unbound?limit=100', { headers: authHeaders })
            const body = await unbound.json() as { sessions: Array<{ id: string }> }
            expect(body.sessions.some(s => s.id === session.id)).toBe(true)
        })
    })

    describe('分页（limit/cursor）', () => {
        test('GET /api/projects/:id/sessions 分页', async () => {
            const { data } = await createProject({ name: 'paged', machineId: 'm1' })
            const projectId = data.project!.id
            const ids: string[] = []
            for (let i = 0; i < 3; i++) {
                const s = engine.getOrCreateSession(
                    `tag-page-${i}`, { path: '/a', host: 'h' }, null, 'default', undefined, undefined, projectId
                )
                ids.push(s.id)
                // 拉开 updatedAt，避免同毫秒游标漏行
                await sleep(5)
            }

            const page1 = await app.request(`/api/projects/${projectId}/sessions?limit=2`, { headers: authHeaders })
            expect(page1.status).toBe(200)
            const body1 = await page1.json() as { sessions: Array<{ id: string }>; nextCursor: number | null; hasMore: boolean; total: number }
            expect(body1.sessions).toHaveLength(2)
            expect(body1.hasMore).toBe(true)
            expect(body1.total).toBe(3)
            expect(body1.nextCursor).not.toBeNull()

            const page2 = await app.request(
                `/api/projects/${projectId}/sessions?limit=2&cursor=${body1.nextCursor}`,
                { headers: authHeaders },
            )
            expect(page2.status).toBe(200)
            const body2 = await page2.json() as { sessions: Array<{ id: string }>; hasMore: boolean; total: number }
            expect(body2.sessions).toHaveLength(1)
            expect(body2.hasMore).toBe(false)
            expect(body2.total).toBe(3)

            const gotIds = [...body1.sessions, ...body2.sessions].map(s => s.id)
            expect(gotIds.sort()).toEqual(ids.sort())
        })

        test('GET /api/projects/sessions/unbound 真的可达且分页', async () => {
            for (let i = 0; i < 3; i++) {
                engine.getOrCreateSession(`tag-unbound-${i}`, { path: '/x', host: 'h' }, null, 'default')
                await sleep(5)
            }

            const page1 = await app.request('/api/projects/sessions/unbound?limit=2', { headers: authHeaders })
            expect(page1.status).toBe(200)
            const body1 = await page1.json() as { sessions: unknown[]; nextCursor: number | null; hasMore: boolean; total: number }
            expect(body1.sessions).toHaveLength(2)
            expect(body1.hasMore).toBe(true)
            expect(body1.total).toBeGreaterThanOrEqual(3)

            const page2 = await app.request(`/api/projects/sessions/unbound?limit=100&cursor=${body1.nextCursor}`, { headers: authHeaders })
            expect(page2.status).toBe(200)
            const body2 = await page2.json() as { sessions: unknown[] }
            expect(body2.sessions.length).toBeGreaterThanOrEqual(1)
        })
    })

    describe('POST /cli/sessions 响应带 project', () => {
        test('带 projectId → 响应含 project 且 session.projectId 一致', async () => {
            const { data } = await createProject({ name: 'cli-proj', machineId: 'm1' })
            const res = await app.request('/cli/sessions', {
                method: 'POST',
                headers: cliHeaders,
                body: JSON.stringify({
                    tag: 'tag-cli-1',
                    metadata: { path: '/a/cli-proj', host: 'h' },
                    projectId: data.project!.id,
                }),
            })
            expect(res.status).toBe(200)
            const body = await res.json() as { session: { projectId?: string | null }; project: { id: string } | null }
            expect(body.session.projectId).toBe(data.project!.id)
            expect(body.project?.id).toBe(data.project!.id)
        })

        test('带非法 projectId → 404（校验前置，不落库）', async () => {
            const res = await app.request('/cli/sessions', {
                method: 'POST',
                headers: cliHeaders,
                body: JSON.stringify({
                    tag: 'tag-cli-bad-project',
                    metadata: { path: '/x', host: 'h' },
                    projectId: 'no-such-project',
                }),
            })
            expect(res.status).toBe(404)
            expect(await res.json()).toMatchObject({ error: 'Project not found' })
        })

        test('machine 不匹配 → 403 且不落库（幽灵会话回归）', async () => {
            const { data } = await createProject({ name: 'cli-ghost-proj', machineId: 'mA' })
            const res = await app.request('/cli/sessions', {
                method: 'POST',
                headers: cliHeaders,
                body: JSON.stringify({
                    tag: 'tag-cli-ghost',
                    // 关键：请求机器 mB ≠ 项目机器 mA——hub 应当场拒绝，不留绑定错误机器的空会话
                    metadata: { path: '/ghost/marker', host: 'h', machineId: 'mB' },
                    projectId: data.project!.id,
                }),
            })
            expect(res.status).toBe(403)
            expect(await res.json()).toMatchObject({ error: 'Project belongs to a different machine' })

            // 幽灵会话回归：项目名下不应出现任何会话
            const list = await app.request(`/api/projects/${data.project!.id}/sessions?limit=100`, { headers: authHeaders })
            expect(list.status).toBe(200)
            const body = await list.json() as { sessions: Array<{ id: string; metadata?: { path?: string } }> }
            expect(body.sessions.some(s => s.metadata?.path === '/ghost/marker')).toBe(false)
        })

        test('machine 匹配 → 200 正常创建', async () => {
            const { data } = await createProject({ name: 'cli-match-proj', machineId: 'mA' })
            const res = await app.request('/cli/sessions', {
                method: 'POST',
                headers: cliHeaders,
                body: JSON.stringify({
                    tag: 'tag-cli-match',
                    metadata: { path: '/a/cli-match', host: 'h', machineId: 'mA' },
                    projectId: data.project!.id,
                }),
            })
            expect(res.status).toBe(200)
            const body = await res.json() as { session: { projectId?: string | null } }
            expect(body.session.projectId).toBe(data.project!.id)
        })

        test('metadata.machineId 缺失（老数据/异常）→ 放行', async () => {
            const { data } = await createProject({ name: 'cli-legacy-proj', machineId: 'mA' })
            const res = await app.request('/cli/sessions', {
                method: 'POST',
                headers: cliHeaders,
                body: JSON.stringify({
                    tag: 'tag-cli-legacy',
                    metadata: { path: '/a/cli-legacy', host: 'h' },
                    projectId: data.project!.id,
                }),
            })
            expect(res.status).toBe(200)
        })

        test('不带 projectId → project 为 null', async () => {
            const res = await app.request('/cli/sessions', {
                method: 'POST',
                headers: cliHeaders,
                body: JSON.stringify({
                    tag: 'tag-cli-2',
                    metadata: { path: '/x', host: 'h' },
                }),
            })
            expect(res.status).toBe(200)
            const body = await res.json() as { session: { projectId?: string | null }; project: unknown }
            expect(body.project).toBeNull()
            expect(body.session.projectId ?? null).toBeNull()
        })
    })

    describe('PATCH /api/sessions/:id 重命名路径（合并端点）', () => {
        test('PATCH {name} → 200 且改名生效', async () => {
            const session = engine.getOrCreateSession(
                'tag-rename-route', { path: '/a', host: 'h' }, null, 'default'
            )
            const res = await app.request(`/api/sessions/${session.id}`, {
                method: 'PATCH',
                headers: authHeaders,
                body: JSON.stringify({ name: '路由重命名' }),
            })
            expect(res.status).toBe(200)
            expect(await res.json()).toMatchObject({ ok: true })

            const fetched = await app.request(`/api/sessions/${session.id}`, { headers: authHeaders })
            expect(fetched.status).toBe(200)
            const body = await fetched.json() as { session: { metadata?: { name?: string } } }
            expect(body.session.metadata?.name).toBe('路由重命名')
        })

        test('PATCH {}（无 name 无 projectId）→ 400', async () => {
            const session = engine.getOrCreateSession(
                'tag-rename-empty', { path: '/a', host: 'h' }, null, 'default'
            )
            const res = await app.request(`/api/sessions/${session.id}`, {
                method: 'PATCH',
                headers: authHeaders,
                body: JSON.stringify({}),
            })
            expect(res.status).toBe(400)
        })

        test('PATCH {name, projectId} 组合 → 两者都生效', async () => {
            const { data } = await createProject({ name: 'combo-proj', machineId: 'mA' })
            const session = engine.getOrCreateSession(
                'tag-rename-combo', { path: '/a', host: 'h', machineId: 'mA' }, null, 'default'
            )
            const res = await app.request(`/api/sessions/${session.id}`, {
                method: 'PATCH',
                headers: authHeaders,
                body: JSON.stringify({ name: '组合改名', projectId: data.project!.id }),
            })
            expect(res.status).toBe(200)

            // 归属生效
            const list = await app.request(`/api/projects/${data.project!.id}/sessions?limit=100`, { headers: authHeaders })
            const listBody = await list.json() as { sessions: Array<{ id: string }> }
            expect(listBody.sessions.some(s => s.id === session.id)).toBe(true)
            // 改名生效
            const fetched = await app.request(`/api/sessions/${session.id}`, { headers: authHeaders })
            const body = await fetched.json() as { session: { metadata?: { name?: string } } }
            expect(body.session.metadata?.name).toBe('组合改名')
        })
    })

    describe('folders homeDir 校验（V8：建项目时前置拦截，避免 spawn 时才 403）', () => {
        test('folder 在目标机器 homeDir 外 → 400', async () => {
            // 走 engine 注册路径（与生产 CLI 一致，machineCache 可见）；store 直插缓存不可见
            engine.getOrCreateMachine('m-home', { homeDir: '/home/u' }, null, 'default')

            const res = await app.request('/api/projects', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    name: 'bad-proj', machineId: 'm-home',
                    folders: [{ path: '/etc/evil', primary: true }]
                })
            })
            expect(res.status).toBe(400)
            const body = await res.json() as { error?: string }
            expect(body.error).toMatch(/home/i)
        })

        test('folder 在 homeDir 内 → 正常创建', async () => {
            const res = await app.request('/api/projects', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    name: 'ok-proj', machineId: 'm-home',
                    folders: [
                        { path: '/home/u/work/demo', primary: true },
                        { path: '/home/u/work/shared', primary: false }
                    ]
                })
            })
            expect(res.status).toBe(200)
        })

        test('机器未知（无 homeDir）→ 放行（与 spawn 路由同语义）', async () => {
            const res = await app.request('/api/projects', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    name: 'no-machine-proj', machineId: 'm-ghost',
                    folders: [{ path: '/any/where', primary: true }]
                })
            })
            expect(res.status).toBe(200)
        })

        test('PATCH 换 folders 到 homeDir 外 → 400', async () => {
            // 先建一个合法项目
            const created = await app.request('/api/projects', {
                method: 'POST',
                headers: authHeaders,
                body: JSON.stringify({
                    name: 'patch-proj', machineId: 'm-home',
                    folders: [{ path: '/home/u/work/patch', primary: true }]
                })
            })
            const { project } = await created.json() as { project: { id: string } }

            const res = await app.request(`/api/projects/${project.id}`, {
                method: 'PATCH',
                headers: authHeaders,
                body: JSON.stringify({
                    folders: [{ path: '/var/evil', primary: true }]
                })
            })
            expect(res.status).toBe(400)
        })
    })
})
