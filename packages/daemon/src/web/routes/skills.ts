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
 * Skills 管理路由（skill-mgmt 票 01/03/04/05）。
 *
 * - GET /api/skills?workspaceId=global|<id>：列表（global=个人+synced+插件携带；CC 内置归票 06 独立端点）
 * - PATCH /api/skills/:name/visibility：启停写归属层 skillOverrides（personal→user settings、
 *   project→workspace project settings），响应带回刷新后的行（遮蔽态即时可见）
 * - DELETE /api/skills/:name?workspaceId=：双路径删除——tracked 分派 skills CLI（user 级 -g、
 *   project 级 cwd=workspace），untracked 直接删 agent 目录条目（symlink 只删链接）
 * - POST /api/skills/install：包装 skills add（symlink 形态、只装 claude-code agent）
 * - POST /api/skills/:name/update：包装 skills update（tracked 限定）
 * - GET /api/skills/bundled：CC 内置名单（daemon 自采 + 版本化缓存，票 06）
 *
 * 前奏单源（架构深化候选③）：scope 解析 + 404/400 翻译 + 视角取清单收成
 * scopeOrResponse / listContext / skillContext 三层入口，handler 只留端点差异；
 * scope 与路径派生知识归 skillScope 模块（候选①），依赖声明归 skillDeps（候选⑤）。
 */
import { Hono, type Context } from 'hono'
import { join } from 'node:path'
import {
    SKILL_SCOPE_GLOBAL,
    SkillCreatePromptSubmissionSchema,
    SkillInstallSubmissionSchema,
    SkillUpdateSubmissionSchema,
    SkillVisibilitySubmissionSchema,
} from '@mobi/shared'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'
import { defaultSkillScanRoots, listGlobalSkills, listWorkspaceSkills, refreshOverrideFields, type SkillScanRoots } from '../../skills/skillScanner'
import { defaultSkillsCliRunner, installSkill, removeTrackedSkill, removeUntrackedSkill, updateSkill } from '../../skills/skillCli'
import { getBundledSkills } from '../../skills/bundledSkills'
import { buildSkillCreatePrompt } from '../../skills/skillCreatePrompt'
import { resolveScope, scopeView, type SkillScope } from '../../skills/skillScope'
import type { SkillsDeps } from '../../skills/skillDeps'
import { writeSkillOverride } from '../../skills/skillSettingsWriter'
import { configuration } from '../../configuration'
import type { SkillInfo } from '@mobi/shared'

/** 在指定视角清单中找目标 skill 行（PATCH 回读刷新值用） */
function findSkill(skills: SkillInfo[], name: string): SkillInfo | undefined {
    return skills.find(s => s.name === name)
}

export function createSkillsRoutes(
    getSyncEngine: () => SyncEngine | null,
    deps: SkillsDeps = {},
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const roots = deps.scanRoots
    const scanRoots = (): SkillScanRoots => roots ?? defaultSkillScanRoots()
    const skillsCliRunner = deps.cliRunner ?? defaultSkillsCliRunner
    const bundledDeps = () =>
        deps.bundled ?? { cachePath: join(configuration.dataDir, 'bundled-skills.json') }

    /** scope 解析 + 404/400 翻译（前奏原子；union 沿 requireSyncEngine 手势） */
    const scopeOrResponse = (c: Context, engine: SyncEngine, workspaceId: string): SkillScope | Response => {
        const scope = resolveScope(id => engine.getWorkspace(id), workspaceId)
        if (scope.kind === 'not-found') return c.json({ error: 'Workspace not found' }, 404)
        if (scope.kind === 'no-folder') return c.json({ error: 'Workspace has no folder' }, 400)
        return scope
    }

    /** 视角取清单（listContext 的列表半边，PATCH 回读复用） */
    const listFor = (scope: SkillScope): SkillInfo[] =>
        scope.kind === 'global' ? listGlobalSkills(scanRoots()) : listWorkspaceSkills(scanRoots(), scope.path)

    /** 前奏组合①：scope + 视角清单 */
    const listContext = (c: Context, engine: SyncEngine, workspaceId: string): { skills: SkillInfo[]; scope: SkillScope } | Response => {
        const scope = scopeOrResponse(c, engine, workspaceId)
        if (scope instanceof Response) return scope
        return { skills: listFor(scope), scope }
    }

    /** 前奏组合②：scope + 视角清单 + 目标行（skill 缺失由 handler 翻译语义化 404） */
    const skillContext = (c: Context, engine: SyncEngine, workspaceId: string, skillName: string): { skill: SkillInfo; scope: SkillScope } | Response => {
        const ctx = listContext(c, engine, workspaceId)
        if (ctx instanceof Response) return ctx
        const skill = findSkill(ctx.skills, skillName)
        if (!skill) return c.json({ error: 'Skill not found' }, 404)
        return { skill, scope: ctx.scope }
    }

    app.get('/skills', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const ctx = listContext(c, engine, c.req.query('workspaceId') ?? SKILL_SCOPE_GLOBAL)
        if (ctx instanceof Response) return ctx
        return c.json({ skills: ctx.skills })
    })

    app.patch('/skills/:name/visibility', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const body = await c.req.json().catch(() => null)
        const parsed = SkillVisibilitySubmissionSchema.safeParse(body)
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)

        const skillName = c.req.param('name')
        const ctx = skillContext(c, engine, parsed.data.workspaceId, skillName)
        if (ctx instanceof Response) return ctx
        // 未知名字与只读行（plugin/synced，skillOverrides 不生效）都不提供开关
        if (!ctx.skill.overrideable) return c.json({ error: 'Skill is read-only' }, 400)

        // 归属层：personal → user settings；project → workspace project settings（scopeView 单源派生）
        if (!writeSkillOverride(scopeView(scanRoots(), ctx.scope).ownSettingsPath, skillName, parsed.data.enabled ? 'on' : 'off')) {
            return c.json({ error: 'Settings file is corrupted' }, 500)
        }

        // 回读刷新生效三态（只重读 override 层，不重扫目录——refreshOverrideFields）
        return c.json({ skill: refreshOverrideFields(ctx.skill, scanRoots(), ctx.scope) })
    })

    app.delete('/skills/:name', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const ctx = skillContext(c, engine, c.req.query('workspaceId') ?? SKILL_SCOPE_GLOBAL, c.req.param('name'))
        if (ctx instanceof Response) return ctx

        // 能力矩阵单源：deletable=false（synced 下次同步拉回、插件携带归迭代 3）不提供删除
        if (!ctx.skill.deletable) {
            return c.json({ error: 'Skill is managed elsewhere' }, 400)
        }

        if (ctx.skill.tracked) {
            // tracked：真身与 lock 条目归 CLI 语义闭环，mobi 只按 scope 分派
            const result = await removeTrackedSkill(ctx.skill, ctx.scope, skillsCliRunner)
            if (!result.ok) return c.json({ error: result.output || 'skills CLI failed' }, 502)
            return c.json({ ok: true })
        }

        // untracked：mobi 自管文件，删除前二次校验目标位置
        const result = removeUntrackedSkill(ctx.skill, scanRoots(), ctx.scope)
        if (!result.ok) return c.json({ error: result.error }, 500)
        return c.json({ ok: true })
    })

    app.post('/skills/create-prompt', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const body = await c.req.json().catch(() => null)
        const parsed = SkillCreatePromptSubmissionSchema.safeParse(body)
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)

        // 形态与取清单端点不同（只要 scope），保留直调
        const scope = scopeOrResponse(c, engine, parsed.data.scope)
        if (scope instanceof Response) return scope

        const targetDir = scopeView(scanRoots(), scope).skillRoot
        return c.json({ targetDir, prompt: buildSkillCreatePrompt(targetDir) })
    })

    app.get('/skills/bundled', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        try {
            const result = await getBundledSkills(bundledDeps())
            return c.json({ version: result.claudeVersion, skills: result.skills })
        } catch (error) {
            // 采集失败明确报错（不伪装空名单）：CLI 不可达 / init 帧缺版本等
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
        }
    })

    app.post('/skills/install', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const body = await c.req.json().catch(() => null)
        // source 已 trim 校验，透传 argv 单元素（不经 shell，无注入面）
        const parsed = SkillInstallSubmissionSchema.safeParse(body)
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)

        // 只要 scope 不取清单（安装目标行尚不存在），直调前奏原子
        const scope = scopeOrResponse(c, engine, parsed.data.scope)
        if (scope instanceof Response) return scope

        const result = await installSkill(parsed.data.source, scope, skillsCliRunner)
        if (!result.ok) return c.json({ error: result.output || 'skills CLI failed' }, 502)
        return c.json({ ok: true })
    })

    app.post('/skills/:name/update', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const body = await c.req.json().catch(() => null)
        const parsed = SkillUpdateSubmissionSchema.safeParse(body)
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)

        const ctx = skillContext(c, engine, parsed.data.workspaceId, c.req.param('name'))
        if (ctx instanceof Response) return ctx
        // 更新走 CLI 渠道语义，只对 tracked 行有意义
        if (!ctx.skill.tracked) return c.json({ error: 'Skill is not tracked' }, 400)

        const result = await updateSkill(ctx.skill, ctx.scope, skillsCliRunner)
        if (!result.ok) return c.json({ error: result.output || 'skills CLI failed' }, 502)
        return c.json({ ok: true })
    })

    return app
}
