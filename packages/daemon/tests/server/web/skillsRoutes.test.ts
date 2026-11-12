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
 * GET /api/skills 集成测试（skill-mgmt 票 01）。
 *
 * 外部行为断言（HTTP 响应形状），扫描器实现细节不可见：
 * - 来源五类中的四类（bundled 归票 06）/ 渠道（两把 lock）/ 形态（symlink/真目录）
 * - 生效态四层合成（managed > local > project > user）与归属层 ownState
 * - 同名裁决（personal 胜 project；本地胜 synced）/ 损坏条目隐藏
 */
import { homedir, tmpdir } from 'node:os'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import type { Server } from 'socket.io'
import { SyncEngine } from '../../../src/sync/syncEngine'
import { Store } from '../../../src/store'
import type { RpcRegistry } from '../../../src/socket/rpcRegistry'
import type { SSEManager } from '../../../src/sse/sseManager'
import { setupTestApp, getAuthToken } from '../helpers/setupTestApp'
import type { SkillInfo } from '@mobi/shared'

/** workspaces 路由校验 folders 须落在宿主 home 内（401 起硬约束） */
const HOST_HOME = homedir()

/** SKILL.md 载体（frontmatter + 正文） */
function skillMd(frontmatter: Record<string, unknown> | string, body = 'instructions'): string {
    if (typeof frontmatter === 'string') return frontmatter
    const lines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`)
    return `---\n${lines.join('\n')}\n---\n\n${body}\n`
}

/** 便捷取行 */
function byName(skills: SkillInfo[], name: string): SkillInfo | undefined {
    return skills.find(s => s.name === name)
}

describe('skills REST 路由（GET /api/skills）', () => {
    let app: ReturnType<typeof import('../../../src/web/server').createWebApp>
    let cleanupApp: () => void
    let authHeaders: Record<string, string>
    let workspaceId: string

    let fixtureRoot: string
    let wsDir: string
    let claudeDir: string

    beforeAll(async () => {
        // ── fixture：假 ~/.claude、假中央仓 + user lock、假插件、假 managed settings ──
        fixtureRoot = mkdtempSync(join(tmpdir(), 'mobi-skill-fx-'))
        claudeDir = join(fixtureRoot, 'claude')
        const centralDir = join(fixtureRoot, 'agents')
        const pluginDir = join(fixtureRoot, 'plugins', 'demo-plugin')

        // 个人 skills
        mkdirSync(join(claudeDir, 'skills', 'alpha'), { recursive: true })
        writeFileSync(join(claudeDir, 'skills', 'alpha', 'SKILL.md'), skillMd({ name: 'alpha', description: 'Alpha personal skill' }))
        // symlink 形态 + tracked（user lock）
        mkdirSync(join(centralDir, 'skills', 'beta'), { recursive: true })
        writeFileSync(join(centralDir, 'skills', 'beta', 'SKILL.md'), skillMd({ name: 'beta', description: 'From central store' }))
        symlinkSync(join(centralDir, 'skills', 'beta'), join(claudeDir, 'skills', 'beta'))
        // 损坏：无 SKILL.md
        mkdirSync(join(claudeDir, 'skills', 'no-md'), { recursive: true })
        // 损坏：frontmatter 不可解析
        mkdirSync(join(claudeDir, 'skills', 'bad-yaml'), { recursive: true })
        writeFileSync(join(claudeDir, 'skills', 'bad-yaml', 'SKILL.md'), '---\nname: [unclosed\n---\nbody\n')
        // user 层 off 的个人 skill
        mkdirSync(join(claudeDir, 'skills', 'personal-off'), { recursive: true })
        writeFileSync(join(claudeDir, 'skills', 'personal-off', 'SKILL.md'), skillMd({ name: 'personal-off' }))
        // 与 synced 同名（本地胜）
        mkdirSync(join(claudeDir, 'skills', 'dup-local'), { recursive: true })
        writeFileSync(join(claudeDir, 'skills', 'dup-local', 'SKILL.md'), skillMd({ name: 'dup-local' }))
        // synced（claude.ai 同步保留目录）
        mkdirSync(join(claudeDir, 'skills', 'synced', 'cloud-skill'), { recursive: true })
        writeFileSync(join(claudeDir, 'skills', 'synced', 'cloud-skill', 'SKILL.md'), skillMd({ name: 'cloud-skill', description: 'From claude.ai' }))
        mkdirSync(join(claudeDir, 'skills', 'synced', 'dup-local'), { recursive: true })
        writeFileSync(join(claudeDir, 'skills', 'synced', 'dup-local', 'SKILL.md'), skillMd({ name: 'dup-local' }))

        // user settings：personal-off → off（归属层即 user）
        writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
            skillOverrides: { 'personal-off': 'off' },
        }))
        // user lock（v3）：beta → tracked
        writeFileSync(join(centralDir, '.skill-lock.json'), JSON.stringify({
            version: 3,
            skills: {
                beta: { source: 'vercel-labs/skills', sourceType: 'github', sourceUrl: 'https://github.com/vercel-labs/skills.git', skillPath: 'skills/beta/SKILL.md' },
            },
        }))
        // 假插件 skill
        mkdirSync(join(pluginDir, 'skills', 'plug-skill'), { recursive: true })
        writeFileSync(join(pluginDir, 'skills', 'plug-skill', 'SKILL.md'), skillMd({ name: 'plug-skill', description: 'From plugin' }))
        // managed settings：alpha → off（最高层，压制一切）
        writeFileSync(join(fixtureRoot, 'managed-settings.json'), JSON.stringify({
            skillOverrides: { alpha: 'off' },
        }))

        // ── fixture：workspace（须落宿主 home 内）──
        wsDir = mkdtempSync(join(HOST_HOME, 'mobi-skill-test-ws-'))
        mkdirSync(join(wsDir, '.claude', 'skills', 'proj-plain'), { recursive: true })
        writeFileSync(join(wsDir, '.claude', 'skills', 'proj-plain', 'SKILL.md'), skillMd({ name: 'proj-plain', description: 'Project skill' }))
        // tracked project skill（project lock 在 ws 根）
        mkdirSync(join(wsDir, '.claude', 'skills', 'proj-tracked'), { recursive: true })
        writeFileSync(join(wsDir, '.claude', 'skills', 'proj-tracked', 'SKILL.md'), skillMd({ name: 'proj-tracked' }))
        writeFileSync(join(wsDir, 'skills-lock.json'), JSON.stringify({
            version: 1,
            skills: {
                'proj-tracked': { source: 'octocat/repo', sourceType: 'github' },
            },
        }))
        // 与个人同名 → personal 胜，ws 视角不返回
        mkdirSync(join(wsDir, '.claude', 'skills', 'dup-local'), { recursive: true })
        writeFileSync(join(wsDir, '.claude', 'skills', 'dup-local', 'SKILL.md'), skillMd({ name: 'dup-local' }))
        // project settings：proj-x → off；proj-shadow on（被 local off 遮蔽）
        mkdirSync(join(wsDir, '.claude', 'skills', 'proj-x'), { recursive: true })
        writeFileSync(join(wsDir, '.claude', 'skills', 'proj-x', 'SKILL.md'), skillMd({ name: 'proj-x' }))
        mkdirSync(join(wsDir, '.claude', 'skills', 'proj-shadow'), { recursive: true })
        writeFileSync(join(wsDir, '.claude', 'skills', 'proj-shadow', 'SKILL.md'), skillMd({ name: 'proj-shadow' }))
        writeFileSync(join(wsDir, '.claude', 'settings.json'), JSON.stringify({
            skillOverrides: { 'proj-x': 'off', 'proj-shadow': 'on' },
        }))
        writeFileSync(join(wsDir, '.claude', 'settings.local.json'), JSON.stringify({
            skillOverrides: { 'proj-shadow': 'off' },
        }))

        // ── 起测试 app：注入 fixture 扫描根 ──
        const store = new Store(':memory:')
        const io = { of() { return { sockets: new Map() } } } as unknown as Server
        const registry = { getSocketIdForMethod() { return null } } as unknown as RpcRegistry
        const sseManager = { broadcast: () => {} } as unknown as SSEManager
        const engine = new SyncEngine(store, io, registry, sseManager)

        const setup = await setupTestApp(engine, {
            store,
            skillsScanRoots: {
                claudeConfigDir: claudeDir,
                userLockPath: join(centralDir, '.skill-lock.json'),
                pluginDirs: [pluginDir],
                managedSettingsPath: join(fixtureRoot, 'managed-settings.json'),
            },
        })
        app = setup.app
        cleanupApp = () => {
            setup.cleanup()
            engine.stop()
        }
        const token = await getAuthToken(app)
        authHeaders = { Authorization: `Bearer ${token}` }

        const res = await app.request('/api/workspaces', {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'skill-test-ws', folders: [{ path: wsDir, primary: true }] }),
        })
        const data = await res.json() as { workspace?: { id: string } }
        expect(data.workspace).toBeDefined()
        workspaceId = data.workspace!.id
    })

    afterAll(() => {
        cleanupApp()
        rmSync(fixtureRoot, { recursive: true, force: true })
        rmSync(wsDir, { recursive: true, force: true })
    })

    async function listSkills(query: string): Promise<{ res: Response; skills: SkillInfo[] }> {
        const res = await app.request(`/api/skills${query}`, { headers: authHeaders })
        const body = res.status === 200 ? await res.json() as { skills: SkillInfo[] } : { skills: [] }
        return { res, skills: body.skills }
    }

    describe('global 视角（workspaceId=global）', () => {
        test('个人真目录 skill：完整字段', async () => {
            const { skills } = await listSkills('?workspaceId=global')
            const alpha = byName(skills, 'alpha')
            expect(alpha).toBeDefined()
            expect(alpha!.source).toBe('personal')
            expect(alpha!.form).toBe('directory')
            expect(alpha!.description).toBe('Alpha personal skill')
            expect(alpha!.overrideable).toBe(true)
            expect(alpha!.tracked).toBe(false)
        })

        test('managed 层压制：alpha 生效态 off（fromLayer=managed）且遮蔽归属层', async () => {
            const { skills } = await listSkills('?workspaceId=global')
            const alpha = byName(skills, 'alpha')!
            expect(alpha.effectiveState).toBe('off')
            expect(alpha.effectiveFromLayer).toBe('managed')
            expect(alpha.ownState).toBeNull()
        })

        test('symlink 形态 + user lock → tracked + installSource + symlinkTarget', async () => {
            const { skills } = await listSkills('?workspaceId=global')
            const beta = byName(skills, 'beta')!
            expect(beta.form).toBe('symlink')
            expect(beta.tracked).toBe(true)
            expect(beta.installSource).toBe('vercel-labs/skills')
            expect(beta.symlinkTarget).toContain('beta')
        })

        test('synced 来源标注', async () => {
            const { skills } = await listSkills('?workspaceId=global')
            const cloud = byName(skills, 'cloud-skill')!
            expect(cloud.source).toBe('synced')
        })

        test('本地胜 synced：dup-local 只出现一次且 source=personal', async () => {
            const { skills } = await listSkills('?workspaceId=global')
            const dups = skills.filter(s => s.name === 'dup-local')
            expect(dups).toHaveLength(1)
            expect(dups[0]!.source).toBe('personal')
        })

        test('插件 skill：只读行（overrideable=false + pluginName）', async () => {
            const { skills } = await listSkills('?workspaceId=global')
            const plug = byName(skills, 'plug-skill')!
            expect(plug.source).toBe('plugin')
            expect(plug.overrideable).toBe(false)
            expect(plug.pluginName).toBe('demo-plugin')
        })

        test('损坏条目隐藏（无 SKILL.md / frontmatter 坏）', async () => {
            const { skills } = await listSkills('?workspaceId=global')
            expect(byName(skills, 'no-md')).toBeUndefined()
            expect(byName(skills, 'bad-yaml')).toBeUndefined()
        })

        test('user 层 off：effectiveState=off 且 ownState=off（归属层即 user）', async () => {
            const { skills } = await listSkills('?workspaceId=global')
            const off = byName(skills, 'personal-off')!
            expect(off.effectiveState).toBe('off')
            expect(off.effectiveFromLayer).toBe('user')
            expect(off.ownState).toBe('off')
        })
    })

    describe('workspace 视角', () => {
        test('project skills + project lock tracked', async () => {
            const { skills } = await listSkills(`?workspaceId=${workspaceId}`)
            const plain = byName(skills, 'proj-plain')!
            expect(plain.source).toBe('project')
            expect(plain.tracked).toBe(false)

            const tracked = byName(skills, 'proj-tracked')!
            expect(tracked.tracked).toBe(true)
            expect(tracked.installSource).toBe('octocat/repo')
        })

        test('project 层 off：ownState=off', async () => {
            const { skills } = await listSkills(`?workspaceId=${workspaceId}`)
            const projX = byName(skills, 'proj-x')!
            expect(projX.effectiveState).toBe('off')
            expect(projX.effectiveFromLayer).toBe('project')
            expect(projX.ownState).toBe('off')
        })

        test('local 层遮蔽 project 层：ownState=on 但 effective=off', async () => {
            const { skills } = await listSkills(`?workspaceId=${workspaceId}`)
            const shadow = byName(skills, 'proj-shadow')!
            expect(shadow.ownState).toBe('on')
            expect(shadow.effectiveState).toBe('off')
            expect(shadow.effectiveFromLayer).toBe('local')
        })

        test('与个人同名的 project skill 不返回（personal 胜）', async () => {
            const { skills } = await listSkills(`?workspaceId=${workspaceId}`)
            const dups = skills.filter(s => s.name === 'dup-local')
            expect(dups).toHaveLength(0)
        })

        test('无效 workspaceId → 404', async () => {
            const { res } = await listSkills('?workspaceId=nope')
            expect(res.status).toBe(404)
        })
    })

    test('缺省 workspaceId 默认 global 视角', async () => {
        const { res, skills } = await listSkills('')
        expect(res.status).toBe(200)
        expect(byName(skills, 'alpha')).toBeDefined()
        expect(byName(skills, 'proj-plain')).toBeUndefined()
    })
})
