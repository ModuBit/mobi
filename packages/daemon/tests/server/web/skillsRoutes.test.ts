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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
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

    /** 票 04/05：fake skills CLI——按子命令模拟语义（remove 删条目+lock；add/update 静默成功），记录调用参数 */
    const skillsCliCalls: { args: string[]; cwd: string }[] = []
    let failSkillsCli: string | null = null
    const fakeSkillsCli = async (args: string[], opts: { cwd: string }) => {
        skillsCliCalls.push({ args, cwd: opts.cwd })
        const name = args[1]!
        if (failSkillsCli === name) return { ok: false, output: `npm error: skill ${name} not found in lock` }
        if (args[0] !== 'remove') return { ok: true, output: `${args[0]} ${name} done` }
        // agent 目录条目（user 级视角；project 级真身语义同理由 CLI 闭环，此处只模拟条目删除）
        rmSync(join(claudeDir, 'skills', name), { recursive: true, force: true })
        // lock 条目与真身同生共死
        const lockPath = join(fixtureRoot, 'agents', '.skill-lock.json')
        if (existsSync(lockPath)) {
            const lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as { skills: Record<string, unknown> }
            delete lock.skills[name]
            writeFileSync(lockPath, JSON.stringify(lock))
        }
        return { ok: true, output: `removed ${name}` }
    }

    /** 票 06：fake bundled 采集与版本探针（可控翻转 + 采集计数） */
    let bundledVersion = '2.1.312'
    let bundledProbeCount = 0
    const fakeBundledVersionProber = async () => bundledVersion
    const fakeBundledProber = async () => {
        bundledProbeCount += 1
        return {
            claudeVersion: bundledVersion,
            skills: [
                { name: 'doctor', description: 'Health-check the setup' },
                { name: 'verify', description: 'Verify a change end-to-end' },
            ],
        }
    }

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
        // 票 04 删除用：untracked 真目录 + untracked symlink（无 lock 条目）
        mkdirSync(join(claudeDir, 'skills', 'del-plain'), { recursive: true })
        writeFileSync(join(claudeDir, 'skills', 'del-plain', 'SKILL.md'), skillMd({ name: 'del-plain' }))
        mkdirSync(join(centralDir, 'skills', 'orphan-target'), { recursive: true })
        writeFileSync(join(centralDir, 'skills', 'orphan-target', 'SKILL.md'), skillMd({ name: 'del-link' }))
        symlinkSync(join(centralDir, 'skills', 'orphan-target'), join(claudeDir, 'skills', 'del-link'))
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
        // user lock（v3）：beta → tracked；gamma → tracked（票 05 update 用，不随票 04 删除用例消耗）
        mkdirSync(join(centralDir, 'skills', 'gamma'), { recursive: true })
        writeFileSync(join(centralDir, 'skills', 'gamma', 'SKILL.md'), skillMd({ name: 'gamma', description: 'Gamma from store' }))
        symlinkSync(join(centralDir, 'skills', 'gamma'), join(claudeDir, 'skills', 'gamma'))
        writeFileSync(join(centralDir, '.skill-lock.json'), JSON.stringify({
            version: 3,
            skills: {
                beta: { source: 'vercel-labs/skills', sourceType: 'github', sourceUrl: 'https://github.com/vercel-labs/skills.git', skillPath: 'skills/beta/SKILL.md' },
                gamma: { source: 'octocat/gamma-skills', sourceType: 'github', skillPath: 'skills/gamma/SKILL.md' },
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
        // 票 04：project untracked 删除用
        mkdirSync(join(wsDir, '.claude', 'skills', 'del-proj'), { recursive: true })
        writeFileSync(join(wsDir, '.claude', 'skills', 'del-proj', 'SKILL.md'), skillMd({ name: 'del-proj' }))

        // ── 起测试 app：注入 fixture 扫描根 ──
        const store = new Store(':memory:')
        const io = { of() { return { sockets: new Map() } } } as unknown as Server
        const registry = { getSocketIdForMethod() { return null } } as unknown as RpcRegistry
        const sseManager = { broadcast: () => {} } as unknown as SSEManager
        const engine = new SyncEngine(store, io, registry, sseManager)

        const setup = await setupTestApp(engine, {
            store,
            skills: {
                scanRoots: {
                    claudeConfigDir: claudeDir,
                    userLockPath: join(centralDir, '.skill-lock.json'),
                    pluginDirs: [pluginDir],
                    managedSettingsPath: join(fixtureRoot, 'managed-settings.json'),
                },
                cliRunner: fakeSkillsCli,
                bundled: {
                    cachePath: join(fixtureRoot, 'bundled-skills.json'),
                    prober: fakeBundledProber,
                    versionProber: fakeBundledVersionProber,
                },
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

    describe('PATCH /api/skills/:name/visibility（写归属层 skillOverrides）', () => {
        async function patchVisibility(name: string, body: object): Promise<{ res: Response; data: any }> {
            const res = await app.request(`/api/skills/${encodeURIComponent(name)}/visibility`, {
                method: 'PATCH',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            return { res, data: res.status === 200 ? await res.json() : null }
        }

        test('personal 开→关：写 user settings 且保留既有键；生效态刷新', async () => {
            const { res, data } = await patchVisibility('alpha', { enabled: false, workspaceId: 'global' })
            expect(res.status).toBe(200)

            // 落盘：新键写入 + 既有 personal-off 键保留（最小侵入）
            const written = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf-8'))
            expect(written.skillOverrides.alpha).toBe('off')
            expect(written.skillOverrides['personal-off']).toBe('off')

            // 响应带回刷新后的行（供前端即时更新遮蔽态）
            expect(data.skill.effectiveState).toBe('off')
            expect(data.skill.ownState).toBe('off')

            // 列表复查
            const { skills } = await listSkills('?workspaceId=global')
            expect(byName(skills, 'alpha')!.effectiveState).toBe('off')

            // 还原（后续用例依赖初始态）
            await patchVisibility('alpha', { enabled: true, workspaceId: 'global' })
        })

        test('managed 压制下的打开：ownState=on 但响应 effectiveState 仍 off（压制反馈）', async () => {
            // alpha 被 managed-settings 压制；写 on 后归属层 on、生效仍 off
            await patchVisibility('alpha', { enabled: true, workspaceId: 'global' })
            const { skills } = await listSkills('?workspaceId=global')
            const alpha = byName(skills, 'alpha')!
            expect(alpha.ownState).toBe('on')
            expect(alpha.effectiveState).toBe('off')
            expect(alpha.effectiveFromLayer).toBe('managed')
        })

        test('project 开关：写 workspace 的 project settings 且保留既有键', async () => {
            const { res } = await patchVisibility('proj-plain', { enabled: false, workspaceId: workspaceId })
            expect(res.status).toBe(200)

            const written = JSON.parse(readFileSync(join(wsDir, '.claude', 'settings.json'), 'utf-8'))
            expect(written.skillOverrides['proj-plain']).toBe('off')
            expect(written.skillOverrides['proj-x']).toBe('off')
            expect(written.skillOverrides['proj-shadow']).toBe('on')

            await patchVisibility('proj-plain', { enabled: true, workspaceId: workspaceId })
        })

        test('只读行（plugin）→ 400', async () => {
            const { res } = await patchVisibility('plug-skill', { enabled: false, workspaceId: 'global' })
            expect(res.status).toBe(400)
        })

        test('无效 workspaceId → 404', async () => {
            const { res } = await patchVisibility('alpha', { enabled: false, workspaceId: 'nope' })
            expect(res.status).toBe(404)
        })

        test('非法 body → 400', async () => {
            const { res } = await patchVisibility('alpha', { enabled: 'yes', workspaceId: 'global' })
            expect(res.status).toBe(400)
        })
    })

    describe('DELETE /api/skills/:name（双路径删除）', () => {
        async function deleteSkill(name: string, query: string): Promise<Response> {
            return app.request(`/api/skills/${encodeURIComponent(name)}${query}`, {
                method: 'DELETE',
                headers: authHeaders,
            })
        }

        test('untracked 真目录：目录删除、中央仓不受影响、列表行消失', async () => {
            const res = await deleteSkill('del-plain', '?workspaceId=global')
            expect(res.status).toBe(200)

            expect(existsSync(join(claudeDir, 'skills', 'del-plain'))).toBe(false)
            const { skills } = await listSkills('?workspaceId=global')
            expect(byName(skills, 'del-plain')).toBeUndefined()
        })

        test('untracked symlink：只删链接不删中央仓真身', async () => {
            const res = await deleteSkill('del-link', '?workspaceId=global')
            expect(res.status).toBe(200)

            // 链接消失，真身仍在（真身归 CLI 语义或用户自管）
            expect(existsSync(join(claudeDir, 'skills', 'del-link'))).toBe(false)
            expect(existsSync(join(fixtureRoot, 'agents', 'skills', 'orphan-target', 'SKILL.md'))).toBe(true)
        })

        test('CLI 失败：502 + 输出透传；条目保持原状', async () => {
            failSkillsCli = 'beta'
            const res = await deleteSkill('beta', '?workspaceId=global')
            failSkillsCli = null

            expect(res.status).toBe(502)
            const data = await res.json() as { error: string }
            expect(data.error).toContain('not found in lock')
            // 失败不动文件系统
            expect(existsSync(join(claudeDir, 'skills', 'beta'))).toBe(true)
        })

        test('tracked：分派 skills CLI（-g + claude-code agent），条目与 lock 由 CLI 语义闭环', async () => {
            const res = await deleteSkill('beta', '?workspaceId=global')
            expect(res.status).toBe(200)

            expect(skillsCliCalls.length).toBe(2)
            expect(skillsCliCalls.at(-1)!.args).toEqual(['remove', 'beta', '-y', '--agent', 'claude-code', '-g'])
            // fake CLI 已按语义删条目与 lock
            expect(existsSync(join(claudeDir, 'skills', 'beta'))).toBe(false)
            const lock = JSON.parse(readFileSync(join(fixtureRoot, 'agents', '.skill-lock.json'), 'utf-8'))
            expect(lock.skills.beta).toBeUndefined()
        })

        test('project untracked：删除 workspace 下 .claude/skills 条目', async () => {
            const res = await deleteSkill('del-proj', `?workspaceId=${workspaceId}`)
            expect(res.status).toBe(200)
            expect(existsSync(join(wsDir, '.claude', 'skills', 'del-proj'))).toBe(false)
        })

        test('未知名 → 404 且不触达 CLI', async () => {
            const res = await deleteSkill('nope', '?workspaceId=global')
            expect(res.status).toBe(404)
            expect(skillsCliCalls.every(c => c.args[1] !== 'nope')).toBe(true)
        })

        test('synced / plugin 行不可删除 → 400', async () => {
            expect((await deleteSkill('cloud-skill', '?workspaceId=global')).status).toBe(400)
            expect((await deleteSkill('plug-skill', '?workspaceId=global')).status).toBe(400)
        })
    })

    describe('POST /api/skills/install（包装 skills add）', () => {
        async function install(body: object): Promise<{ res: Response; data: any }> {
            const res = await app.request('/api/skills/install', {
                method: 'POST',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            return { res, data: res.status === 200 ? await res.json() : null }
        }

        test('global：args 带 -g、cwd=home，symlink 形态不传 --copy', async () => {
            const { res } = await install({ source: 'vercel-labs/skills', scope: 'global' })
            expect(res.status).toBe(200)

            const call = skillsCliCalls.at(-1)!
            expect(call.args).toEqual(['add', 'vercel-labs/skills', '--agent', 'claude-code', '-g'])
            expect(call.args).not.toContain('--copy')
            expect(call.cwd).toBe(homedir())
        })

        test('workspace：无 -g、cwd=workspace（CLI 自动定位 project scope）', async () => {
            const { res } = await install({ source: 'octocat/repo', scope: workspaceId })
            expect(res.status).toBe(200)

            const call = skillsCliCalls.at(-1)!
            expect(call.args).toEqual(['add', 'octocat/repo', '--agent', 'claude-code'])
            expect(call.cwd).toBe(wsDir)
        })

        test('CLI 失败 → 502 + 输出透传', async () => {
            failSkillsCli = 'octocat/repo'
            const { res } = await install({ source: 'octocat/repo', scope: 'global' })
            failSkillsCli = null

            expect(res.status).toBe(502)
            const data = await res.json() as { error: string }
            expect(data.error).toContain('not found in lock')
        })

        test('非法 body（缺 source / 空）→ 400', async () => {
            expect((await install({ scope: 'global' })).res.status).toBe(400)
            expect((await install({ source: '  ', scope: 'global' })).res.status).toBe(400)
            expect((await install({ source: 'x', scope: 'nope' })).res.status).toBe(404)
        })
    })

    describe('POST /api/skills/:name/update（tracked 限定）', () => {
        async function update(name: string, workspaceId: string): Promise<Response> {
            return app.request(`/api/skills/${encodeURIComponent(name)}/update`, {
                method: 'POST',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspaceId }),
            })
        }

        test('tracked global：args 带 -g + -y', async () => {
            const res = await update('gamma', 'global')
            expect(res.status).toBe(200)
            expect(skillsCliCalls.at(-1)!.args).toEqual(['update', 'gamma', '-y', '--agent', 'claude-code', '-g'])
        })

        test('tracked workspace：args 带 -p、cwd=workspace', async () => {
            const res = await update('proj-tracked', workspaceId)
            expect(res.status).toBe(200)
            const call = skillsCliCalls.at(-1)!
            expect(call.args).toEqual(['update', 'proj-tracked', '-y', '--agent', 'claude-code', '-p'])
            expect(call.cwd).toBe(wsDir)
        })

        test('untracked → 400；未知名 → 404', async () => {
            expect((await update('alpha', 'global')).status).toBe(400)
            expect((await update('nope', 'global')).status).toBe(404)
        })
    })

    describe('GET /api/skills/bundled（自采 + 版本化缓存）', () => {
        async function getBundled(): Promise<{ res: Response; data: any }> {
            const res = await app.request('/api/skills/bundled', { headers: authHeaders })
            return { res, data: res.status === 200 ? await res.json() : null }
        }

        test('首访自采返回名单；同版本二次请求纯缓存命中（不再采）', async () => {
            const { res, data } = await getBundled()
            expect(res.status).toBe(200)
            expect(data.version).toBe('2.1.312')
            expect(data.skills.map((s: { name: string }) => s.name)).toEqual(['doctor', 'verify'])
            expect(bundledProbeCount).toBe(1)

            // 版本不变 → 纯缓存
            const { data: again } = await getBundled()
            expect(again.version).toBe('2.1.312')
            expect(bundledProbeCount).toBe(1)
        })

        test('版本升级 → miss 重采返回新版本', async () => {
            bundledVersion = '2.2.0'
            const { data } = await getBundled()
            expect(data.version).toBe('2.2.0')
        })
    })

    describe('POST /api/skills/create-prompt（对话式新建）', () => {
        async function createPrompt(body: object): Promise<{ res: Response; data: any }> {
            const res = await app.request('/api/skills/create-prompt', {
                method: 'POST',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            return { res, data: res.status === 200 ? await res.json() : null }
        }

        test('global scope：目标目录 = claude 配置 skills 根，prompt 含路径与结构引导', async () => {
            const { res, data } = await createPrompt({ scope: 'global' })
            expect(res.status).toBe(200)
            expect(data.targetDir).toBe(join(claudeDir, 'skills'))
            expect(data.prompt).toContain(join(claudeDir, 'skills'))
            expect(data.prompt).toContain('SKILL.md')
            expect(data.prompt).toContain('name:')
            expect(data.prompt).toContain('description:')
        })

        test('workspace scope：目标目录 = workspace .claude/skills', async () => {
            const { res, data } = await createPrompt({ scope: workspaceId })
            expect(res.status).toBe(200)
            expect(data.targetDir).toBe(join(wsDir, '.claude', 'skills'))
            expect(data.prompt).toContain(join(wsDir, '.claude', 'skills'))
        })

        test('未知 scope → 404；非法 body → 400', async () => {
            expect((await createPrompt({ scope: 'nope' })).res.status).toBe(404)
            expect((await createPrompt({})).res.status).toBe(400)
        })
    })
})
