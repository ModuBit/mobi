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
    })

    it('mapPathToBank 原样透传；bankNamespace 前缀 bankId', () => {
        const cfg = JSON.parse(buildMemoryManagedConfig({
            ...active,
            mapPathToBank: { '~/learn/rust': 'learning' },
            bankNamespace: 'alice',
        }))
        expect(cfg.mapPathToBank).toEqual({ '~/learn/rust': 'learning' })
        expect(cfg.bankId).toBe('alice::mobi-personal')
    })

    it('engine off 时生成空 apiUrl 的中性配置（文件仍可写，无连接信息）', () => {
        const cfg = JSON.parse(buildMemoryManagedConfig(undefined))
        expect(cfg.apiUrl).toBe('')
        expect(cfg.bankId).toBe('mobi-personal')
    })
})

describe('syncMemoryManagedConfig（幂等落盘）', () => {
    let dataDir: string
    beforeAll(() => {
        dataDir = mkdtempSync(join(tmpdir(), 'mobi-memory-settings-test-'))
    })
    afterAll(() => {
        rmSync(dataDir, { recursive: true, force: true })
    })

    it('首次生成到 dataDir/memory/hindsight/coding-agent.json；内容与 buildMemoryManagedConfig 一致', () => {
        const target = syncMemoryManagedConfig(dataDir, active)
        expect(target).toBe(join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH))
        expect(readFileSync(target, 'utf-8')).toBe(buildMemoryManagedConfig(active))
    })

    it('内容未变不重写（mtime 哨兵不动）；设置变更后覆写新内容', async () => {
        const target = join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH)
        const past = new Date(Date.now() - 60_000)
        utimesSync(target, past, past)
        const before = statSync(target).mtimeMs

        syncMemoryManagedConfig(dataDir, active)
        expect(statSync(target).mtimeMs).toBe(before)

        syncMemoryManagedConfig(dataDir, { ...active, bankNamespace: 'bob' })
        expect(JSON.parse(readFileSync(target, 'utf-8')).bankId).toBe('bob::mobi-personal')
    })

    it('文件损坏（非 JSON 比较不等）时按新内容覆写', () => {
        const target = join(dataDir, MEMORY_MANAGED_CONFIG_REL_PATH)
        writeFileSync(target, 'corrupted{')
        syncMemoryManagedConfig(dataDir, active)
        expect(() => JSON.parse(readFileSync(target, 'utf-8'))).not.toThrow()
    })
})
