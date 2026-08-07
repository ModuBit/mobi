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

import { describe, test, expect, afterEach } from 'bun:test'
import { setupTestApp, getAuthToken } from '../helpers/setupTestApp'
import type { SyncEngine } from '../../src/sync/syncEngine'
import type { Session } from '@mobi/shared'

const mockSession: Session = {
    id: 'test-session-1',
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

type SaveArgs = { sid: string; path: string; content: Uint8Array; baseEtag: string }

function makeEngine(saveImpl: (a: SaveArgs) => unknown): { engine: SyncEngine; calls: SaveArgs[] } {
    const calls: SaveArgs[] = []
    const engine = {
        resolveSessionAccess: () => ({ ok: true as const, sessionId: 'test-session-1', session: mockSession }),
        saveFile: async (sid: string, path: string, content: Uint8Array, baseEtag: string) => {
            const args = { sid, path, content, baseEtag }
            calls.push(args)
            return saveImpl(args)
        },
    }
    return { engine: engine as unknown as SyncEngine, calls }
}

describe('POST /api/sessions/:id/save-file', () => {
    let cleanup: (() => void) | undefined

    afterEach(() => {
        cleanup?.()
        cleanup = undefined
    })

    async function postSave(
        engine: SyncEngine,
        body: Uint8Array,
        headers: Record<string, string>,
    ) {
        const setup = await setupTestApp(engine)
        const app = setup.app
        cleanup = setup.cleanup
        const token = await getAuthToken(app)
        return app.request('/api/sessions/test-session-1/save-file', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/octet-stream',
                ...headers,
            },
            body,
        })
    }

    test('成功 → 200 + etag，透传 path/content/baseEtag', async () => {
        const { engine, calls } = makeEngine(() => ({ success: true, etag: 'new-etag' }))
        const res = await postSave(
            engine,
            new TextEncoder().encode('# hi\n'),
            { 'X-Mobi-Path': 'a.md', 'X-Mobi-Base-Etag': 'old' },
        )
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ success: true, etag: 'new-etag' })
        expect(calls).toHaveLength(1)
        expect(calls[0].path).toBe('a.md')
        expect(calls[0].baseEtag).toBe('old')
        expect(calls[0].content.length).toBe(5)
        expect(calls[0].sid).toBe('test-session-1')
    })

    test('conflict → 409 + currentEtag', async () => {
        const { engine } = makeEngine(() => ({ success: false, conflict: true, currentEtag: 'cur' }))
        const res = await postSave(
            engine,
            new Uint8Array([1]),
            { 'X-Mobi-Path': 'a.md', 'X-Mobi-Base-Etag': 'old' },
        )
        expect(res.status).toBe(409)
        expect(await res.json()).toEqual({ success: false, conflict: true, currentEtag: 'cur' })
    })

    test('其他错误 → 500', async () => {
        const { engine } = makeEngine(() => ({ success: false, error: 'boom' }))
        const res = await postSave(
            engine,
            new Uint8Array([1]),
            { 'X-Mobi-Path': 'a.md', 'X-Mobi-Base-Etag': 'old' },
        )
        expect(res.status).toBe(500)
    })

    test('缺 X-Mobi-Path → 400', async () => {
        const { engine } = makeEngine(() => ({ success: true, etag: 'x' }))
        const res = await postSave(engine, new Uint8Array([1]), {})
        expect(res.status).toBe(400)
    })
})
