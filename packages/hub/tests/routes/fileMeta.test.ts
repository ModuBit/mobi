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
    metadata: { path: '/tmp/test', host: 'test-host', flavor: 'claude' },
    metadataVersion: 1,
    agentState: null,
    agentStateVersion: 0,
    running: true,
    runningAt: Date.now(),
    permissionMode: 'default',
}

// 默认 mock：readFileMeta 按 path 返回不同结果，覆盖成功/失败两条路径
const mockSyncEngine = {
    resolveSessionAccess: (_id: string, _ns: string) => ({
        ok: true as const,
        sessionId: 's1',
        session: mockSession,
    }),
    readFileMeta: async (_sessionId: string, path: string) => {
        if (path === 'missing.txt') {
            return { success: false, error: 'File not found' }
        }
        return {
            success: true,
            meta: { mime: 'text/plain', size: 11, etag: '11-1' },
        }
    },
} as unknown as SyncEngine

// 轻量元信息：只 stat 不下载内容，供 web 大小判断/协商缓存先行
describe('GET /api/sessions/:id/file-meta', () => {
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

    test('200：返回 mime/size/etag 元信息', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/file-meta?path=a.txt', {
            headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({
            success: true,
            meta: { mime: 'text/plain', size: 11, etag: '11-1' },
        })
    })

    test('400：缺 path 参数', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/file-meta', {
            headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(400)
        const body = (await res.json()) as { success: boolean; error: string }
        expect(body.success).toBe(false)
        expect(body.error).toMatch(/path/i)
    })

    test('500：readFileMeta 返回失败', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/file-meta?path=missing.txt', {
            headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(500)
        const body = (await res.json()) as { success: boolean; error: string }
        expect(body.success).toBe(false)
        expect(body.error).toBe('File not found')
    })
})
