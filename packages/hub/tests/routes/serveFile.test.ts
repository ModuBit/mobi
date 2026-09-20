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

    test('HTML 文档注入严格 CSP（connect-src none 禁调 mobi API；script/style https 放行 CDN）', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/serve-file/index.html', {
            headers: { Authorization: `Bearer ${token}` },
        })

        const csp = res.headers.get('content-security-policy') ?? ''
        // 收窄脚本联网能力：不能 fetch/XHR 调 mobi API
        expect(csp).toContain("connect-src 'none'")
        // 放行同目录（'self'）+ 外部 CDN（https:）脚本与样式
        expect(csp).toContain("script-src 'self' https:")
        expect(csp).toContain("style-src 'self' https:")
    })

    test('非 HTML 子资源（text/css）不注入 CSP——CSP 只作用于预览文档本身', async () => {
        const engine = {
            resolveSessionAccess: (_id: string, _ns: string) => ({
                ok: true as const,
                sessionId: 's1',
                session: mockSession,
            }),
            readFileMeta: async () => ({
                success: true,
                meta: { mime: 'text/css', size: FILE_CONTENT.byteLength, etag: '5-1' },
            }),
            readFileRange: async (_s: string, _p: string, offset: number, length: number) => ({
                success: true,
                chunk: FILE_CONTENT.subarray(offset, offset + length),
            }),
        } as unknown as SyncEngine
        const setup = await setupTestApp(engine)
        try {
            const token = await getAuthToken(setup.app)
            const res = await setup.app.request('/api/sessions/s1/serve-file/a/b.css', {
                headers: { Authorization: `Bearer ${token}` },
            })
            expect(res.headers.get('content-security-policy')).toBeNull()
        } finally {
            setup.cleanup()
        }
    })

    test('download=1 → content-disposition: attachment（强制下载，避免 top-level 脱离 sandbox）', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/serve-file/index.html?download=1', {
            headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
        // attachment 触发浏览器下载而非渲染——新标签打开也不执行脚本，保持 sandbox 隔离
        expect(res.headers.get('content-disposition')).toContain('attachment')
    })

    test('边界权威在 CLI：绝对路径（含前导 / 注入）透传 RPC，越界由 validateReadPath 拒绝映射 403', async () => {
        // hub 不再自带 cwd 守卫（双头策略曾把「read-file 能读、预览 403」的不一致
        // 暴露给用户：/tmp 在 CLI 读边界内却被 hub 拦死）。本端只做 relPath→absPath
        // 归一，越界判定单源 CLI validateReadPath；本测试用 mock 模拟 CLI 的
        // ACCESS_DENIED 拒绝，锁定「拒绝结果经 fileMetaHttpStatus 映射 403」的契约。
        const rejectingEngine = {
            ...mockSyncEngine,
            readFileMeta: async (_sessionId: string, path: string) => {
                metaCalls.push(path)
                return { success: false, error: `Access denied: Path '${path}' is outside the working directory`, code: 'ACCESS_DENIED' }
            },
        } as unknown as SyncEngine
        const setup = await setupTestApp(rejectingEngine)
        try {
            const token = await getAuthToken(setup.app)

            // 双斜杠使 path 段以 / 开头，resolve 遇绝对路径会重置 → /etc/passwd
            // （.. 向量在 URL 层就被浏览器/hono 规范化，到不了端点；前导/是真实可达的越界路径）
            const res = await setup.app.request('/api/sessions/s1/serve-file//etc/passwd', {
                headers: { Authorization: `Bearer ${token}` },
            })

            expect(res.status).toBe(403)
            // 请求已透传到 RPC 层（拒绝判定发生在那里）
            expect(metaCalls).toContain('/etc/passwd')
        } finally {
            setup.cleanup()
        }
    })

    test('extra read root（/tmp）在 CLI 读边界内：绝对路径透传后正常预览', async () => {
        // 回归：/tmp 下的 HTML 此前被 hub cwd 守卫 403（read-file 能读、预览不能），现与读边界对齐
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/serve-file//tmp/scratch/mockup.html', {
            headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
        expect(metaCalls).toContain('/tmp/scratch/mockup.html')
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
    test('无 token → 401（serve-file 不可绕过鉴权）', async () => {
        const setup = await setupTestApp(mockSyncEngine)
        try {
            const res = await setup.app.request('/api/sessions/s1/serve-file/index.html')
            expect(res.status).toBe(401)
        } finally {
            setup.cleanup()
        }
    })

    test('文件不存在（cli stat 抛 ENOENT，结构化 code）→ 404', async () => {
        const engine = {
            resolveSessionAccess: (_id: string, _ns: string) => ({
                ok: true as const,
                sessionId: 's1',
                session: mockSession,
            }),
            readFileMeta: async () => ({ success: false, error: 'ENOENT: no such file or directory', code: 'ENOENT' }),
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

    test('非 ENOENT 错误（即使文案含 not found）→ 500，不误判 404', async () => {
        // 回归：旧实现用 /not found|enoent/i 文案正则，会把含 "not found" 的 500 错误误判为 404。
        // 现基于结构化 code，无 code 即 500。
        const engine = {
            resolveSessionAccess: (_id: string, _ns: string) => ({
                ok: true as const,
                sessionId: 's1',
                session: mockSession,
            }),
            readFileMeta: async () => ({ success: false, error: 'registry: foo not found in cache' }),
            readFileRange: async () => ({ success: true, chunk: new Uint8Array(0) }),
        } as unknown as SyncEngine
        const setup = await setupTestApp(engine)
        try {
            const token = await getAuthToken(setup.app)
            const res = await setup.app.request('/api/sessions/s1/serve-file/x.html', {
                headers: { Authorization: `Bearer ${token}` },
            })
            expect(res.status).toBe(500)
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
