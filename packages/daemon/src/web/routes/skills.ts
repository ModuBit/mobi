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
 * - GET /api/skills?workspaceId=global|<id>：列表（global=个人+synced；插件携带已归系统视角）
 * - PATCH /api/skills/:name/visibility：启停写归属层 skillOverrides（personal→user settings、
 *   project→workspace project settings），响应带回刷新后的行（遮蔽态即时可见）
 * - DELETE /api/skills/:name?workspaceId=：双路径删除——tracked 分派 skills CLI（user 级 -g、
 *   project 级 cwd=workspace），untracked 直接删 agent 目录条目（symlink 只删链接）
 * - POST /api/skills/install：包装 skills add（symlink 形态、只装 claude-code agent）
 * - GET /api/skills/find：skills.sh 生态搜索（= CLI find，用户免知 repo 直接找 skill）
 * - POST /api/skills/:name/update：包装 skills update（tracked 限定）
 * - GET /api/skills/detail：行数据 + SKILL.md 正文 + frontmatter 扩展元数据（点击行按需请求；
 *   global 视角查不到时兜底插件扫描——系统 tab 的插件携带行可点进只读详情）
 * - GET /api/skills/occupancy：有技能的 workspaceId 集合（web tabs 空项目隐藏的数据源）
 * - GET /api/skills/bundled：系统视角名单 = CC 内置（自采 + 版本化缓存，票 06）+ mobi 内置插件携带
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
import { defaultSkillScanRoots, findBundledPluginSkill, listBundledPluginSkills, listGlobalSkills, listWorkspaceSkills, occupiedWorkspaceIds, refreshOverrideFields, type SkillScanRoots } from '../../skills/skillScanner'
import { removeUntrackedSkill } from '../../skills/skillRemoval'
import { defaultSkillsApiClient, mergeAvailableWithInstalled } from '../../skills/skillInventoryClient'
import { getBundledSkills } from '../../skills/bundledSkills'
import { buildSkillCreatePrompt } from '../../skills/skillCreatePrompt'
import { parseSkillDetail } from '../../skills/skillDetail'
import { resolveScope, scopeView, type SkillScope } from '../../skills/skillScope'
import type { SkillsDeps } from '../../skills/skillDeps'
import { writeSkillOverride } from '../../skills/skillSettingsWriter'
import { configuration } from '../../configuration'
import type { SkillInfo } from '@mobi/shared'

/** 在指定视角清单中找目标 skill 行（PATCH 回读刷新值用） */
function findSkill(skills: SkillInfo[], name: string): SkillInfo | undefined {
    return skills.find(s => s.name === name)
}

/**
 * skill 清单变更（装卸/启停/安装）→ 进程内事件总线发布（skill-inventory-changed）。
 * 缓存刷新的编排归订阅方（SdkMetadataRefresher 统一消费）：路由只声明「清单变了」
 * 以及作用面（全局目录 = global；工作区目录 = workspace），发布方不感知消费方。
 * fire-and-forget：订阅侧自带去重/等价闸（无变化不多发 SSE），失败静默（web 兜底 SWR）。
 */
function notifySkillChange(c: Context, engine: SyncEngine, workspaceId: string): void {
    engine.skillInventory.emit({
        type: 'skill-inventory-changed',
        namespace: c.get('namespace'),
        target: workspaceId === SKILL_SCOPE_GLOBAL
            ? { kind: 'global' }
            : { kind: 'workspace', workspaceId },
    })
}

export function createSkillsRoutes(
    getSyncEngine: () => SyncEngine | null,
    deps: SkillsDeps = {},
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    const roots = deps.scanRoots
    const scanRoots = (): SkillScanRoots => roots ?? defaultSkillScanRoots()
    const api = deps.api ?? defaultSkillsApiClient
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
        if (!(await writeSkillOverride(scopeView(scanRoots(), ctx.scope).ownSettingsPath, skillName, parsed.data.enabled ? 'on' : 'off'))) {
            return c.json({ error: 'Settings file is corrupted' }, 500)
        }

        // 回读刷新生效三态（只重读 override 层，不重扫目录——refreshOverrideFields）
        notifySkillChange(c, engine, parsed.data.workspaceId)
        return c.json({ skill: refreshOverrideFields(ctx.skill, scanRoots(), ctx.scope) })
    })

    app.delete('/skills/:name', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const workspaceId = c.req.query('workspaceId') ?? SKILL_SCOPE_GLOBAL
        const ctx = skillContext(c, engine, workspaceId, c.req.param('name'))
        if (ctx instanceof Response) return ctx

        // 能力矩阵单源：deletable=false（synced 下次同步拉回、插件携带归迭代 3）不提供删除
        if (!ctx.skill.deletable) {
            return c.json({ error: 'Skill is managed elsewhere' }, 400)
        }

        if (ctx.skill.tracked) {
            // tracked：agent 条目 + 共享真身 + lock 条目归 skills API 闭环（其他 agent 仍引用时保留真身）
            const result = await api.removeInstalledSkill(ctx.skill.name,
                ctx.scope.kind === 'global' ? { global: true } : { global: false, cwd: ctx.scope.path })
            if (!result.ok) return c.json({ error: result.error ?? 'skills remove failed' }, 502)
            notifySkillChange(c, engine, workspaceId)
            return c.json({ ok: true })
        }

        // untracked：mobi 自管文件，删除前二次校验目标位置
        const result = removeUntrackedSkill(ctx.skill, scanRoots(), ctx.scope)
        if (!result.ok) return c.json({ error: result.error }, 500)
        notifySkillChange(c, engine, workspaceId)
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

    app.get('/skills/detail', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const workspaceId = c.req.query('workspaceId') ?? SKILL_SCOPE_GLOBAL
        const name = c.req.query('name') ?? ''
        const ctx = skillContext(c, engine, workspaceId, name)
        // 插件携带 skill 已归类系统视角（不在个人/项目清单）：global 视角查不到时兜底插件扫描，
        // 系统行可点进详情（只读——overrideable/deletable 均 false）
        const skill = ctx instanceof Response
            ? (workspaceId === SKILL_SCOPE_GLOBAL ? findBundledPluginSkill(scanRoots(), name) : null)
            : ctx.skill
        if (!skill) return ctx instanceof Response ? ctx : c.json({ error: 'Skill not found' }, 404)

        // 正文 + 扩展元数据按需读（列表路径不解析这些）；symlink 行的 path 已归一可读
        const detail = parseSkillDetail(skill.path)
        if (!detail) return c.json({ error: 'Skill file is unreadable' }, 410)
        return c.json({ skill, body: detail.body, meta: detail.meta })
    })

    app.get('/skills/occupancy', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        // 有技能的 workspaceId 集合（web tabs 空项目隐藏的数据源；与列表同口径同名遮蔽判定）
        return c.json({ workspaceIds: occupiedWorkspaceIds(scanRoots(), engine.getWorkspaces(c.get('namespace'))) })
    })

    app.get('/skills/bundled', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        try {
            const result = await getBundledSkills(bundledDeps())
            // 系统视角名单 = CC 内置（自采交集）+ mobi 内置插件携带（扫描合成，行带 pluginName）
            return c.json({ version: result.claudeVersion, skills: [...result.skills, ...listBundledPluginSkills(scanRoots())] })
        } catch (error) {
            // 采集失败明确报错（不伪装空名单）：CLI 不可达 / init 帧缺版本等
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
        }
    })

    /**
     * 两步式安装第一步：repo 内可选清单 × 已装判定（复选框数据源）。
     * 生效态判定（2026-11-17 讨论）：global 视角只看全局已装；project 视角取
     * 全局∪项目并集——全局已装的在项目里同样生效，再装一份纯属冗余（项目覆盖
     * 全局同名版本的高级玩法不经由 UI）。同名异源 = conflict（安装会覆盖别家
     * 真身，源码实锤无保护），UI 须警告。
     */
    app.get('/skills/available', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const source = c.req.query('source')?.trim()
        if (!source) return c.json({ error: 'Missing source' }, 400)
        const workspaceId = c.req.query('workspaceId') ?? SKILL_SCOPE_GLOBAL
        const scope = scopeOrResponse(c, engine, workspaceId)
        if (scope instanceof Response) return scope

        try {
            const { repoSource, skills } = await api.resolveRepoSkills(source)
            // 判定清单：global 视角单份；project 视角并集（两个 scope 的已装都算「已生效」）
            const globalInstalled = await api.listInstalledSkillRefs({ global: true })
            const installedRefs = scope.kind === 'global'
                ? globalInstalled
                : [...globalInstalled, ...await api.listInstalledSkillRefs({ global: false, cwd: scope.path })]
            return c.json({ skills: mergeAvailableWithInstalled(repoSource, skills, installedRefs) })
        } catch (error) {
            // 拉取失败（网络/私有 repo/无 skill）明确报错，不伪装空清单
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
        }
    })

    /**
     * 生态搜索（= skills CLI 的 find）：用户不必先知道 repo，按关键词直接搜
     * skills.sh 注册表；命中项带 source（owner/repo）+ skillId，点选后走
     * available → 选择段安装。搜索失败明确 502（不伪装空结果）。
     */
    app.get('/skills/find', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const query = c.req.query('q')?.trim()
        if (!query) return c.json({ error: 'Missing query' }, 400)

        try {
            return c.json({ skills: await api.searchRegistrySkills(query) })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
        }
    })

    app.post('/skills/install', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const body = await c.req.json().catch(() => null)
        const parsed = SkillInstallSubmissionSchema.safeParse(body)
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)

        // 只要 scope 不取清单（安装目标行尚不存在），直调前奏原子
        const scope = scopeOrResponse(c, engine, parsed.data.scope)
        if (scope instanceof Response) return scope

        // 两步式安装第二步：编程 API（结构化 installed/failed；skills 缺省 = 全装）
        const result = await api.installSelectedSkills(
            parsed.data.source,
            parsed.data.skills ?? null,
            scope.kind === 'global' ? { global: true } : { global: false, cwd: scope.path },
        )
        if (result.installed.length === 0) {
            return c.json({ error: result.failed.map(f => `${f.skill}: ${f.error}`).join('; ') || 'skills install failed' }, 502)
        }
        notifySkillChange(c, engine, parsed.data.scope)
        // 部分成功也 200：installed 已生效，failed 逐项透传给 UI 提示
        return c.json({ ok: true, installed: result.installed, failed: result.failed })
    })

    app.post('/skills/:name/update', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const body = await c.req.json().catch(() => null)
        const parsed = SkillUpdateSubmissionSchema.safeParse(body)
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)

        const ctx = skillContext(c, engine, parsed.data.workspaceId, c.req.param('name'))
        if (ctx instanceof Response) return ctx
        // 更新 = 从 lock 记录的来源重装（skills API 未导出 update；CLI update 本质同此）
        if (!ctx.skill.tracked) return c.json({ error: 'Skill is not tracked' }, 400)

        const result = await api.reinstallSkill(ctx.skill.name, ctx.skill.installSource,
            ctx.scope.kind === 'global' ? { global: true } : { global: false, cwd: ctx.scope.path })
        if (!result.ok) return c.json({ error: result.error ?? 'skills update failed' }, 502)
        // 更新同样变更清单（新版本描述/正文会反映到命令清单），与管理页其他写操作同源发布
        notifySkillChange(c, engine, parsed.data.workspaceId)
        return c.json({ ok: true })
    })

    return app
}
