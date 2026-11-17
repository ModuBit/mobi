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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import type { Server } from 'socket.io'
import { SyncEngine } from '../../../src/sync/syncEngine'
import { Store } from '../../../src/store'
import type { RpcRegistry } from '../../../src/socket/rpcRegistry'
import type { SSEManager } from '../../../src/sse/sseManager'
import { setupTestApp, getAuthToken } from '../helpers/setupTestApp'
import type { SkillInfo, SkillAvailableInfo } from '@mobi/shared'
import type { SkillInventoryChangedEvent } from '../../../src/sync/skillInventoryBus'
import type { SkillsApiClient } from '../../../src/skills/skillInventoryClient'

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
    let engine: SyncEngine

    let fixtureRoot: string
    let wsDir: string
    let claudeDir: string

    /** tracked 单动作 fake（remove/reinstall）：记录调用参数，成功时按真实语义改 fixture。
     *  failRemoveSkill 控制卸载失败分支（错误文案透传） */
    const removeCalls: { name: string; global: boolean; cwd?: string }[] = []
    const reinstallCalls: { name: string; source: string | null | undefined; global: boolean; cwd?: string }[] = []
    let failRemoveSkill: string | null = null
    const fakeRemoveInstalledSkill = async (name: string, opts: { global: boolean; cwd?: string }) => {
        removeCalls.push({ name, ...opts })
        if (failRemoveSkill === name) return { ok: false, error: `npm error: skill ${name} not found in lock` }
        // 语义模拟：删 agent 条目 + lock 条目（global → claudeDir + user lock；project → ws 下两处）
        if (opts.global) {
            rmSync(join(claudeDir, 'skills', name), { recursive: true, force: true })
            const lockPath = join(fixtureRoot, 'agents', '.skill-lock.json')
            if (existsSync(lockPath)) {
                const lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as { skills: Record<string, unknown> }
                delete lock.skills[name]
                writeFileSync(lockPath, JSON.stringify(lock))
            }
        } else {
            rmSync(join(opts.cwd!, '.claude', 'skills', name), { recursive: true, force: true })
            const lockPath = join(opts.cwd!, 'skills-lock.json')
            if (existsSync(lockPath)) {
                const lock = JSON.parse(readFileSync(lockPath, 'utf-8')) as { skills: Record<string, unknown> }
                delete lock.skills[name]
                writeFileSync(lockPath, JSON.stringify(lock))
            }
        }
        return { ok: true }
    }
    const fakeReinstallSkill = async (name: string, source: string | null | undefined, opts: { global: boolean; cwd?: string }) => {
        reinstallCalls.push({ name, source, ...opts })
        return { ok: true }
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

    /** 两步式安装 fake API（编程接口语义；repo 清单/已装清单/install 结果均可控翻转） */
    const apiCalls: { method: string; source: string; names: string[] | null; global: boolean; cwd?: string }[] = []
    let fakeRepo: { repoSource: string; skills: { name: string; description: string }[] } = { repoSource: 'octocat/repo', skills: [] }
    let fakeInstalledGlobal: { name: string; source: string | null }[] = []
    let fakeInstalledProject: { name: string; source: string | null }[] = []
    let fakeInstallResult: { installed: string[]; failed: Array<{ skill: string; error: string }> } = { installed: [], failed: [] }
    /** 非空时 resolveRepoSkills 抛错（拉取失败 502 分支翻转） */
    let failRepoResolve: string | null = null
    /** 非空时 installSelectedSkills 抛错（未结构化错误 → 502 分支翻转） */
    let failInstall: string | null = null
    /** 生态搜索 fake：记录 query + 可控命中/失败 */
    const findCalls: string[] = []
    let fakeFindResults: { name: string; source: string; skillId: string; installs: number }[] = []
    let failFind: string | null = null
    const fakeSkillsApi: SkillsApiClient = {
        resolveRepoSkills: async (source) => {
            if (failRepoResolve) throw new Error(failRepoResolve)
            apiCalls.push({ method: 'resolveRepoSkills', source, names: null, global: false })
            return fakeRepo
        },
        listInstalledSkillRefs: async (opts) => {
            apiCalls.push({ method: 'listInstalledSkillRefs', source: '', names: null, global: opts.global, cwd: opts.cwd })
            // 与生产实现同口径：条目按查询作用域盖章（两层同名各自存在）
            const refs = opts.global ? fakeInstalledGlobal : fakeInstalledProject
            return refs.map(ref => ({ ...ref, scope: opts.global ? 'global' as const : 'workspace' as const }))
        },
        installSelectedSkills: async (source, names, opts) => {
            apiCalls.push({ method: 'installSelectedSkills', source, names, global: opts.global, cwd: opts.cwd })
            if (failInstall) throw new Error(failInstall)
            return fakeInstallResult
        },
        removeInstalledSkill: fakeRemoveInstalledSkill,
        reinstallSkill: fakeReinstallSkill,
        searchRegistrySkills: async (query) => {
            findCalls.push(query)
            if (failFind) throw new Error(failFind)
            return fakeFindResults
        },
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

        // user settings：personal-off → off（归属层即 user）；"Code Review" 原始大小写键
        // （CC 手写形态——读侧须归一化命中，见 resolveOverride 用例）
        writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({
            skillOverrides: { 'personal-off': 'off', 'Code Review': 'off' },
        }))
        // frontmatter 名含大小写与空白（settings 键同形原始名；dir 名与 name 无需一致）
        mkdirSync(join(claudeDir, 'skills', 'review-dir'), { recursive: true })
        writeFileSync(join(claudeDir, 'skills', 'review-dir', 'SKILL.md'), skillMd({ name: 'Code Review', description: 'Override key normalization' }))
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
        engine = new SyncEngine(store, io, registry, sseManager)

        const setup = await setupTestApp(engine, {
            store,
            skills: {
                scanRoots: {
                    claudeConfigDir: claudeDir,
                    userLockPath: join(centralDir, '.skill-lock.json'),
                    pluginDirs: [pluginDir],
                    managedSettingsPath: join(fixtureRoot, 'managed-settings.json'),
                },
                api: fakeSkillsApi,
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

        test('插件携带 skill 不在个人视角（已归类系统视角 bundled 端点）', async () => {
            const { skills } = await listSkills('?workspaceId=global')
            expect(byName(skills, 'plug-skill')).toBeUndefined()
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

        test('settings 键原始大小写/空白（CC 手写形态）经归一化命中（code-review 修复）', async () => {
            const { skills } = await listSkills('?workspaceId=global')
            const row = byName(skills, 'Code Review')!
            // 修复前：键 "Code Review" 查不到 → effectiveState=null，UI 与 CC 真实停用态脱节
            expect(row.effectiveState).toBe('off')
            expect(row.effectiveFromLayer).toBe('user')
            expect(row.ownState).toBe('off')
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

        test('插件携带 skill 不在清单 → 404（启停对系统行无意义）', async () => {
            const { res } = await patchVisibility('plug-skill', { enabled: false, workspaceId: 'global' })
            expect(res.status).toBe(404)
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

        test('untracked 目录名 ≠ frontmatter name：可删（realpath 校验才是边界，code-review 修复）', async () => {
            // fixture review-dir 的 frontmatter name 为 "Code Review"（含大小写空白）——
            // 修复前 basename!==name 拒删 500，任何命名差异的合法 skill 都删不掉
            const res = await deleteSkill('Code Review', '?workspaceId=global')
            expect(res.status).toBe(200)
            expect(existsSync(join(claudeDir, 'skills', 'review-dir'))).toBe(false)
        })

        test('untracked symlink：只删链接不删中央仓真身', async () => {
            const res = await deleteSkill('del-link', '?workspaceId=global')
            expect(res.status).toBe(200)

            // 链接消失，真身仍在（真身归 CLI 语义或用户自管）
            expect(existsSync(join(claudeDir, 'skills', 'del-link'))).toBe(false)
            expect(existsSync(join(fixtureRoot, 'agents', 'skills', 'orphan-target', 'SKILL.md'))).toBe(true)
        })

        test('API 失败：502 + 错误透传；条目保持原状', async () => {
            failRemoveSkill = 'beta'
            const res = await deleteSkill('beta', '?workspaceId=global')
            failRemoveSkill = null

            expect(res.status).toBe(502)
            const data = await res.json() as { error: string }
            expect(data.error).toContain('not found in lock')
            // 失败不动文件系统
            expect(existsSync(join(claudeDir, 'skills', 'beta'))).toBe(true)
        })

        test('tracked：走 removeInstalledSkill API（global=true），条目与 lock 由 API 语义闭环', async () => {
            const res = await deleteSkill('beta', '?workspaceId=global')
            expect(res.status).toBe(200)

            expect(removeCalls.at(-1)).toMatchObject({ name: 'beta', global: true })
            // fake API 已按语义删条目与 lock
            expect(existsSync(join(claudeDir, 'skills', 'beta'))).toBe(false)
            const lock = JSON.parse(readFileSync(join(fixtureRoot, 'agents', '.skill-lock.json'), 'utf-8'))
            expect(lock.skills.beta).toBeUndefined()
        })

        test('project untracked：删除 workspace 下 .claude/skills 条目', async () => {
            const res = await deleteSkill('del-proj', `?workspaceId=${workspaceId}`)
            expect(res.status).toBe(200)
            expect(existsSync(join(wsDir, '.claude', 'skills', 'del-proj'))).toBe(false)
        })

        test('未知名 → 404 且不触达 remove API', async () => {
            const before = removeCalls.length
            const res = await deleteSkill('nope', '?workspaceId=global')
            expect(res.status).toBe(404)
            expect(removeCalls.length).toBe(before)
        })

        test('synced 行不可删除 → 400；插件携带行不在清单 → 404', async () => {
            expect((await deleteSkill('cloud-skill', '?workspaceId=global')).status).toBe(400)
            expect((await deleteSkill('plug-skill', '?workspaceId=global')).status).toBe(404)
        })
    })

    describe('POST /api/skills/install（两步式安装第二步：编程 API）', () => {
        async function install(body: object): Promise<{ res: Response; data: any }> {
            const res = await app.request('/api/skills/install', {
                method: 'POST',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            return { res, data: res.status === 200 ? await res.json() : null }
        }

        test('global：installSelectedSkills(global=true)，勾选清单透传', async () => {
            fakeInstallResult = { installed: ['a', 'b'], failed: [] }
            const { res, data } = await install({ source: 'vercel-labs/skills', scope: 'global', skills: ['a', 'b'] })
            expect(res.status).toBe(200)
            expect(data.ok).toBe(true)
            expect(data.installed).toEqual(['a', 'b'])

            const call = apiCalls.filter(c => c.method === 'installSelectedSkills').at(-1)!
            expect(call.source).toBe('vercel-labs/skills')
            expect(call.names).toEqual(['a', 'b'])
            expect(call.global).toBe(true)
        })

        test('workspace：global=false + cwd=workspace；不传 skills = 全装（null 透传）', async () => {
            fakeInstallResult = { installed: ['a'], failed: [] }
            const { res } = await install({ source: 'octocat/repo', scope: workspaceId })
            expect(res.status).toBe(200)

            const call = apiCalls.filter(c => c.method === 'installSelectedSkills').at(-1)!
            expect(call.names).toBeNull()
            expect(call.global).toBe(false)
            expect(call.cwd).toBe(wsDir)
        })

        test('部分成功 → 200 + failed 逐项透传；全部失败 → 502', async () => {
            fakeInstallResult = { installed: ['a'], failed: [{ skill: 'b', error: 'dir not writable' }] }
            const ok = await install({ source: 'octocat/repo', scope: 'global', skills: ['a', 'b'] })
            expect(ok.res.status).toBe(200)
            expect((ok.data as { failed: unknown[] }).failed).toHaveLength(1)

            fakeInstallResult = { installed: [], failed: [{ skill: 'b', error: 'dir not writable' }] }
            const bad = await install({ source: 'octocat/repo', scope: 'global' })
            expect(bad.res.status).toBe(502)
            const err = await bad.res.json() as { error: string }
            expect(err.error).toContain('b: dir not writable')
        })

        test('API 抛错（CLI 进程异常等）→ 502 + 原始信息，不落成裸 500', async () => {
            failInstall = 'skills CLI crashed'
            try {
                const res = await install({ source: 'octocat/repo', scope: 'global', skills: ['a'] })
                expect(res.res.status).toBe(502)
                const err = await res.res.json() as { error: string }
                expect(err.error).toContain('skills CLI crashed')
            } finally {
                failInstall = null
            }
        })

        test('非法 body（缺 source / 空）→ 400', async () => {
            expect((await install({ scope: 'global' })).res.status).toBe(400)
            expect((await install({ source: '  ', scope: 'global' })).res.status).toBe(400)
            expect((await install({ source: 'x', scope: 'nope' })).res.status).toBe(404)
        })
    })

    describe('GET /api/skills/available（两步式安装第一步：repo 清单 × 已装判定）', () => {
        async function available(source: string, workspaceId?: string): Promise<{ res: Response; skills: SkillAvailableInfo[] }> {
            const qs = workspaceId ? `&workspaceId=${workspaceId}` : ''
            const res = await app.request(`/api/skills/available?source=${encodeURIComponent(source)}${qs}`, { headers: authHeaders })
            const body = res.status === 200 ? await res.json() as { skills: SkillAvailableInfo[] } : { skills: [] }
            return { res, skills: body.skills }
        }

        test('global 视角：本 repo 已装 → installed；异源同名 → conflict；未装 → 均否', async () => {
            fakeRepo = {
                repoSource: 'octocat/repo',
                skills: [
                    { name: 'a', description: 'installed from this repo' },
                    { name: 'b', description: 'same name from elsewhere' },
                    { name: 'c', description: 'not installed' },
                ],
            }
            fakeInstalledGlobal = [
                { name: 'a', source: 'octocat/repo' },
                { name: 'b', source: 'other/repo' },
            ]
            fakeInstalledProject = []

            apiCalls.length = 0
            const { res, skills } = await available('octocat/repo')
            expect(res.status).toBe(200)
            expect(skills.find(s => s.name === 'a')).toMatchObject({ installed: true, conflict: false })
            expect(skills.find(s => s.name === 'b')).toMatchObject({ installed: false, conflict: true })
            expect(skills.find(s => s.name === 'c')).toMatchObject({ installed: false, conflict: false })
        })

        test('project 视角：全局已装也算生效（并集判定，a 场景）', async () => {
            fakeRepo = { repoSource: 'octocat/repo', skills: [{ name: 'a', description: 'global-installed' }, { name: 'b', description: 'proj-installed' }] }
            fakeInstalledGlobal = [{ name: 'a', source: 'octocat/repo' }]
            fakeInstalledProject = [{ name: 'b', source: 'octocat/repo' }]

            apiCalls.length = 0
            const { skills } = await available('octocat/repo', workspaceId)
            expect(skills.find(s => s.name === 'a')).toMatchObject({ installed: true })
            expect(skills.find(s => s.name === 'b')).toMatchObject({ installed: true })
            // 判定清单确实取了并集（两次 listInstalled）
            expect(apiCalls.filter(c => c.method === 'listInstalledSkillRefs')).toHaveLength(2)
        })

        test('project 视角：项目层同名条目覆盖全局异源条目 → installed（不再误报 conflict）', async () => {
            fakeRepo = { repoSource: 'octocat/repo', skills: [{ name: 'a', description: 'proj overrides global' }] }
            fakeInstalledGlobal = [{ name: 'a', source: 'other/repo' }]
            fakeInstalledProject = [{ name: 'a', source: 'octocat/repo' }]

            apiCalls.length = 0
            const { skills } = await available('octocat/repo', workspaceId)
            expect(skills[0]).toMatchObject({ installed: true, conflict: false })
        })

        test('global 视角不看项目清单（b 场景：项目装的不挡全局安装）', async () => {
            fakeRepo = { repoSource: 'octocat/repo', skills: [{ name: 'b', description: 'proj-only' }] }
            fakeInstalledGlobal = []
            fakeInstalledProject = [{ name: 'b', source: 'octocat/repo' }]

            apiCalls.length = 0
            const { skills } = await available('octocat/repo')
            expect(skills[0]).toMatchObject({ installed: false, conflict: false })
            expect(apiCalls.filter(c => c.method === 'listInstalledSkillRefs')).toHaveLength(1)
        })

        test('拉取失败（网络/私有 repo）→ 502 明确报错；缺 source → 400', async () => {
            failRepoResolve = 'clone failed'
            const { res } = await available('octocat/repo')
            failRepoResolve = null
            expect(res.status).toBe(502)
            const err = await res.json() as { error: string }
            expect(err.error).toBe('clone failed')
            expect((await available('', 'global')).res.status).toBe(400)
        })
    })

    describe('GET /api/skills/find（生态搜索：免知 repo 直接找 skill）', () => {
        test('关键词透传 API，命中清单原样返回（source/skillId/installs）', async () => {
            fakeFindResults = [
                { name: 'pdf', source: 'anthropics/skills', skillId: 'pdf', installs: 231296 },
                { name: 'pdf-ocr', source: 'claude-office-skills/skills', skillId: 'pdf-ocr-extraction', installs: 5963 },
            ]
            findCalls.length = 0
            const res = await app.request('/api/skills/find?q=pdf', { headers: authHeaders })
            expect(res.status).toBe(200)
            const body = await res.json() as { skills: typeof fakeFindResults }
            expect(body.skills).toEqual(fakeFindResults)
            expect(findCalls).toEqual(['pdf'])
        })

        test('缺 q / 纯空白 → 400 且不触达 API', async () => {
            findCalls.length = 0
            expect((await app.request('/api/skills/find', { headers: authHeaders })).status).toBe(400)
            expect((await app.request('/api/skills/find?q=%20%20', { headers: authHeaders })).status).toBe(400)
            expect(findCalls).toHaveLength(0)
        })

        test('搜索失败 → 502 明确报错（不伪装空清单）', async () => {
            failFind = 'skills registry search failed: HTTP 503'
            const res = await app.request('/api/skills/find?q=pdf', { headers: authHeaders })
            failFind = null
            expect(res.status).toBe(502)
            const err = await res.json() as { error: string }
            expect(err.error).toContain('HTTP 503')
        })
    })

    describe('skill 清单变更 → skill-inventory-changed 事件发布（notifySkillChange）', () => {
        /** `/` 面板命令清单以会话 sdkMetadata 为源，与 skillsRoot 查询缓存键不相交：
         *  装卸/启停必须发布清单变更事件，消费编排（引擎刷新）归订阅方，此处只断言发布 */
        const events: SkillInventoryChangedEvent[] = []

        beforeAll(() => {
            engine.skillInventory.subscribe(event => events.push(event))
            // 自备删除素材（前面 DELETE describe 已消费掉公共素材）
            mkdirSync(join(claudeDir, 'skills', 'notify-global'), { recursive: true })
            writeFileSync(join(claudeDir, 'skills', 'notify-global', 'SKILL.md'), skillMd({ name: 'notify-global' }))
            mkdirSync(join(wsDir, '.claude', 'skills', 'notify-proj'), { recursive: true })
            writeFileSync(join(wsDir, '.claude', 'skills', 'notify-proj', 'SKILL.md'), skillMd({ name: 'notify-proj' }))
        })

        test('卸载 global skill → target global（影响全部活跃会话）', async () => {
            events.length = 0
            const res = await app.request('/api/skills/notify-global?workspaceId=global', { method: 'DELETE', headers: authHeaders })
            expect(res.status).toBe(200)
            expect(events.length).toBe(1)
            expect(events[0]!.target).toEqual({ kind: 'global' })
        })

        test('卸载 project skill → 该 workspace 的 target', async () => {
            events.length = 0
            const res = await app.request(`/api/skills/notify-proj?workspaceId=${workspaceId}`, { method: 'DELETE', headers: authHeaders })
            expect(res.status).toBe(200)
            expect(events.length).toBe(1)
            expect(events[0]!.target).toEqual({ kind: 'workspace', workspaceId })
        })

        test('卸载失败（不可删除 400）→ 不发布事件', async () => {
            events.length = 0
            expect((await app.request('/api/skills/cloud-skill?workspaceId=global', { method: 'DELETE', headers: authHeaders })).status).toBe(400)
            expect(events.length).toBe(0)
        })

        test('安装 → 发布事件（global scope → target global）', async () => {
            fakeInstallResult = { installed: ['x'], failed: [] }
            events.length = 0
            const res = await app.request('/api/skills/install', {
                method: 'POST',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ source: 'octocat/repo', scope: 'global' }),
            })
            expect(res.status).toBe(200)
            expect(events.length).toBe(1)
            expect(events[0]!.target).toEqual({ kind: 'global' })
        })

        test('启停 → 发布事件（workspace scope 透传）', async () => {
            events.length = 0
            const res = await app.request(`/api/skills/proj-plain/visibility`, {
                method: 'PATCH',
                headers: { ...authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ workspaceId, enabled: false }),
            })
            expect(res.status).toBe(200)
            expect(events.length).toBe(1)
            expect(events[0]!.target).toEqual({ kind: 'workspace', workspaceId })
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

        test('tracked global：reinstallSkill 携带 lock 来源，global=true', async () => {
            const res = await update('gamma', 'global')
            expect(res.status).toBe(200)
            expect(reinstallCalls.at(-1)).toMatchObject({ name: 'gamma', source: 'octocat/gamma-skills', global: true })
        })

        test('tracked workspace：cwd=workspace、global=false', async () => {
            const res = await update('proj-tracked', workspaceId)
            expect(res.status).toBe(200)
            expect(reinstallCalls.at(-1)).toMatchObject({ name: 'proj-tracked', source: 'octocat/repo', global: false, cwd: wsDir })
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

        test('首访自采返回名单 + 插件携带合成；同版本二次请求纯缓存命中（不再采）', async () => {
            const { res, data } = await getBundled()
            expect(res.status).toBe(200)
            expect(data.version).toBe('2.1.312')
            // CC 内置在前（probe 交集），mobi 内置插件携带在后（行带 pluginName）
            expect(data.skills.map((s: { name: string }) => s.name)).toEqual(['doctor', 'verify', 'plug-skill'])
            const plug = data.skills.at(-1)
            expect(plug.pluginName).toBe('demo-plugin')
            expect(plug.description).toBe('From plugin')
            // 插件行随列表带完整管理行（web 直接消费，不再自造 SkillInfo）
            expect(plug.skill).toMatchObject({
                name: 'plug-skill',
                source: 'plugin',
                pluginName: 'demo-plugin',
                overrideable: false,
                deletable: false,
            })
            expect(bundledProbeCount).toBe(1)

            // 版本不变 → 纯缓存（probe 不重跑；插件扫描每请求现读，新装插件即时可见）
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

    describe('GET /api/skills/detail（正文 + frontmatter 扩展元数据）', () => {
        /** detail 请求（query 串形式，行内 skill 名走 URL 编码） */
        async function getDetail(name: string, workspaceId?: string): Promise<Response> {
            const params = new URLSearchParams({ name })
            if (workspaceId) params.set('workspaceId', workspaceId)
            return app.request(`/api/skills/detail?${params}`, { headers: authHeaders })
        }

        test('frontmatter 扩展字段 + 正文全量解析；未写的字段不出现在 meta', async () => {
            // 动态建一个 meta-rich fixture（beforeAll 的 alpha 只有 name/description）
            const mdPath = join(claudeDir, 'skills', 'meta-rich', 'SKILL.md')
            mkdirSync(join(claudeDir, 'skills', 'meta-rich'), { recursive: true })
            writeFileSync(mdPath, [
                '---',
                'name: meta-rich',
                'description: Rich frontmatter',
                'when_to_use: when debugging skills',
                'argument-hint: "[issue-number]"',
                'arguments: issue branch',
                'user-invocable: false',
                'model: opus',
                'effort: high',
                'context: fork',
                'agent: Explore',
                'background: false',
                'paths: "src/**/*.ts"',
                'license: MIT',
                'compatibility: Claude Code v2.1+',
                '---',
                '',
                '# 正文标题',
                '',
                '指令正文第一段。',
            ].join('\n'))

            try {
                const res = await getDetail('meta-rich')
                expect(res.status).toBe(200)
                const { skill, body, meta } = await res.json() as { skill: { name: string }; body: string; meta: Record<string, unknown> }
                expect(skill.name).toBe('meta-rich')
                expect(body).toContain('# 正文标题')
                expect(body).toContain('指令正文第一段。')
                expect(meta).toMatchObject({
                    whenToUse: 'when debugging skills',
                    argumentHint: '[issue-number]',
                    arguments: ['issue', 'branch'],
                    userInvocable: false,
                    model: 'opus',
                    effort: 'high',
                    fork: true,
                    agent: 'Explore',
                    background: false,
                    paths: ['src/**/*.ts'],
                    license: 'MIT',
                    compatibility: 'Claude Code v2.1+',
                })

                // 对照：无扩展字段的 skill → meta 全空 + 正文为 markdown 全文
                const plain = await getDetail('alpha')
                const plainData = await plain.json() as { body: string; meta: Record<string, unknown> }
                expect(Object.keys(plainData.meta).filter(k => plainData.meta[k] !== undefined)).toEqual([])
                expect(plainData.body).toContain('instructions')
            } finally {
                rmSync(join(claudeDir, 'skills', 'meta-rich'), { recursive: true, force: true })
            }
        })

        test('插件携带 skill（global 视角清单查不到）→ 兜底解析只读详情', async () => {
            const res = await getDetail('plug-skill')
            expect(res.status).toBe(200)
            const { skill, body } = await res.json() as { skill: SkillInfo; body: string }
            expect(skill.source).toBe('plugin')
            expect(skill.pluginName).toBe('demo-plugin')
            expect(skill.overrideable).toBe(false)
            expect(skill.deletable).toBe(false)
            expect(body).toContain('instructions')
        })

        test('未知名 → 404；未知 workspace → 404', async () => {
            expect((await getDetail('nope')).status).toBe(404)
            expect((await getDetail('alpha', 'nope-ws')).status).toBe(404)
        })
    })

    describe('GET /api/skills/occupancy（tabs 空项目隐藏）', () => {
        test('有技能的 workspace 在集合里；空项目不在（同名遮蔽后为空 = 未占用）', async () => {
            // fixture workspace 有可见 project skill（proj-plain 等）→ 占用
            // 动态建空 workspace（无 .claude/skills）→ 不占用
            const emptyWs = mkdtempSync(join(HOST_HOME, 'mobi-skill-empty-ws-'))
            try {
                const res = await app.request('/api/workspaces', {
                    method: 'POST',
                    headers: { ...authHeaders, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'skill-empty-ws', folders: [{ path: emptyWs, primary: true }] }),
                })
                const { workspace } = await res.json() as { workspace: { id: string } }

                const occ = await app.request('/api/skills/occupancy', { headers: authHeaders })
                expect(occ.status).toBe(200)
                const { workspaceIds } = await occ.json() as { workspaceIds: string[] }
                expect(workspaceIds).toContain(workspaceId)
                expect(workspaceIds).not.toContain(workspace.id)
            } finally {
                rmSync(emptyWs, { recursive: true, force: true })
            }
        })
    })
})
