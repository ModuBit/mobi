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

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { setupTestApp, getAuthToken } from '../helpers/setupTestApp'
import type { SyncEngine } from '../../src/sync/syncEngine'
import type { Session } from '@mobi/shared'

const mockSession: Session = {
    id: 's1',
    namespace: 'default',
    seq: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    active: true,
    activeAt: Date.now(),
    // cwd = /tmp/test；serve-file 的 relPath 相对它 resolve
    metadata: { path: '/tmp/test', host: 'test-host', flavor: 'claude' },
    metadataVersion: 1,
    agentState: null,
    agentStateVersion: 0,
    running: true,
    runningAt: Date.now(),
    permissionMode: 'default',
}

const FILE_CONTENT = new TextEncoder().encode('hello')

// 记录 readFileMeta 收到的 absPath，验证 relPath→absPath 转换（join cwd）
const metaCalls: string[] = []

const mockSyncEngine = {
    resolveSessionAccess: (_id: string, _ns: string) => ({
        ok: true as const,
        sessionId: 's1',
        session: mockSession,
    }),
    readFileMeta: async (_sessionId: string, path: string) => {
        metaCalls.push(path)
        return {
            success: true,
            meta: { mime: 'text/html', size: FILE_CONTENT.byteLength, etag: '5-1' },
        }
    },
    readFileRange: async (_sessionId: string, _path: string, offset: number, length: number) => {
        const chunk = FILE_CONTENT.subarray(offset, offset + length)
        return { success: true, chunk }
    },
} as unknown as SyncEngine

describe('GET /api/sessions/:id/serve-file/* 静态资源（HTML 预览）', () => {
    let app: ReturnType<typeof import('../../src/web/server').createWebApp>
    let cleanup: () => void

    beforeEach(async () => {
        metaCalls.length = 0
        const setup = await setupTestApp(mockSyncEngine)
        app = setup.app
        cleanup = setup.cleanup
    })

    afterEach(() => {
        cleanup()
        metaCalls.length = 0
    })

    test('相对路径解析：relPath join cwd 后读文件（output/index.html → /tmp/test/output/index.html）', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/serve-file/output/index.html', {
            headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
        expect(metaCalls).toContain('/tmp/test/output/index.html')
        const buf = new Uint8Array(await res.arrayBuffer())
        expect(new TextDecoder().decode(buf)).toBe('hello')
    })

    test('nosniff 头存在（通用静态端点防 MIME 嗅探）', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/serve-file/index.html', {
            headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    })

    test('Content-Type 由 meta.mime 决定（text/html）', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/serve-file/index.html', {
            headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.headers.get('content-type')).toBe('text/html')
    })

    test('越界（前导 / 绝对路径注入逃出 cwd）→ 403', async () => {
        const token = await getAuthToken(app)

        // 双斜杠使 path 段以 / 开头，resolve 遇绝对路径会重置 → /etc/passwd 越出 cwd
        // （.. 向量在 URL 层就被浏览器/hono 规范化，到不了端点；前导/是真实可达的越界路径）
        const res = await app.request('/api/sessions/s1/serve-file//etc/passwd', {
            headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(403)
        // 越界不应读文件
        expect(metaCalls.length).toBe(0)
    })

    test('cwd 子路径正常放行（/tmp/test/a/b.css 在 cwd 内）', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/serve-file/a/b.css', {
            headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
        expect(metaCalls).toContain('/tmp/test/a/b.css')
    })
})

describe('GET /api/sessions/:id/serve-file/* 错误码', () => {
    test('文件不存在（cli stat 抛 ENOENT）→ 404', async () => {
        const engine = {
            resolveSessionAccess: (_id: string, _ns: string) => ({
                ok: true as const,
                sessionId: 's1',
                session: mockSession,
            }),
            readFileMeta: async () => ({ success: false, error: 'ENOENT: no such file or directory' }),
            readFileRange: async () => ({ success: true, chunk: new Uint8Array(0) }),
        } as unknown as SyncEngine
        const setup = await setupTestApp(engine)
        try {
            const token = await getAuthToken(setup.app)
            const res = await setup.app.request('/api/sessions/s1/serve-file/missing.html', {
                headers: { Authorization: `Bearer ${token}` },
            })
            expect(res.status).toBe(404)
        } finally {
            setup.cleanup()
        }
    })

    test('cwd 未知（session.metadata.path 缺失）→ 500', async () => {
        const noCwdSession: Session = { ...mockSession, metadata: null }
        const engine = {
            resolveSessionAccess: (_id: string, _ns: string) => ({
                ok: true as const,
                sessionId: 's1',
                session: noCwdSession,
            }),
            readFileMeta: async () => ({ success: true, meta: { mime: 'text/html', size: 1, etag: 'e' } }),
            readFileRange: async () => ({ success: true, chunk: new Uint8Array(0) }),
        } as unknown as SyncEngine
        const setup = await setupTestApp(engine)
        try {
            const token = await getAuthToken(setup.app)
            const res = await setup.app.request('/api/sessions/s1/serve-file/index.html', {
                headers: { Authorization: `Bearer ${token}` },
            })
            expect(res.status).toBe(500)
        } finally {
            setup.cleanup()
        }
    })
})
