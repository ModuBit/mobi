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
    buildMemoryManagedConfig,
    syncMemoryManagedConfig,
    MEMORY_MANAGED_CONFIG_REL_PATH,
    type MemorySettings,
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

describe('buildMemoryManagedConfig（hindsight 管理配置拓扑）', () => {
    it('定稿拓扑：静态个人 bank + 项目溯源 tag + gitIngest/autoUpdate 关 + 画像页', () => {
        const cfg = JSON.parse(buildMemoryManagedConfig(active))
        expect(cfg.bankId).toBe('mobi-personal')
        expect(cfg.retainTags).toEqual(['project:{gitProject}'])
        expect(cfg.gitIngest).toBe(false)
        expect(cfg.autoUpdate).toBe(false)
        expect(cfg.apiUrl).toBe(active.endpoint)
        expect(cfg.customPages['User Profile'].source_query).toContain('durable preferences')
        // mapPathToBank 未配置时不写空对象
        expect(cfg).not.toHaveProperty('mapPathToBank')
        // gitProject 未传（诊断/兜底形态）：无 recallOptions——全量召回
        expect(cfg).not.toHaveProperty('recallOptions')
        // observationScopes 不配置（per_tag 实验证伪：不解决固化丢 retain tags，见 spec）
        expect(cfg).not.toHaveProperty('observationScopes')
    })

    it('omp 配方：gitProject 展开进 recallOptions（any = 本项目记忆 ∪ 无 tag 全局）', () => {
        const cfg = JSON.parse(buildMemoryManagedConfig(active, 'demo'))
        expect(cfg.recallOptions).toEqual({ tags: ['project:demo'], tags_match: 'any' })
    })

    it('mapPathToBank 原样透传；bankNamespace 前缀 bankId', () => {
        const cfg = JSON.parse(buildMemoryManagedConfig({
            ...active,
            mapPathToBank: { '~/learn/rust': 'learning' },
            bankNamespace: 'alice',
        }, 'demo'))
        expect(cfg.mapPathToBank).toEqual({ '~/learn/rust': 'learning' })
        expect(cfg.bankId).toBe('alice::mobi-personal')
    })

    it('engine off 时生成空 apiUrl 的中性配置（文件仍可写，无连接信息）', () => {
        const cfg = JSON.parse(buildMemoryManagedConfig(undefined, 'demo'))
        expect(cfg.apiUrl).toBe('')
        expect(cfg.bankId).toBe('mobi-personal')
    })
})

describe('syncMemoryManagedConfig（per-project 幂等落盘）', () => {
    let dataDir: string
    beforeAll(() => {
        dataDir = mkdtempSync(join(tmpdir(), 'mobi-memory-settings-test-'))
    })
    afterAll(() => {
        rmSync(dataDir, { recursive: true, force: true })
    })

    it('按项目落 projects/<slug>.json；内容与 buildMemoryManagedConfig 一致', () => {
        const target = syncMemoryManagedConfig(dataDir, active, 'demo')
        expect(target).toBe(join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH, 'projects', 'demo.json'))
        expect(readFileSync(target, 'utf-8')).toBe(buildMemoryManagedConfig(active, 'demo'))
        // 不同项目互不覆盖（per-project 隔离）
        const other = syncMemoryManagedConfig(dataDir, active, 'mobi')
        expect(readFileSync(other, 'utf-8')).toBe(buildMemoryManagedConfig(active, 'mobi'))
        expect(readFileSync(target, 'utf-8')).toBe(buildMemoryManagedConfig(active, 'demo'))
    })

    it('项目名非法字符清洗为 `_`（防路径穿越），缺省归 default', () => {
        expect(syncMemoryManagedConfig(dataDir, active, 'a/b')).toBe(
            join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH, 'projects', 'a_b.json'))
        expect(syncMemoryManagedConfig(dataDir, active)).toBe(
            join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH, 'projects', 'default.json'))
    })

    it('同项目内容未变不重写（mtime 哨兵不动）；设置变更后覆写新内容', async () => {
        const target = join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH, 'projects', 'mtime-probe.json')
        syncMemoryManagedConfig(dataDir, active, 'mtime-probe')
        const past = new Date(Date.now() - 60_000)
        utimesSync(target, past, past)
        const before = statSync(target).mtimeMs

        syncMemoryManagedConfig(dataDir, active, 'mtime-probe')
        expect(statSync(target).mtimeMs).toBe(before)

        syncMemoryManagedConfig(dataDir, { ...active, bankNamespace: 'bob' }, 'mtime-probe')
        expect(JSON.parse(readFileSync(target, 'utf-8')).bankId).toBe('bob::mobi-personal')
    })

    it('文件损坏（非 JSON 比较不等）时按新内容覆写', () => {
        const target = join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH, 'projects', 'corrupt.json')
        syncMemoryManagedConfig(dataDir, active, 'corrupt')
        writeFileSync(target, 'corrupted{')
        syncMemoryManagedConfig(dataDir, active, 'corrupt')
        expect(() => JSON.parse(readFileSync(target, 'utf-8'))).not.toThrow()
    })
})
