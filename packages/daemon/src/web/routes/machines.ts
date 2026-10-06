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
 * GET /api/machines 过渡 shim（401 起 store 层退场，数据源换 daemon status 投影——
 * 恒单行、id 恒 'local'；消费方只剩 web WorkspaceFormModal 的 machineId 下拉与 smoke
 * 建工作区，R1（workspaces.machine_id NOT NULL）未解前保留契约，404 随消费方整条删）。
 */

import { Hono } from 'hono'
import { type SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'

export function createMachinesRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/machines', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const status = engine.getDaemonStatus()
        return c.json({
            machines: [{
                id: 'local',
                active: true,
                metadata: status.host,
                runnerState: status.executor,
            }],
        })
    })

    return app
}
