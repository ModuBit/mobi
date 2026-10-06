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
 * SDK 元数据域路由：/api/sdk/*。
 *
 * host-metadata（ticket 203，原 GET /api/machines/:id/metadata 去机器维度）：按 cwd
 * 刷新/读取会话 SDK 元数据（slash 命令等）——新建会话页选目录后、会话行尚未存在时
 * 的元数据通道；会话内走 GET /api/sessions/:id/metadata（SWR 缓存语义在那边）。
 */

import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireHostHomeDir, validateCwd } from './guards'

export function createSdkRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/sdk/host-metadata', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const cwd = c.req.query('cwd')
        if (!cwd) {
            return c.json({ error: 'cwd parameter is required' }, 400)
        }

        const cwdError = validateCwd(cwd, requireHostHomeDir())
        if (cwdError) return cwdError

        try {
            const result = await engine.hostRefreshMetadata(cwd)
            return c.json({ success: true, metadata: result.metadata ?? {} })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to refresh metadata' }, 500)
        }
    })

    return app
}
