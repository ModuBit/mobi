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
 * Skills 管理路由（skill-mgmt 票 01/03/04）。
 *
 * - GET /api/skills?workspaceId=global|<id>：列表（global=个人+synced+插件携带；CC 内置归票 06 独立端点）
 * - PATCH /api/skills/:name/visibility：启停写归属层 skillOverrides（personal→user settings、
 *   project→workspace project settings），响应带回刷新后的行（遮蔽态即时可见）
 * - DELETE /api/skills/:name?workspaceId=：双路径删除——tracked 分派 skills CLI（user 级 -g、
 *   project 级 cwd=workspace），untracked 直接删 agent 目录条目（symlink 只删链接）
 */
import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'
import { defaultSkillScanRoots, listGlobalSkills, listWorkspaceSkills, type SkillScanRoots } from '../../skills/skillScanner'
import { defaultSkillsRemoveRunner, removeTrackedSkill, removeUntrackedSkill, type SkillsRemoveRunner } from '../../skills/skillRemover'
import { writeSkillOverride } from '../../skills/skillSettingsWriter'
import type { SkillInfo } from '@mobi/shared'

/** workspaceId → 扫描视角；global 返回 null，未知 id 返回 'not-found'，无 folder 返回 'no-folder' */
function resolveScope(
    engine: SyncEngine,
    workspaceId: string,
): { kind: 'global' } | { kind: 'workspace'; path: string } | { kind: 'not-found' } | { kind: 'no-folder' } {
    if (workspaceId === 'global') return { kind: 'global' }
    const workspace = engine.getWorkspace(workspaceId)
    if (!workspace) return { kind: 'not-found' }
    // 多 folder workspace 以 primary folder 为 skill 扫描根（CC 语义按 cwd 所在目录）
    const primary = workspace.folders.find(f => f.primary) ?? workspace.folders[0]
    if (!primary) return { kind: 'no-folder' }
    return { kind: 'workspace', path: primary.path }
}

/** 在指定视角清单中找目标 skill 行（PATCH 后回读刷新值用） */
function findSkill(skills: SkillInfo[], name: string): SkillInfo | undefined {
    return skills.find(s => s.name === name)
}

export function createSkillsRoutes(
    getSyncEngine: () => SyncEngine | null,
    roots?: SkillScanRoots,
    skillsRemoveRunner: SkillsRemoveRunner = defaultSkillsRemoveRunner,
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/skills', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const scanRoots = roots ?? defaultSkillScanRoots()
        const scope = resolveScope(engine, c.req.query('workspaceId') ?? 'global')
        if (scope.kind === 'not-found') return c.json({ error: 'Workspace not found' }, 404)
        if (scope.kind === 'no-folder') return c.json({ error: 'Workspace has no folder' }, 400)
        const skills = scope.kind === 'global' ? listGlobalSkills(scanRoots) : listWorkspaceSkills(scanRoots, scope.path)
        return c.json({ skills })
    })

    app.patch('/skills/:name/visibility', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const body = await c.req.json().catch(() => null) as { enabled?: unknown; workspaceId?: unknown } | null
        if (!body || typeof body.enabled !== 'boolean' || typeof body.workspaceId !== 'string') {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const scanRoots = roots ?? defaultSkillScanRoots()
        const scope = resolveScope(engine, body.workspaceId)
        if (scope.kind === 'not-found') return c.json({ error: 'Workspace not found' }, 404)
        if (scope.kind === 'no-folder') return c.json({ error: 'Workspace has no folder' }, 400)

        const skillName = c.req.param('name')
        const current = scope.kind === 'global'
            ? findSkill(listGlobalSkills(scanRoots), skillName)
            : findSkill(listWorkspaceSkills(scanRoots, scope.path), skillName)
        // 未知名字与只读行（plugin/synced，skillOverrides 不生效）都不提供开关
        if (!current) return c.json({ error: 'Skill not found' }, 404)
        if (!current.overrideable) return c.json({ error: 'Skill is read-only' }, 400)

        // 归属层：personal → user settings（~/.claude/settings.json）；project → workspace project settings
        const ownSettingsPath = current.source === 'project' && scope.kind === 'workspace'
            ? `${scope.path}/.claude/settings.json`
            : `${scanRoots.claudeConfigDir}/settings.json`

        const state = body.enabled ? 'on' : 'off'
        if (!writeSkillOverride(ownSettingsPath, skillName, state)) {
            return c.json({ error: 'Settings file is corrupted' }, 500)
        }

        // 回读刷新后的行（遮蔽态由多层合成，回读是唯一权威）
        const refreshed = scope.kind === 'global'
            ? findSkill(listGlobalSkills(scanRoots), skillName)
            : findSkill(listWorkspaceSkills(scanRoots, scope.path), skillName)
        return c.json({ skill: refreshed })
    })

    app.delete('/skills/:name', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const scanRoots = roots ?? defaultSkillScanRoots()
        const scope = resolveScope(engine, c.req.query('workspaceId') ?? 'global')
        if (scope.kind === 'not-found') return c.json({ error: 'Workspace not found' }, 404)
        if (scope.kind === 'no-folder') return c.json({ error: 'Workspace has no folder' }, 400)

        const skillName = c.req.param('name')
        const current = scope.kind === 'global'
            ? findSkill(listGlobalSkills(scanRoots), skillName)
            : findSkill(listWorkspaceSkills(scanRoots, scope.path), skillName)
        if (!current) return c.json({ error: 'Skill not found' }, 404)

        // synced 下次同步会拉回、插件携带归迭代 3——都不提供删除
        if (current.source === 'synced' || current.source === 'plugin') {
            return c.json({ error: 'Skill is managed elsewhere' }, 400)
        }

        if (current.tracked) {
            // tracked：真身与 lock 条目归 CLI 语义闭环，mobi 只按 scope 分派
            const result = await removeTrackedSkill(current, scope, skillsRemoveRunner)
            if (!result.ok) return c.json({ error: result.output || 'skills CLI failed' }, 502)
            return c.json({ ok: true })
        }

        // untracked：mobi 自管文件，删除前二次校验目标位置
        const result = removeUntrackedSkill(current, scanRoots, scope)
        if (!result.ok) return c.json({ error: result.error }, 500)
        return c.json({ ok: true })
    })

    return app
}
