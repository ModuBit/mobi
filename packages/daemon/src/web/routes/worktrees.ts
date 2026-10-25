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
 * worktree 生命周期路由（host 直调族）：worktree 生命周期长于会话，且孤儿
 * worktree 没有会话可寻址，故不走 session machine 通道。
 *
 * 列表端点要求 syncEngine 就绪（daemon 启动早期 503，与其它 host 路由一致）。
 */

import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import { WorktreeLifecycleService } from '../../worktree/service'
import type { WebAppDeps } from '../appDeps'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

export function createWorktreesRoutes(
    deps: Pick<WebAppDeps, 'store' | 'getSyncEngine'>
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    /**
     * 会话运行态：active（进程/心跳在）或 running（轮次进行中）都视为不可处置。
     * 直读 SyncEngine 实时态而非 DB，避免用过期落库值放行删除。
     */
    const serviceFor = (engine: SyncEngine): WorktreeLifecycleService => new WorktreeLifecycleService({
        store: deps.store,
        isSessionRunning: (sessionId) => {
            const session = engine.getSession(sessionId)
            return Boolean(session?.active || session?.running)
        }
    })

    // GET /api/worktrees - 本机全部 mobi worktree 画像（含孤儿）
    app.get('/worktrees', async (c) => {
        const engine = requireSyncEngine(c, deps.getSyncEngine)
        if (engine instanceof Response) return engine

        const worktrees = await serviceFor(engine).list()
        return c.json({ worktrees })
    })

    return app
}
