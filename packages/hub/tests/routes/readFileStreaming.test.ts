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

// 完整文件内容 'hello'（5 字节），供 mock readFileRange 按段切片返回，
// 从而验证 hub 端循环调用 readFileRange 拼接出完整 body 的流式逻辑
const FILE_CONTENT = new TextEncoder().encode('hello')
const FILE_MIME = 'text/plain'
const FILE_ETAG = '5-1'

// 记录 readFileRange 被调用的 (offset, length)，供用例断言流式切片行为
const rangeCalls: Array<{ offset: number; length: number }> = []

const mockSyncEngine = {
    resolveSessionAccess: (_id: string, _ns: string) => ({
        ok: true as const,
        sessionId: 's1',
        session: mockSession,
    }),
    readFileMeta: async () => ({
        success: true,
        meta: { mime: FILE_MIME, size: FILE_CONTENT.byteLength, etag: FILE_ETAG },
    }),
    readFileRange: async (_sessionId: string, _path: string, offset: number, length: number) => {
        rangeCalls.push({ offset, length })
        const chunk = FILE_CONTENT.subarray(offset, offset + length)
        return { success: true, chunk }
    },
} as unknown as SyncEngine

function newEngineWithRangeSpy() {
    rangeCalls.length = 0
    return mockSyncEngine
}

describe('GET /api/sessions/:id/read-file 流式', () => {
    let app: ReturnType<typeof import('../../src/web/server').createWebApp>
    let cleanup: () => void

    beforeEach(async () => {
        const setup = await setupTestApp(newEngineWithRangeSpy())
        app = setup.app
        cleanup = setup.cleanup
    })

    afterEach(() => {
        cleanup()
        rangeCalls.length = 0
    })

    test('200 全量：Content-Type/ETag/Accept-Ranges 齐全，body 为完整字节', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/read-file?path=a.txt', {
            headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe(FILE_MIME)
        expect(res.headers.get('etag')).toBe(FILE_ETAG)
        expect(res.headers.get('accept-ranges')).toBe('bytes')
        expect(res.headers.get('content-length')).toBe(String(FILE_CONTENT.byteLength))

        const buf = new Uint8Array(await res.arrayBuffer())
        expect(new TextDecoder().decode(buf)).toBe('hello')

        // 验证 hub 走流式切片：至少调一次 readFileRange，且覆盖到文件末尾
        expect(rangeCalls.length).toBeGreaterThanOrEqual(1)
        const last = rangeCalls[rangeCalls.length - 1]
        expect(last.offset + last.length).toBeLessThanOrEqual(FILE_CONTENT.byteLength)
    })

    test('206 Partial：Range bytes=1-3 返回片段 + Content-Range', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/read-file?path=a.txt', {
            headers: {
                Authorization: `Bearer ${token}`,
                Range: 'bytes=1-3',
            },
        })

        expect(res.status).toBe(206)
        expect(res.headers.get('content-range')).toBe(`bytes 1-3/${FILE_CONTENT.byteLength}`)
        expect(res.headers.get('content-length')).toBe('3')
        expect(res.headers.get('accept-ranges')).toBe('bytes')

        const buf = new Uint8Array(await res.arrayBuffer())
        expect(new TextDecoder().decode(buf)).toBe('ell')
    })

    test('206 Partial：Range bytes=-2（suffix 尾部 N 字节）返回最后 2 字节', async () => {
        // suffix range：浏览器读 mp4 尾部 moov atom 时常用此形式（bytes=-N）
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/read-file?path=a.txt', {
            headers: {
                Authorization: `Bearer ${token}`,
                Range: 'bytes=-2',
            },
        })

        expect(res.status).toBe(206)
        expect(res.headers.get('content-range')).toBe(`bytes 3-4/${FILE_CONTENT.byteLength}`)
        expect(res.headers.get('content-length')).toBe('2')
        const buf = new Uint8Array(await res.arrayBuffer())
        expect(new TextDecoder().decode(buf)).toBe('lo')
    })

    test('206 Partial：Range bytes=-100（suffix 超过文件大小）返回整个文件', async () => {
        // RFC 7233：suffix 长度 ≥ 文件大小时，区间回退为整个文件
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/read-file?path=a.txt', {
            headers: {
                Authorization: `Bearer ${token}`,
                Range: 'bytes=-100',
            },
        })

        expect(res.status).toBe(206)
        expect(res.headers.get('content-range')).toBe(`bytes 0-4/${FILE_CONTENT.byteLength}`)
        const buf = new Uint8Array(await res.arrayBuffer())
        expect(new TextDecoder().decode(buf)).toBe('hello')
    })

    test('416：Range bytes=-0（suffix 长度为 0）非法', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/read-file?path=a.txt', {
            headers: {
                Authorization: `Bearer ${token}`,
                Range: 'bytes=-0',
            },
        })

        expect(res.status).toBe(416)
        expect(res.headers.get('content-range')).toBe(`bytes */${FILE_CONTENT.byteLength}`)
    })

    test('304：If-None-Match 命中 etag 返回空', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/read-file?path=a.txt', {
            headers: {
                Authorization: `Bearer ${token}`,
                'If-None-Match': FILE_ETAG,
            },
        })

        expect(res.status).toBe(304)
        expect(await res.text()).toBe('')
        // 命中协商缓存不应再读范围
        expect(rangeCalls.length).toBe(0)
    })

    test('416：Range 越界', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/read-file?path=a.txt', {
            headers: {
                Authorization: `Bearer ${token}`,
                Range: 'bytes=100-',
            },
        })

        expect(res.status).toBe(416)
        expect(res.headers.get('content-range')).toBe(`bytes */${FILE_CONTENT.byteLength}`)
    })

    test('?download=1 → Content-Disposition: attachment', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/read-file?path=sub/a.txt&download=1', {
            headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
        const cd = res.headers.get('content-disposition') ?? ''
        expect(cd).toContain('attachment')
        expect(cd).toContain('filename="a.txt"')
    })
})

describe('GET /api/sessions/:id/read-file 空文件', () => {
    let app: ReturnType<typeof import('../../src/web/server').createWebApp>
    let cleanup: () => void
    const emptyRangeCalls: Array<{ offset: number; length: number }> = []

    beforeEach(async () => {
        emptyRangeCalls.length = 0
        const emptyEngine = {
            resolveSessionAccess: (_id: string, _ns: string) => ({
                ok: true as const,
                sessionId: 's1',
                session: mockSession,
            }),
            readFileMeta: async () => ({
                success: true,
                meta: { mime: 'application/x-empty', size: 0, etag: '0-1' },
            }),
            readFileRange: async (_s: string, _p: string, offset: number, length: number) => {
                emptyRangeCalls.push({ offset, length })
                return { success: true, chunk: new Uint8Array(0) }
            },
        } as unknown as SyncEngine
        const setup = await setupTestApp(emptyEngine)
        app = setup.app
        cleanup = setup.cleanup
    })

    afterEach(() => {
        cleanup()
    })

    test('200 空文件：content-length=0、body 空、不进循环读范围', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/s1/read-file?path=empty.txt', {
            headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
        expect(res.headers.get('content-length')).toBe('0')
        expect(res.headers.get('accept-ranges')).toBe('bytes')
        const buf = new Uint8Array(await res.arrayBuffer())
        expect(buf.byteLength).toBe(0)
        // size=0 → start=0/end=-1，while(0<=-1) 不进循环，readFileRange 零调用
        expect(emptyRangeCalls.length).toBe(0)
    })
})
