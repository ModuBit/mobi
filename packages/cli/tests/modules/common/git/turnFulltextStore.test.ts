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
