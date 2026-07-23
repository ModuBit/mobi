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

import type { afterEach } from 'bun:test'
import { Store } from '../../src/store'
import { createWebApp } from '../../src/web/server'
import { createConfiguration, resetConfiguration } from '../../src/configuration'
import type { SSEManager } from '../../src/sse/sseManager'
import type { VisibilityTracker } from '../../src/visibility/visibilityTracker'
import type { SyncEngine } from '../../src/sync/syncEngine'

export const testJwtSecret = new Uint8Array(32)
crypto.getRandomValues(testJwtSecret)

export const testCliApiToken = 'test-cli-api-token'
export const testWebApiToken = 'test-web-api-token'

export async function setupTestApp(syncEngine: SyncEngine | null = null) {
    const store = new Store(':memory:')
    process.env.CLI_API_TOKEN = testCliApiToken
    process.env.WEB_API_TOKEN = testWebApiToken
    // 钉死 publicUrl 为 http：createConfiguration 会读本地 ~/.mobi/settings.json（env > file > default），
    // 若本机配了 https publicUrl(部署用) 会污染 secure cookie 判定 → auth Secure 断言误失败。
    // env 优先级最高,显式设 http 隔离测试环境。
    process.env.MOBI_PUBLIC_URL = 'http://localhost:2222'
    resetConfiguration()
    await createConfiguration()

    const app = createWebApp({
        getSyncEngine: () => (syncEngine ?? null) as SyncEngine,
        getSseManager: () => null as unknown as SSEManager,
        getVisibilityTracker: () => null as unknown as VisibilityTracker,
        jwtSecret: testJwtSecret,
        store,
        vapidPublicKey: 'test-vapid-public-key',
        // 测试用具体 origin（非 '*'）：web 层 credentials:true 与 '*' 互斥，启动会 throw（assertCorsOriginsForCredentials）
        corsOrigins: ['http://localhost:3000'],
        embeddedAssetMap: null,
    })

    const cleanup = () => {
        store.close()
        delete process.env.CLI_API_TOKEN
        delete process.env.WEB_API_TOKEN
        delete process.env.MOBI_PUBLIC_URL
        resetConfiguration()
    }

    return { store, app, cleanup }
}

export async function getAuthToken(app: ReturnType<typeof createWebApp>): Promise<string> {
    const res = await app.request('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: testWebApiToken }),
    })
    const body = await res.json() as { token: string }
    return body.token
}
