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
 * POST /api/sessions/:id/upload 流式端点集成测试。
 *
 * 注：413（Content-Length > MAX）与 Content-Length 缺失分支无法用 fetch 构造——
 * fetch 规范下 body 存在时 Content-Length 是 forbidden header（自动按 body 长度设），
 * 故这两条防御分支由 uploadStream 单测 + 代码审查保证，端点测试聚焦可构造的 HTTP 胶水。
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

// 记录 uploadFileRange 调用的 offset/chunkLen，供断言聚合行为
const uploadCalls: Array<{ offset: number; chunkLen: number }> = []

const mockSyncEngine = {
    resolveSessionAccess: (_id: string, _ns: string) => ({
        ok: true as const,
        sessionId: 's1',
        session: mockSession,
    }),
    uploadFileRange: async (
        _sid: string, _fn: string, _path: string | undefined, offset: number, chunk: Uint8Array,
    ) => {
        uploadCalls.push({ offset, chunkLen: chunk.length })
        if (offset === 0) return { success: true, path: '.mobi/uploads/x.png', written: chunk.length }
        return { success: true, written: chunk.length }
    },
    deleteUploadFile: async () => ({ success: true }),
} as unknown as SyncEngine

describe('POST /api/sessions/:id/upload 流式', () => {
    let app: ReturnType<typeof import('../../src/web/server').createWebApp>
    let cleanup: () => void

    beforeEach(async () => {
        uploadCalls.length = 0
        const setup = await setupTestApp(mockSyncEngine)
        app = setup.app
        cleanup = setup.cleanup
    })

    afterEach(() => {
        cleanup()
        uploadCalls.length = 0
    })

    test('正常小文件：二进制 body + X-Mobi-Filename → 200 + path（单次 flush）', async () => {
        const token = await getAuthToken(app)
        const res = await app.request('/api/sessions/s1/upload', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/octet-stream',
                'X-Mobi-Filename': encodeURIComponent('test.png'),
                'Content-Length': '5',
            },
            body: new Uint8Array([1, 2, 3, 4, 5]),
        })

        expect(res.status).toBe(200)
        const data = (await res.json()) as { success: boolean; path?: string }
        expect(data.success).toBe(true)
        expect(data.path).toBe('.mobi/uploads/x.png')
        // 5 字节 < CHUNK，reader done 时单次 flush
        expect(uploadCalls.length).toBe(1)
        expect(uploadCalls[0].offset).toBe(0)
        expect(uploadCalls[0].chunkLen).toBe(5)
    })

    test('400：缺 X-Mobi-Filename header', async () => {
        const token = await getAuthToken(app)
        const res = await app.request('/api/sessions/s1/upload', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/octet-stream',
            },
            body: new Uint8Array([1, 2, 3]),
        })

        expect(res.status).toBe(400)
        expect(uploadCalls.length).toBe(0)
    })
})
