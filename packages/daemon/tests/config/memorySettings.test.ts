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

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    resolveSessionMemory,
    resolveMemoryRule,
    buildMemoryManagedConfig,
    syncMemoryManagedConfig,
    MEMORY_MANAGED_CONFIG_REL_PATH,
    type MemorySettings,
    type MemoryRule,
} from '@/config/memorySettings'

const MANAGED = '/managed/hindsight/coding-agent.json'

const active: MemorySettings = {
    engine: 'hindsight',
    endpoint: 'https://api.hindsight.vectorize.io',
    apiToken: 'hsk_x',
}

describe('resolveSessionMemory（会话级记忆裁决）', () => {
    it('engine 缺省 / off / 未知值 → off（fail-closed，未知值不视为已开启）', () => {
        expect(resolveSessionMemory(undefined, '/w', MANAGED)).toMatchObject({ active: false, reason: 'off' })
        expect(resolveSessionMemory({ engine: 'off' }, '/w', MANAGED)).toMatchObject({ active: false, reason: 'off' })
        expect(resolveSessionMemory({ engine: 'mem0' as never }, '/w', MANAGED)).toMatchObject({ active: false, reason: 'off' })
    })

    it('engine 开但 endpoint 缺失 → invalid-endpoint（不阻断会话，调用方记诊断）', () => {
        expect(resolveSessionMemory({ engine: 'hindsight' }, '/w', MANAGED)).toMatchObject({ active: false, reason: 'invalid-endpoint' })
        expect(resolveSessionMemory({ engine: 'hindsight', endpoint: '  ' }, '/w', MANAGED)).toMatchObject({ active: false, reason: 'invalid-endpoint' })
    })

    it('workspace 排除名单命中（前缀匹配）→ workspace-excluded', () => {
        const m: MemorySettings = { ...active, disabledWorkspaces: ['/secret/repo'] }
        expect(resolveSessionMemory(m, '/secret/repo', MANAGED)).toMatchObject({ active: false, reason: 'workspace-excluded' })
        expect(resolveSessionMemory(m, '/secret/repo/sub/dir', MANAGED)).toMatchObject({ active: false, reason: 'workspace-excluded' })
        expect(resolveSessionMemory(m, '/secret-repo', MANAGED)).toMatchObject({ active: true })
        // 名单为空数组 = 无排除
        expect(resolveSessionMemory({ ...active, disabledWorkspaces: [] }, '/w', MANAGED)).toMatchObject({ active: true })
    })

    it('active 时注入 env 契约：挂载信号 + 连接信息 + 管理配置路径；无 token 不注入 token 键', () => {
        const r = resolveSessionMemory(active, '/w', MANAGED)
        expect(r).toMatchObject({
            active: true,
            engine: 'hindsight',
            env: {
                MOBI_MEMORY_ENGINE: 'hindsight',
                HINDSIGHT_API_URL: 'https://api.hindsight.vectorize.io',
                HINDSIGHT_API_TOKEN: 'hsk_x',
                HINDSIGHT_CONFIG: MANAGED,
            },
        })
        const noToken = resolveSessionMemory({ engine: 'hindsight', endpoint: 'http://x' }, '/w', MANAGED)
        expect(noToken.active && noToken.env).not.toHaveProperty('HINDSIGHT_API_TOKEN')
    })
})

describe('resolveMemoryRule（隔离规则裁决序）', () => {
    const wsRule = (id: string, mode: MemoryRule['mode'], extra?: Partial<MemoryRule>): MemoryRule =>
        ({ target: { type: 'workspace', id }, mode, ...extra })
    const pathRule = (path: string, mode: MemoryRule['mode'], extra?: Partial<MemoryRule>): MemoryRule =>
        ({ target: { type: 'path', path }, mode, ...extra })

    it('无规则 → undefined（默认 normal）', () => {
        expect(resolveMemoryRule(undefined, '/w', 'ws-1')).toBeUndefined()
        expect(resolveMemoryRule([], '/w', 'ws-1')).toBeUndefined()
    })

    it('workspace 规则按 spawn 的 workspaceId 直查（档位跟工作区语境走，不听目录）', () => {
        const rules = [wsRule('learn', 'normal', { tag: 'learn' }), wsRule('lab', 'isolated')]
        expect(resolveMemoryRule(rules, '/any/dir', 'learn')).toMatchObject({ mode: 'normal', tag: 'learn' })
        expect(resolveMemoryRule(rules, '/any/dir', 'lab')).toMatchObject({ mode: 'isolated' })
        // 无 workspaceId（裸目录 spawn）→ workspace 档跳过
        expect(resolveMemoryRule(rules, '/any/dir', undefined)).toBeUndefined()
    })

    it('路径规则恒优先于 workspace 规则；多路径命中取最长前缀', () => {
        const rules = [
            wsRule('ws-1', 'isolated'),
            pathRule('/a', 'open'),
            pathRule('/a/b/c', 'normal', { tag: 'deep' }),
            pathRule('/a/b', 'open'),
        ]
        expect(resolveMemoryRule(rules, '/a/b/c/x', 'ws-1')).toMatchObject({ mode: 'normal', tag: 'deep' })
        expect(resolveMemoryRule(rules, '/a/b/y', 'ws-1')).toMatchObject({ mode: 'open' })
        expect(resolveMemoryRule(rules, '/a/z', 'ws-1')).toMatchObject({ mode: 'open' })
        // 路径不命中 → workspace 档生效
        expect(resolveMemoryRule(rules, '/elsewhere', 'ws-1')).toMatchObject({ mode: 'isolated' })
    })

    it('路径前缀匹配：~ 展开、尾分隔符归一、`/a/b` 不误命中 `/a/bc`', () => {
        const rules = [pathRule('~/notes', 'open')]
        expect(resolveMemoryRule(rules, join(process.env.HOME ?? '', 'notes', 'chat'), undefined)).toMatchObject({ mode: 'open' })
        expect(resolveMemoryRule(rules, '/x/notes-similar', undefined)).toBeUndefined()
    })
})

describe('buildMemoryManagedConfig（三档配置生成）', () => {
    it('normal（默认）：全局池 + 展开 tag 溯源 + any 召回过滤', () => {
        const cfg = JSON.parse(buildMemoryManagedConfig(active, 'demo'))
        expect(cfg.bankId).toBe('mobi-global')
        expect(cfg.retainTags).toEqual(['project:demo'])
        expect(cfg.recallOptions).toEqual({ tags: ['project:demo'], tags_match: 'any' })
        expect(cfg.gitIngest).toBe(false)
        expect(cfg.autoUpdate).toBe(false)
        expect(cfg.apiUrl).toBe(active.endpoint)
        expect(cfg.customPages['User Profile'].source_query).toContain('durable preferences')
        expect(cfg).not.toHaveProperty('observationScopes')
    })

    it('normal + tag 覆盖（共享组）：retain/recall 两侧同出覆盖值', () => {
        const rule: MemoryRule = { target: { type: 'workspace', id: 'w' }, mode: 'normal', tag: 'learn' }
        const cfg = JSON.parse(buildMemoryManagedConfig(active, 'rust', rule))
        expect(cfg.retainTags).toEqual(['project:learn'])
        expect(cfg.recallOptions).toEqual({ tags: ['project:learn'], tags_match: 'any' })
        expect(cfg.bankId).toBe('mobi-global')
    })

    it('open：不打 tag（无 tag 记忆主动写入口）+ 无召回过滤', () => {
        const rule: MemoryRule = { target: { type: 'workspace', id: 'w' }, mode: 'open' }
        const cfg = JSON.parse(buildMemoryManagedConfig(active, 'chat', rule))
        expect(cfg.retainTags).toEqual([])
        expect(cfg).not.toHaveProperty('recallOptions')
        expect(cfg.bankId).toBe('mobi-global')
    })

    it('isolated：派生 mobi-iso-<tag> bank + 无召回过滤；bank 覆盖生效', () => {
        const derived: MemoryRule = { target: { type: 'workspace', id: 'w' }, mode: 'isolated' }
        const cfg = JSON.parse(buildMemoryManagedConfig(active, 'secret', derived))
        expect(cfg.bankId).toBe('mobi-iso-secret')
        expect(cfg.retainTags).toEqual(['project:secret'])
        expect(cfg).not.toHaveProperty('recallOptions')

        const overridden: MemoryRule = { ...derived, bank: 'vault' }
        expect(JSON.parse(buildMemoryManagedConfig(active, 'secret', overridden)).bankId).toBe('vault')
    })

    it('bankName 高级覆盖全局池', () => {
        const cfg = JSON.parse(buildMemoryManagedConfig({ ...active, bankName: 'my-pool' }, 'demo'))
        expect(cfg.bankId).toBe('my-pool')
    })
})

describe('syncMemoryManagedConfig（per-scope 幂等落盘）', () => {
    let dataDir: string
    beforeAll(() => {
        dataDir = mkdtempSync(join(tmpdir(), 'mobi-memory-settings-test-'))
    })
    afterAll(() => {
        rmSync(dataDir, { recursive: true, force: true })
    })

    it('按（档位 × tag）落 projects/<slug>.json；isolated 与 normal 同 tag 分文件互不覆写', async () => {
        const normalRule: MemoryRule = { target: { type: 'path', path: '/x' }, mode: 'normal', tag: 'demo' }
        const isoRule: MemoryRule = { target: { type: 'path', path: '/y' }, mode: 'isolated', tag: 'demo' }
        const normal = await syncMemoryManagedConfig(dataDir, active, 'demo', normalRule)
        const iso = await syncMemoryManagedConfig(dataDir, active, 'demo', isoRule)
        expect(normal).toBe(join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH, 'projects', 'normal-demo.json'))
        expect(iso).toBe(join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH, 'projects', 'isolated-demo.json'))
        expect(JSON.parse(readFileSync(normal, 'utf-8')).bankId).toBe('mobi-global')
        expect(JSON.parse(readFileSync(iso, 'utf-8')).bankId).toBe('mobi-iso-demo')
        // 无规则默认档 = normal-<gitProject>
        expect(await syncMemoryManagedConfig(dataDir, active, 'mobi'))
            .toBe(join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH, 'projects', 'normal-mobi.json'))
    })

    it('bank 覆盖进 slug：同 tag 不同 bank 的 isolated 规则分文件（防互相覆写）', async () => {
        const vaultA: MemoryRule = { target: { type: 'path', path: '/x' }, mode: 'isolated', bank: 'vault-a' }
        const vaultB: MemoryRule = { target: { type: 'path', path: '/y' }, mode: 'isolated', bank: 'vault-b' }
        const a = await syncMemoryManagedConfig(dataDir, active, 'demo', vaultA)
        const b = await syncMemoryManagedConfig(dataDir, active, 'demo', vaultB)
        expect(a).toBe(join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH, 'projects', 'isolated-vault-a.json'))
        expect(b).toBe(join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH, 'projects', 'isolated-vault-b.json'))
        // 各自内容互不覆写
        expect(JSON.parse(readFileSync(a, 'utf-8')).bankId).toBe('vault-a')
        expect(JSON.parse(readFileSync(b, 'utf-8')).bankId).toBe('vault-b')
    })

    it('slug 非法字符清洗为 `_`（防路径穿越）', async () => {
        expect(await syncMemoryManagedConfig(dataDir, active, 'a/b'))
            .toBe(join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH, 'projects', 'normal-a_b.json'))
    })

    it('同 scope 内容未变不重写（mtime 哨兵不动）；设置变更后覆写新内容', async () => {
        const target = join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH, 'projects', 'normal-mtime-probe.json')
        await syncMemoryManagedConfig(dataDir, active, 'mtime-probe')
        const past = new Date(Date.now() - 60_000)
        utimesSync(target, past, past)
        const before = statSync(target).mtimeMs

        await syncMemoryManagedConfig(dataDir, active, 'mtime-probe')
        expect(statSync(target).mtimeMs).toBe(before)

        await syncMemoryManagedConfig(dataDir, { ...active, bankName: 'bob-pool' }, 'mtime-probe')
        expect(JSON.parse(readFileSync(target, 'utf-8')).bankId).toBe('bob-pool')
    })

    it('文件损坏（非 JSON 比较不等）时按新内容覆写', async () => {
        const target = join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH, 'projects', 'normal-corrupt.json')
        await syncMemoryManagedConfig(dataDir, active, 'corrupt')
        writeFileSync(target, 'corrupted{')
        await syncMemoryManagedConfig(dataDir, active, 'corrupt')
        expect(() => JSON.parse(readFileSync(target, 'utf-8'))).not.toThrow()
    })
})
