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

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { setupTestApp, getAuthToken } from '../helpers/setupTestApp'
import type { SyncEngine } from '../../src/sync/syncEngine'
import type { Session, SDKMetadata } from '@mobi/shared'

const cachedMetadata: SDKMetadata = {
    commands: [{ name: 'old-cmd', description: 'stale', argumentHint: '' }],
}

function makeSession(sdkMetadata?: SDKMetadata): Session {
    return {
        id: 's1',
        namespace: 'default',
        seq: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        active: true,
        activeAt: Date.now(),
        metadata: { path: '/tmp/test', host: 'h', flavor: 'claude', sdkMetadata },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 0,
        running: true,
        runningAt: Date.now(),
        permissionMode: 'default',
    }
}

describe('GET /api/sessions/:id/metadata — SWR', () => {
    let app: ReturnType<typeof import('../../src/web/server').createWebApp>
    let cleanup: () => void = () => {}

    async function bootstrap(session: Session, engine: Partial<SyncEngine>) {
        const fullEngine = {
            resolveSessionAccess: (_id: string, _ns: string) => ({ ok: true as const, sessionId: 's1', session }),
            ...engine,
        } as unknown as SyncEngine
        const setup = await setupTestApp(fullEngine)
        app = setup.app
        cleanup = setup.cleanup
    }

    afterEach(() => {
        cleanup()
    })

    test('有缓存：立即返回缓存 + 触发后台刷新（不阻塞、不走 refreshMetadata）', async () => {
        const refreshSDKMetadataBackground = mock(() => Promise.resolve())
        const refreshMetadata = mock(async () => ({ success: true, metadata: { commands: [] } }))
        await bootstrap(makeSession(cachedMetadata), { refreshSDKMetadataBackground, refreshMetadata })

        const token = await getAuthToken(app)
        const res = await app.request('/api/sessions/s1/metadata', {
            headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
        const body = await res.json() as { metadata: SDKMetadata }
        expect(body.metadata).toEqual(cachedMetadata)
        // 命中缓存：后台刷新被触发（fire-and-forget），且不调阻塞 refreshMetadata
        expect(refreshSDKMetadataBackground).toHaveBeenCalledTimes(1)
        expect(refreshMetadata).not.toHaveBeenCalled()
    })

    test('无缓存：阻塞刷新 + 写库 + 返回新值', async () => {
        const fresh: SDKMetadata = { commands: [{ name: 'fresh', description: 'd', argumentHint: '' }] }
        const refreshMetadata = mock(async () => ({ success: true, metadata: fresh }))
        const updateSDKMetadata = mock((_sid: string, _m: SDKMetadata) => {})
        await bootstrap(makeSession(undefined), { refreshMetadata, updateSDKMetadata })

        const token = await getAuthToken(app)
        const res = await app.request('/api/sessions/s1/metadata', {
            headers: { Authorization: `Bearer ${token}` },
        })

        expect(res.status).toBe(200)
        const body = await res.json() as { metadata: SDKMetadata }
        expect(body.metadata).toEqual(fresh)
        expect(refreshMetadata).toHaveBeenCalledTimes(1)
        expect(updateSDKMetadata).toHaveBeenCalledTimes(1)
        expect(updateSDKMetadata.mock.calls[0][1]).toBe(fresh)
    })
})
