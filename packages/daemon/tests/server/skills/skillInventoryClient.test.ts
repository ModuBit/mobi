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

import { describe, test, expect, afterEach } from 'vitest'
import { mergeAvailableWithInstalled, repoShortName, searchRegistrySkills } from '../../../src/skills/skillInventoryClient'

/**
 * 两步式安装的判定纯函数：repo 清单 × 已装清单 → 复选框数据源。
 * (source, name) 判定键与 installed/conflict 互斥语义由路由测试 + 此处共同锁定。
 */
describe('repoShortName', () => {
    test('https / ssh / .git 后缀 → owner/repo', () => {
        expect(repoShortName('https://github.com/octocat/repo.git')).toBe('octocat/repo')
        expect(repoShortName('https://github.com/octocat/repo')).toBe('octocat/repo')
        expect(repoShortName('git@github.com:octocat/repo.git')).toBe('octocat/repo')
    })

    test('非 github url 原样返回（判定退化为完整 url 字符串等价）', () => {
        expect(repoShortName('https://gitlab.com/a/b')).toBe('https://gitlab.com/a/b')
    })
})

describe('mergeAvailableWithInstalled', () => {
    const repo = {
        repoSource: 'octocat/repo',
        skills: [
            { name: 'a', description: 'this repo installed' },
            { name: 'b', description: 'conflict same name' },
            { name: 'c', description: 'not installed' },
        ],
    }

    test('本 repo 已装 → installed；异源同名 → conflict；未装 → 均否（互斥）', () => {
        const merged = mergeAvailableWithInstalled(repo.repoSource, repo.skills, [
            { name: 'a', source: 'octocat/repo' },
            { name: 'b', source: 'other/repo' },
        ])
        expect(merged).toEqual([
            { name: 'a', description: 'this repo installed', installed: true, conflict: false },
            { name: 'b', description: 'conflict same name', installed: false, conflict: true },
            { name: 'c', description: 'not installed', installed: false, conflict: false },
        ])
    })

    test('同名 untracked（source null）→ conflict（安装会覆盖本地自管同名 skill）', () => {
        const merged = mergeAvailableWithInstalled(repo.repoSource, repo.skills, [{ name: 'a', source: null }])
        expect(merged[0]).toMatchObject({ installed: false, conflict: true })
    })

    test('已装清单为空 → 全部可选', () => {
        const merged = mergeAvailableWithInstalled(repo.repoSource, repo.skills, [])
        expect(merged.every(s => !s.installed && !s.conflict)).toBe(true)
    })
})

describe('searchRegistrySkills', () => {
    // tests/server 走 bun 内置运行器（vi.stubGlobal 不可用）：手工替换并还原全局 fetch
    const originalFetch = globalThis.fetch
    afterEach(() => {
        globalThis.fetch = originalFetch
    })

    test('请求 skills.sh /api/search?q=；脏项（缺 name/source/skillId）过滤，installs 缺省补 0', async () => {
        const urls: string[] = []
        globalThis.fetch = (async (url: string | URL | Request) => {
            urls.push(String(url))
            return new Response(JSON.stringify({
                skills: [
                    { name: 'pdf', source: 'anthropics/skills', skillId: 'pdf', installs: 231296 },
                    { name: 'no-source', skillId: 'x' },
                    { name: 'no-installs', source: 'a/b', skillId: 'c' },
                ],
            }), { status: 200, headers: { 'Content-Type': 'application/json' } })
        }) as typeof fetch

        const skills = await searchRegistrySkills('pdf ocr')
        expect(skills).toEqual([
            { name: 'pdf', source: 'anthropics/skills', skillId: 'pdf', installs: 231296 },
            { name: 'no-installs', source: 'a/b', skillId: 'c', installs: 0 },
        ])
        expect(urls[0]).toContain('/api/search?q=pdf+ocr')
    })

    test('非 2xx → 抛错（不伪装空结果）', async () => {
        globalThis.fetch = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch
        await expect(searchRegistrySkills('pdf')).rejects.toThrow('HTTP 503')
    })
})
