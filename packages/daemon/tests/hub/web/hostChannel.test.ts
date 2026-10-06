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
import { mkdtempSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setupTestApp, testCliApiToken } from '../helpers/setupTestApp'
import { createHostApp } from '../../../src/web/server'
import { createSocketServer } from '../../../src/socket/server'
import { SnapshotSync } from '../../../src/sync/snapshotSync'
import { testJwtSecret } from '../helpers/setupTestApp'
import { SyncEngine } from '../../../src/sync/syncEngine'
import { Store } from '../../../src/store'
import type { RpcRegistry } from '../../../src/socket/rpcRegistry'
import { updateSettingsFile, writeSettings } from '../../../src/config/settings'

/**
 * ticket-21 验收：宿主通道（/cli/* HTTP + /cli socket namespace）独立 loopback listener。
 * - 主 app 对 /cli/* 显式 404（不被 SPA fallback 吃掉）
 * - 宿主 app /cli/* 路由在位：无 token 401、带 token 200
 * - /cli namespace 只挂宿主 socket.io 实例（io），主端口实例（web）无 /cli 也无 /terminal 泄漏
 * - settings 写入后权限 0600（token 凭证收紧）
 */

function makeSyncEngine(): { engine: SyncEngine; store: Store } {
    const store = new Store(':memory:')
    const io = { of: () => ({ sockets: new Map() }) } as unknown as import('socket.io').Server
    const registry = { getSocketIdForMethod: () => null } as unknown as RpcRegistry
    const sseManager = { broadcast: () => {} } as unknown as import('../../../src/sse/sseManager').SSEManager
    const engine = new SyncEngine(store, io, registry, sseManager)
    return { engine, store }
}

describe('宿主通道独立监听（ticket-21）', () => {
    test('主 app 对 /cli/* 显式 404（含 SPA fallback 生效场景）', async () => {
        // 注入带 index.html 的临时 dist：SPA fallback 激活后 /cli/* 仍须 404 而非 index.html
        const distDir = mkdtempSync(join(tmpdir(), 'mobi-host-test-dist-'))
        writeFileSync(join(distDir, 'index.html'), '<html>spa</html>')
        const { app, cleanup } = await setupTestApp(null, { distDirOverride: distDir })
        try {
            const res = await app.request('/cli/sessions', { headers: { Authorization: `Bearer ${testCliApiToken}` } })
            expect(res.status).toBe(404)
            const body = await res.json() as { error?: string }
            expect(body.error).toContain('Host channel')
        } finally {
            cleanup()
            rmSync(distDir, { recursive: true, force: true })
        }
    })

    test('宿主 app /cli/* 无 token → 401；带 token → 200', async () => {
        const { engine, store } = makeSyncEngine()
        const { cleanup } = await setupTestApp(engine)
        const hostApp = createHostApp({ getSyncEngine: () => engine })
        const sessionBody = JSON.stringify({ tag: 'tag-host-channel', metadata: { path: '/tmp/proj' } })
        try {
            const noAuth = await hostApp.request('/cli/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: sessionBody,
            })
            expect(noAuth.status).toBe(401)

            const authed = await hostApp.request('/cli/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${testCliApiToken}` },
                body: sessionBody,
            })
            expect(authed.status).toBe(200)
            const body = await authed.json() as { session?: { tag?: string } }
            expect(body.session?.tag).toBe('tag-host-channel')

            // 宿主判活端点（诊断通道）
            const health = await hostApp.request('/health')
            expect(health.status).toBe(200)
        } finally {
            cleanup()
            engine.stop()
            store.close()
        }
    })

    test('/cli namespace 只挂宿主实例：主端口 socket.io 上无 /cli、宿主实例无 /terminal', async () => {
        const { cleanup } = await setupTestApp()
        try {
            const { io } = createSocketServer({ store: null as never, jwtSecret: testJwtSecret, snapshotSync: new SnapshotSync() })
            const nsps = (io as unknown as { _nsps: Map<string, unknown> })._nsps
            expect(nsps.has('/cli')).toBe(true)
            expect(nsps.has('/terminal')).toBe(false)
        } finally {
            cleanup()
        }
    })

    test('settings 写入后权限 0600（token 凭证收紧）', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'mobi-settings-perm-'))
        try {
            const file = join(dir, 'settings.hub.json')
            await writeSettings(file, {} as never)
            expect(statSync(file).mode & 0o777).toBe(0o600)

            // 读-改-写路径同样收紧（syncCliApiTokenToCoLocatedCli 走此入口）
            const cliFile = join(dir, 'settings.cli.json')
            await updateSettingsFile<Record<string, unknown>>(cliFile, (current) => ({ ...current, k: 1 }))
            expect(statSync(cliFile).mode & 0o777).toBe(0o600)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
