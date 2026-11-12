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
 * GET /api/skills（skill-mgmt 票 01）：skill 管理页列表。
 *
 * - workspaceId=global（或缺省）：个人 + synced + 插件携带（CC 内置归票 06 独立端点）
 * - workspaceId=<id>：该工作区目录下的 project skill（被 personal 同名遮蔽的不返回）
 */
import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'
import { defaultSkillScanRoots, listGlobalSkills, listWorkspaceSkills, type SkillScanRoots } from '../../skills/skillScanner'

export function createSkillsRoutes(
    getSyncEngine: () => SyncEngine | null,
    roots?: SkillScanRoots,
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/skills', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const scanRoots = roots ?? defaultSkillScanRoots()
        const workspaceId = c.req.query('workspaceId') ?? 'global'

        if (workspaceId === 'global') {
            return c.json({ skills: listGlobalSkills(scanRoots) })
        }

        const workspace = engine.getWorkspace(workspaceId)
        if (!workspace) {
            return c.json({ error: 'Workspace not found' }, 404)
        }
        // 多 folder workspace 以 primary folder 为 skill 扫描根（CC 语义按 cwd 所在目录）
        const primary = workspace.folders.find(f => f.primary) ?? workspace.folders[0]
        if (!primary) {
            return c.json({ error: 'Workspace has no folder' }, 400)
        }
        return c.json({ skills: listWorkspaceSkills(scanRoots, primary.path) })
    })

    return app
}
