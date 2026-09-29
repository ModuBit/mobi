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
 * turnFulltextStore 集成测试（真 git + 真磁盘）：封口全文目录布局（a/b 镜像工作区
 * 相对路径）、路径穿越防护、目录模式单次 diff 切分的 per-file patch 形状、ref 形状
 * （缺侧省略字段）。
 */

import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileTurnFulltextStore } from '@/modules/common/git/turnFulltextStore'

const execFileAsync = promisify(execFile)

/** 真 git 执行（cwd 由 store 控制） */
const realGit: (cwd: string, args: string[]) => Promise<string> = (cwd, args) =>
    execFileAsync('git', args, { cwd }).then((r) => r.stdout)

function makeStore(dir: string): FileTurnFulltextStore {
    return new FileTurnFulltextStore(join(dir, '.mobi', 'turn-diffs', 's-1'), dir, realGit)
}

describe('FileTurnFulltextStore.sealFiles（真 git 集成）', () => {
    it('modify：a/b 目录镜像工作区相对路径，patch 含 +/- 行且无临时路径泄漏，ref 两侧齐全', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-fulltext-mod-'))
        try {
            const result = await makeStore(dir).sealFiles(1, [
                { path: join(dir, 'src', 'app.ts'), beforeContent: 'old\n', afterContent: 'new\n' },
            ])
            const turnDir = join(dir, '.mobi', 'turn-diffs', 's-1', '1')
            // 全文目录：a/b 两侧镜像相对路径
            expect(await readFile(join(turnDir, 'a', 'src', 'app.ts'), 'utf8')).toBe('old\n')
            expect(await readFile(join(turnDir, 'b', 'src', 'app.ts'), 'utf8')).toBe('new\n')
            const f = result.get(join(dir, 'src', 'app.ts'))!
            expect(f.ref).toEqual({ before: join('a', 'src', 'app.ts'), after: join('b', 'src', 'app.ts') })
            expect(f.patch).toContain('--- a/src/app.ts')
            expect(f.patch).toContain('+++ b/src/app.ts')
            expect(f.patch).toContain('-old')
            expect(f.patch).toContain('+new')
            expect(f.patch).not.toContain('mobi-fulltext-')
            expect(f.patch).not.toContain(tmpdir())
            expect(f.oversized).toBe(false)
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('add（before null）：a 侧无文件，ref 只带 after；delete（after null）：b 侧无文件，ref 只带 before', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-fulltext-addel-'))
        try {
            const result = await makeStore(dir).sealFiles(1, [
                { path: join(dir, 'new.ts'), beforeContent: null, afterContent: 'fresh\n' },
                { path: join(dir, 'gone.ts'), beforeContent: 'bye\n', afterContent: null },
            ])
            const turnDir = join(dir, '.mobi', 'turn-diffs', 's-1', '1')
            await expect(readFile(join(turnDir, 'a', 'new.ts'), 'utf8')).rejects.toThrow()
            expect(await readFile(join(turnDir, 'b', 'new.ts'), 'utf8')).toBe('fresh\n')
            expect(result.get(join(dir, 'new.ts'))!.ref).toEqual({ after: join('b', 'new.ts') })
            expect(result.get(join(dir, 'new.ts'))!.patch).toContain('new file mode')
            await expect(readFile(join(turnDir, 'b', 'gone.ts'), 'utf8')).rejects.toThrow()
            expect(result.get(join(dir, 'gone.ts'))!.ref).toEqual({ before: join('a', 'gone.ts') })
            expect(result.get(join(dir, 'gone.ts'))!.patch).toContain('deleted file mode')
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('纯 add 轮（无任何 a 侧文件）：a 目录自动补建，patch 不因 git fatal 而丢失', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-fulltext-pureadd-'))
        try {
            const result = await makeStore(dir).sealFiles(1, [
                { path: join(dir, 'new.ts'), beforeContent: null, afterContent: 'fresh\n' },
            ])
            expect(result.get(join(dir, 'new.ts'))!.patch).toContain('+fresh')
            expect(result.get(join(dir, 'new.ts'))!.patch).toContain('new file mode')
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('多文件一轮：单次 git diff 出全部 per-file patch（切分正确）', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-fulltext-multi-'))
        try {
            const result = await makeStore(dir).sealFiles(1, [
                { path: join(dir, 'a1.ts'), beforeContent: 'v1\n', afterContent: 'v2\n' },
                { path: join(dir, 'a2.ts'), beforeContent: null, afterContent: 'added\n' },
            ])
            expect(result.get(join(dir, 'a1.ts'))!.patch).toContain('-v1')
            expect(result.get(join(dir, 'a1.ts'))!.patch).toContain('+v2')
            expect(result.get(join(dir, 'a2.ts'))!.patch).toContain('+added')
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('路径逃逸（工作区外 / ../ 穿越）：跳过不落盘、无 ref，由调用方兜底合成', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-fulltext-escape-'))
        try {
            const outside = await mkdtemp(join(tmpdir(), 'mobi-fulltext-outside-'))
            try {
                const result = await makeStore(dir).sealFiles(1, [
                    { path: join(outside, 'evil.ts'), beforeContent: 'x\n', afterContent: 'y\n' },
                    { path: join(dir, '..', 'elsewhere.ts'), beforeContent: 'x\n', afterContent: 'y\n' },
                ])
                // 两个文件均被跳过（工作区外）：无 ref 无 patch
                expect(result.size).toBe(0)
            } finally {
                await rm(outside, { recursive: true, force: true })
            }
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })

    it('两侧都 null（无可合成）：条目缺席', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-fulltext-null-'))
        try {
            const result = await makeStore(dir).sealFiles(1, [
                { path: join(dir, 'x.ts'), beforeContent: null, afterContent: null },
            ])
            expect(result.size).toBe(0)
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    })
})

// ── 存储治理（票04）：turn 滚动 + session 滚动 + gitignore 排除面 ──────────────
describe('FileTurnFulltextStore 存储治理', () => {
    const cleanup: string[] = []

    it('turn 滚动：seal 两轮后旧 turnId 目录被删，非 turnId 文件（归档）保留', async () => {
        const { mkdir, writeFile, readdir } = await import('node:fs/promises')
        const dir = await mkdtemp(join(tmpdir(), 'mobi-fulltext-prune-'))
        cleanup.push(dir)
        const rootDir = join(dir, '.mobi', 'turn-diffs', 's1')
        const store = new FileTurnFulltextStore(rootDir, dir)
        // 同居占位文件（turn-archive.json 由归档写，形状同位）：验证滚动不误删非目录条目
        await mkdir(rootDir, { recursive: true })
        await writeFile(join(rootDir, 'turn-archive.json'), '{}', 'utf-8')
        await store.sealFiles(1, [{ path: join(dir, 'f.ts'), beforeContent: 'a\n', afterContent: 'b\n' }])
        await store.sealFiles(2, [{ path: join(dir, 'f.ts'), beforeContent: 'b\n', afterContent: 'c\n' }])
        const names = await readdir(rootDir)
        expect(names.filter((n) => /^\d+$/.test(n))).toEqual(['2'])
        expect(names).toContain('turn-archive.json')
    })

    it('session 滚动：超 KEEP 的最老目录被删，当前会话目录永不自删', async () => {
        const { mkdir, utimes } = await import('node:fs/promises')
        const dir = await mkdtemp(join(tmpdir(), 'mobi-fulltext-session-prune-'))
        cleanup.push(dir)
        const diffsRoot = join(dir, '.mobi', 'turn-diffs')
        // 造 32 个假 session 目录 + 递增 mtime（时间反着给：s032 最老）
        for (let i = 1; i <= 32; i++) {
            const name = `s${String(i).padStart(3, '0')}`
            await mkdir(join(diffsRoot, name), { recursive: true })
            const t = new Date(Date.now() - i * 1000)
            await utimes(join(diffsRoot, name), t, t)
        }
        // 当前会话目录 s000（mtime 最老仍不可删）
        await mkdir(join(diffsRoot, 's000'), { recursive: true })
        const store = new FileTurnFulltextStore(join(diffsRoot, 's000'), dir)
        await store.sealFiles(1, [{ path: join(dir, 'f.ts'), beforeContent: 'a\n', afterContent: 'b\n' }])
        const { readdir } = await import('node:fs/promises')
        const names = (await readdir(diffsRoot)).sort()
        // 33 个目录 → 候选 32（exclude s000）留 30：删最老 2 个 → 共 31 个
        expect(names).toHaveLength(31)
        expect(names).toContain('s000')
        expect(names).not.toContain('s032')
        expect(names).not.toContain('s031')
        expect(names).toContain('s030')
    })

    it('gitignore：seal 落盘后 .mobi/.gitignore 含 turn-diffs/', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-fulltext-gitignore-'))
        cleanup.push(dir)
        const store = new FileTurnFulltextStore(join(dir, '.mobi', 'turn-diffs', 's1'), dir)
        await store.sealFiles(1, [{ path: join(dir, 'f.ts'), beforeContent: 'a\n', afterContent: 'b\n' }])
        const content = await readFile(join(dir, '.mobi', '.gitignore'), 'utf-8')
        expect(content).toContain('turn-diffs/')
        expect(content).toContain('uploads/')
        expect(content).toContain('artifacts/')
    })

    it('垃圾条目：session 目录里的普通文件不参与 session 滚动也不被误删', async () => {
        const { mkdir, writeFile: wf, readdir } = await import('node:fs/promises')
        const dir = await mkdtemp(join(tmpdir(), 'mobi-fulltext-junk-'))
        cleanup.push(dir)
        const diffsRoot = join(dir, '.mobi', 'turn-diffs')
        await mkdir(diffsRoot, { recursive: true })
        await wf(join(diffsRoot, 'stray-file.txt'), 'not a session dir\n')
        const store = new FileTurnFulltextStore(join(diffsRoot, 'current'), dir)
        await store.sealFiles(1, [{ path: join(dir, 'f.ts'), beforeContent: 'a\n', afterContent: 'b\n' }])
        expect(await readdir(diffsRoot)).toContain('stray-file.txt')
    })
})
