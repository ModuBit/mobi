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

/**
 * GET /api/machines/:id/read-file 路由测试：
 * 鉴权 / 参数校验 / cwd 边界 / meta→stream 全链路（serveFileContent 复用层不重复测，
 * 由 sessions 侧 readFileStreaming/fileMeta 测试覆盖）。
 */

const CHUNK = 'PNGDATA-bin'

const mockSyncEngine = {
    getMachine: (_id: string) => ({
        id: 'test-machine-1',
        namespace: 'default',
        metadata: { host: 't', platform: 'linux', mobiCliVersion: '0.1.0', homeDir: '/home/testuser' },
    }),
    machineReadFileMeta: async (_mid: unknown, _cwd: unknown, path: string) => {
        if (path.endsWith('.missing.png')) {
            return { success: false, error: 'ENOENT', code: 'ENOENT' }
        }
        if (path.endsWith('.png')) {
            return { success: true, meta: { mime: 'image/png', size: CHUNK.length, etag: '8-123' } }
        }
        if (path.endsWith('.html')) {
            return { success: true, meta: { mime: 'text/html', size: CHUNK.length, etag: '1-1' } }
        }
        return { success: false, error: 'File extension ".bin" is not allowed over machine channel' }
    },
    machineReadFileRange: async (_mid: unknown, _cwd: unknown, _p: unknown, offset: number, length: number) => {
        return { success: true, chunk: new TextEncoder().encode(CHUNK.slice(offset, offset + length)) }
    },
} as unknown as SyncEngine

describe('GET /api/machines/:id/read-file', () => {
    let app: ReturnType<typeof import('../../src/web/server').createWebApp>
    let cleanup: () => void

    beforeEach(async () => {
        const setup = await setupTestApp(mockSyncEngine)
        app = setup.app
        cleanup = setup.cleanup
    })

    afterEach(() => {
        cleanup()
    })

    async function get(url: string) {
        const token = await getAuthToken(app)
        return await app.request(url, {
            headers: { Authorization: `Bearer ${token}` },
        })
    }

    test('400：缺 path 参数', async () => {
        const res = await get('/api/machines/test-machine-1/read-file?cwd=/home/testuser/proj')
        expect(res.status).toBe(400)
    })

    test('403：cwd 在 homeDir 外', async () => {
        const res = await get('/api/machines/test-machine-1/read-file?cwd=/etc&path=.mobi/uploads/a.png')
        expect(res.status).toBe(403)
    })

    test('200：meta→stream 返回图片内容与响应头', async () => {
        const res = await get('/api/machines/test-machine-1/read-file?cwd=/home/testuser/proj&path=.mobi/uploads/a.png')
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe('image/png')
        expect(res.headers.get('etag')).toBe('8-123')
        expect(await res.text()).toBe(CHUNK)
    })

    test('200：html 文档带 nosniff + 断网 CSP（防 hub origin 脚本执行）', async () => {
        const res = await get('/api/machines/test-machine-1/read-file?cwd=/home/testuser/proj&path=.mobi/uploads/evil.html')
        expect(res.status).toBe(200)
        expect(res.headers.get('x-content-type-options')).toBe('nosniff')
        const csp = res.headers.get('content-security-policy') ?? ''
        expect(csp).toContain("connect-src 'none'")
        expect(csp).toContain("default-src 'none'")
    })

    test('404：meta ENOENT 结构化透传', async () => {
        const res = await get('/api/machines/test-machine-1/read-file?cwd=/home/testuser/proj&path=.mobi/uploads/x.missing.png')
        expect(res.status).toBe(404)
    })

    test('500：其余失败透传', async () => {
        const res = await get('/api/machines/test-machine-1/read-file?cwd=/home/testuser/proj&path=.mobi/uploads/b.bin')
        expect(res.status).toBe(500)
    })
})
