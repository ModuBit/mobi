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
import type { SkillSource } from 'skills'
import { createSourceCache, mergeAvailableWithInstalled, repoShortName, searchRegistrySkills } from '../../../src/skills/skillInventoryClient'

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

    test('repo 名含点不截断（next.js 之类），.git 后缀仍剥离', () => {
        expect(repoShortName('https://github.com/vercel/next.js')).toBe('vercel/next.js')
        expect(repoShortName('https://github.com/vercel/next.js.git')).toBe('vercel/next.js')
        expect(repoShortName('git@github.com:foo/bar.baz.git')).toBe('foo/bar.baz')
        // 路径后缀（tree / 结尾斜杠）不混入 repo 名
        expect(repoShortName('https://github.com/foo/bar.git/tree/main')).toBe('foo/bar')
        expect(repoShortName('https://github.com/foo/bar/')).toBe('foo/bar')
    })

    test('非 github url 原样返回（判定退化为完整 url 字符串等价）', () => {
        expect(repoShortName('https://gitlab.com/a/b')).toBe('https://gitlab.com/a/b')
    })
})

describe('mergeAvailableWithInstalled（scope 感知的生效安装判定）', () => {
    const repo = {
        repoSource: 'octocat/repo',
        skills: [
            { name: 'a', description: 'this repo installed' },
            { name: 'b', description: 'conflict same name' },
            { name: 'c', description: 'not installed' },
        ],
    }

    test('global 视角：本 repo 已装 → installed；异源同名 → conflict；未装 → 均否（互斥）', () => {
        const merged = mergeAvailableWithInstalled(repo.repoSource, repo.skills, [
            { name: 'a', source: 'octocat/repo', scope: 'global' },
            { name: 'b', source: 'other/repo', scope: 'global' },
        ], 'global')
        expect(merged).toEqual([
            { name: 'a', description: 'this repo installed', installed: true, conflict: false },
            { name: 'b', description: 'conflict same name', installed: false, conflict: true },
            { name: 'c', description: 'not installed', installed: false, conflict: false },
        ])
    })

    test('同名 untracked（source null）→ conflict（安装会覆盖本地自管同名 skill）', () => {
        const merged = mergeAvailableWithInstalled(repo.repoSource, repo.skills, [
            { name: 'a', source: null, scope: 'global' },
        ], 'global')
        expect(merged[0]).toMatchObject({ installed: false, conflict: true })
    })

    test('已装清单为空 → 全部可选', () => {
        const merged = mergeAvailableWithInstalled(repo.repoSource, repo.skills, [], 'workspace')
        expect(merged.every(s => !s.installed && !s.conflict)).toBe(true)
    })

    test('workspace 视角：全局已装在项目里同样生效（回落 global 层）', () => {
        const merged = mergeAvailableWithInstalled(repo.repoSource, repo.skills, [
            { name: 'a', source: 'octocat/repo', scope: 'global' },
        ], 'workspace')
        expect(merged[0]).toMatchObject({ installed: true, conflict: false })
    })

    test('workspace 视角：项目层同名条目覆盖全局异源条目 → installed 而非 conflict', () => {
        const merged = mergeAvailableWithInstalled(repo.repoSource, repo.skills, [
            { name: 'a', source: 'other/repo', scope: 'global' },
            { name: 'a', source: 'octocat/repo', scope: 'workspace' },
        ], 'workspace')
        expect(merged[0]).toMatchObject({ installed: true, conflict: false })
    })

    test('global 视角忽略项目层条目：全局未装 + 项目已装 → 均否', () => {
        const merged = mergeAvailableWithInstalled(repo.repoSource, repo.skills, [
            { name: 'a', source: 'octocat/repo', scope: 'workspace' },
        ], 'global')
        expect(merged[0]).toMatchObject({ installed: false, conflict: false })
    })

    test('判定与列表拼接顺序无关（workspace 层条目在前同样生效）', () => {
        const refs = [
            { name: 'a', source: 'octocat/repo', scope: 'workspace' },
            { name: 'a', source: 'other/repo', scope: 'global' },
        ] as const
        const forward = mergeAvailableWithInstalled(repo.repoSource, repo.skills, [...refs], 'workspace')
        const reversed = mergeAvailableWithInstalled(repo.repoSource, repo.skills, [...refs].reverse(), 'workspace')
        expect(forward[0]).toMatchObject({ installed: true, conflict: false })
        expect(reversed[0]).toMatchObject({ installed: true, conflict: false })
    })
})

/** 可诊断的假源句柄：记录 dispose 次数 */
function fakeSource() {
    let disposed = 0
    const handle = {
        source: { input: 'octocat/repo', type: 'github', url: 'https://github.com/octocat/repo', commit: 'abc' },
        skills: [],
        dispose: async () => { disposed += 1 },
    } as unknown as SkillSource
    return { handle, disposed: () => disposed }
}

describe('createSourceCache（租约：可用清单 → 安装复用同一次克隆）', () => {
    test('同源并发 withSource 共享一次解析；再次调用命中缓存', async () => {
        let resolves = 0
        const { handle, disposed } = fakeSource()
        const cache = createSourceCache(async () => {
            resolves += 1
            return handle
        })

        const seen: SkillSource[] = []
        const [a, b] = await Promise.all([
            cache.withSource('octocat/repo', (h) => { seen.push(h) }),
            cache.withSource('octocat/repo', (h) => { seen.push(h) }),
        ])
        await cache.withSource('octocat/repo', (h) => { seen.push(h) })
        expect(resolves).toBe(1)
        expect(seen.every(h => h === handle)).toBe(true)
        // 租约结束不销毁克隆：留给 install 复用，TTL 兜底回收
        expect(disposed()).toBe(0)
        expect(a).toBeUndefined()
        expect(b).toBeUndefined()
    })

    test('fn 抛错只归还租约：克隆留在缓存供重试', async () => {
        let resolves = 0
        const { handle, disposed } = fakeSource()
        const cache = createSourceCache(async () => {
            resolves += 1
            return handle
        })

        await expect(cache.withSource('octocat/repo', async () => { throw new Error('install failed') }))
            .rejects.toThrow('install failed')
        // 重试命中同一克隆，不重新解析、不销毁临时目录
        const reused = await cache.withSource('octocat/repo', h => h)
        expect(resolves).toBe(1)
        expect(reused).toBe(handle)
        expect(disposed()).toBe(0)
    })

    test('超过上限淘汰最旧并释放其临时目录', async () => {
        const sources = new Map<string, ReturnType<typeof fakeSource>>()
        const cache = createSourceCache(async (source) => {
            const s = fakeSource()
            sources.set(source, s)
            return s.handle
        }, { maxEntries: 2 })

        await cache.withSource('a/one', () => {})
        await cache.withSource('b/two', () => {})
        await cache.withSource('c/three', () => {})

        expect(sources.get('a/one')!.disposed()).toBe(1)
        expect(sources.get('b/two')!.disposed()).toBe(0)
        expect(sources.get('c/three')!.disposed()).toBe(0)
    })

    test('不同源并发 withSource 串行解析（前一次 clone 收尾才起下一次）', async () => {
        // 取消获取只是放弃等待，旧 clone 仍在后台收尾；此时换 source 再拉会叠加克隆，
        // 故不同源必须排队（同源仍走 inflight 去重，见上一条用例）
        const started: string[] = []
        const gates = new Map<string, () => void>()
        const cache = createSourceCache((source) => {
            started.push(source)
            return new Promise((resolve) => {
                gates.set(source, () => resolve(fakeSource().handle))
            })
        })

        const first = cache.withSource('a/one', () => {})
        const second = cache.withSource('b/two', () => {})
        await Promise.resolve()
        expect(started).toEqual(['a/one'])

        gates.get('a/one')!()
        await first
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(started).toEqual(['a/one', 'b/two'])

        gates.get('b/two')!()
        await second
    })

    test('TTL 到期自动释放（无租约时立即回收）', async () => {
        const { handle, disposed } = fakeSource()
        const cache = createSourceCache(async () => handle, { ttlMs: 20 })

        await cache.withSource('octocat/repo', () => {})
        await new Promise(resolve => setTimeout(resolve, 60))
        expect(disposed()).toBe(1)
    })

    test('租约期间 TTL 到点不释放；最后一个租约归还后补回收', async () => {
        const { handle, disposed } = fakeSource()
        const cache = createSourceCache(async () => handle, { ttlMs: 20 })
        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })

        const held = cache.withSource('octocat/repo', () => gate)
        await new Promise(resolve => setTimeout(resolve, 60))
        // 操作还在进行：临时目录不得被 TTL 清掉
        expect(disposed()).toBe(0)

        release()
        await held
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(disposed()).toBe(1)
    })

    test('容量淘汰遇到被租用的最旧条目：延后到租约归还再释放', async () => {
        const sources = new Map<string, ReturnType<typeof fakeSource>>()
        const cache = createSourceCache(async (source) => {
            const s = fakeSource()
            sources.set(source, s)
            return s.handle
        }, { maxEntries: 2 })
        let release!: () => void
        const gate = new Promise<void>(resolve => { release = resolve })

        const held = cache.withSource('a/one', () => gate)
        await new Promise(resolve => setTimeout(resolve, 0))
        await cache.withSource('b/two', () => {})
        await cache.withSource('c/three', () => {})

        // 最旧的条目被租用：先打待释放标记，租约期间不销毁
        expect(sources.get('a/one')!.disposed()).toBe(0)

        release()
        await held
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(sources.get('a/one')!.disposed()).toBe(1)
        // 后两个条目不受牵连
        expect(sources.get('b/two')!.disposed()).toBe(0)
        expect(sources.get('c/three')!.disposed()).toBe(0)
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
