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
 * bundled 名单采集器单测（skill-mgmt 票 06）。
 *
 * 只测纯函数与缓存编排骨架（外部行为）：
 * - 交集计算（builtin ∩ init.skills，名字无 / 前缀直接对齐）
 * - 版本化缓存读写与 miss 判定
 * 真 SDK probe（mobi-probe 目录管理）不进单测——归 E2E 真机验证。
 */
import { describe, test, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    computeBundledSkills,
    readBundledCache,
    writeBundledCache,
    getBundledSkills,
    type BundledSkillsCache,
    type BundledProber,
    type CommandSnapshot,
} from '../../../src/skills/bundledSkills'

describe('computeBundledSkills（交集法）', () => {
    const commands = [
        { name: 'doctor', description: '内置技能', builtin: true },
        { name: 'clear', description: '纯命令', builtin: true },
        { name: 'my-skill', description: '用户个人技能' },
        { name: 'verify', description: '内置技能 2', builtin: true },
    ]

    test('builtin 且在 init.skills → 内置名单；纯命令与用户技能排除', () => {
        const result = computeBundledSkills(['doctor', 'verify', 'my-skill'], commands)
        expect(result.map(s => s.name)).toEqual(['doctor', 'verify'])
        expect(result[0]!.description).toBe('内置技能')
    })

    test('init.skills 带 / 前缀形态也对齐（防御性）', () => {
        const result = computeBundledSkills(['/doctor'], commands)
        expect(result.map(s => s.name)).toEqual(['doctor'])
    })

    test('快照缺 description → 兜底空串（schema 侧必填，code-review 修复）', () => {
        // 修复前：description 为 undefined → 违反 BundledSkillInfoSchema 的 z.string() 必填
        // （类型上 description 必填，但 CLI 版本差异的运行时快照可能缺字段——as 模拟该输入）
        const noDescription = { name: 'doctor', builtin: true } as CommandSnapshot
        const result = computeBundledSkills(['doctor'], [noDescription])
        expect(result).toEqual([{ name: 'doctor', description: '' }])
    })
})

describe('版本化缓存', () => {
    let dir: string
    let cachePath: string

    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true })
    })

    test('写入后可读回；版本不符返回 null（自然 miss）', async () => {
        dir = mkdtempSync(join(tmpdir(), 'mobi-bundled-cache-'))
        cachePath = join(dir, 'bundled-skills.json')

        expect(readBundledCache(cachePath)).toBeNull()

        const data: BundledSkillsCache = {
            claudeVersion: '2.1.312',
            skills: [{ name: 'doctor', description: 'd' }],
            cachedAt: 12345,
        }
        await writeBundledCache(cachePath, data)
        expect(readBundledCache(cachePath)).toEqual(data)
    })

    test('损坏缓存返回 null 不抛', () => {
        dir = mkdtempSync(join(tmpdir(), 'mobi-bundled-cache-'))
        cachePath = join(dir, 'bundled-skills.json')
        writeFileSync(cachePath, '{broken')
        expect(readBundledCache(cachePath)).toBeNull()
    })
})

describe('getBundledSkills（编排：版本→缓存→采→写）', () => {
    let dir: string
    let cachePath: string
    let probeCount: number
    let version: string

    const prober: BundledProber = async () => {
        probeCount += 1
        return { claudeVersion: version, skills: [{ name: 'doctor', description: `v${version}` }] }
    }
    const versionProber = async () => version

    afterEach(() => {
        if (dir) rmSync(dir, { recursive: true, force: true })
    })

    function setup(currentVersion: string) {
        dir = mkdtempSync(join(tmpdir(), 'mobi-bundled-orch-'))
        cachePath = join(dir, 'bundled-skills.json')
        probeCount = 0
        version = currentVersion
    }

    test('miss→采→存→命中纯缓存', async () => {
        setup('2.1.312')

        const first = await getBundledSkills({ cachePath, prober, versionProber })
        expect(first.claudeVersion).toBe('2.1.312')
        expect(probeCount).toBe(1)
        expect(existsSync(cachePath)).toBe(true)

        // 二次：版本未变 → 纯缓存命中，不再采
        const second = await getBundledSkills({ cachePath, prober, versionProber })
        expect(second.claudeVersion).toBe('2.1.312')
        expect(probeCount).toBe(1)
    })

    test('CLI 版本升级 → 自然 miss 重采', async () => {
        setup('2.1.312')
        await getBundledSkills({ cachePath, prober, versionProber })

        version = '2.2.0'
        const refreshed = await getBundledSkills({ cachePath, prober, versionProber })
        expect(probeCount).toBe(2)
        expect(refreshed.claudeVersion).toBe('2.2.0')
        // 缓存已更新为新版本
        const persisted = JSON.parse(readFileSync(cachePath, 'utf-8'))
        expect(persisted.claudeVersion).toBe('2.2.0')
    })

    test('采集失败：异常上抛（路由层 502），不伪装空名单、不写缓存', async () => {
        setup('2.1.312')
        const failingProber: BundledProber = async () => {
            throw new Error('probe timeout')
        }

        await expect(getBundledSkills({ cachePath, prober: failingProber, versionProber })).rejects.toThrow('probe timeout')
        expect(existsSync(cachePath)).toBe(false)
    })

    test('同缓存并发 miss 共享一次采集；不同缓存互不串（inflight 按 cachePath 键控）', async () => {
        setup('2.1.312')

        // 同 cachePath 并发：两个请求共享一次 probe
        const [a, b] = await Promise.all([
            getBundledSkills({ cachePath, prober, versionProber }),
            getBundledSkills({ cachePath, prober, versionProber }),
        ])
        expect(probeCount).toBe(1)
        expect(a.claudeVersion).toBe(b.claudeVersion)

        // 不同 cachePath（不同 deps 实例）：各自独立采集，不共享别人的结果
        const otherPath = join(dir, 'other-bundled-skills.json')
        const other = await getBundledSkills({ cachePath: otherPath, prober, versionProber })
        expect(other.claudeVersion).toBe('2.1.312')
        expect(probeCount).toBe(2)
    })

    test('写缓存失败：降级不上抛，已采数据照常返回（缓存只是加速器，code-review 修复）', async () => {
        setup('2.1.312')
        // cachePath 指向已存在目录 → rename 落盘必然失败
        const badPath = join(dir, 'occupied')
        mkdirSync(badPath)

        const result = await getBundledSkills({ cachePath: badPath, prober, versionProber })
        expect(result.claudeVersion).toBe('2.1.312')
        expect(result.skills).toEqual([{ name: 'doctor', description: 'v2.1.312' }])
    })
})
