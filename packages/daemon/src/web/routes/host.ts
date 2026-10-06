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
 * daemon 状态域路由（单机）：/api/daemon/status。
 *
 * 语义：取代原 GET /api/machines（恒单元素的机器列表）——单机世界 daemon 即宿主，
 * 状态直出本进程，不再有「机器列表」这一层。就绪判据与旧 machines API 一致：
 * syncEngine 未接入（启动早期）返回 503 starting；就绪后返回 host 静态身份 +
 * executor 运行时（executorRuntime 内存单例，205 起不再落库）。
 */

import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'

export function createHostRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/daemon/status', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ status: 'starting' }, 503)
        }
        // host 静态身份 + executor 动态状态同一投影（daemon-status SSE 事件同形）
        return c.json(engine.getDaemonStatus())
    })

    return app
}
