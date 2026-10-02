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
 * mobiGitignore 单测：.mobi/.gitignore 排除面维护——新建含全量条目、旧文件补缺失、
 * 已含不重写。每用例独立 tmpdir（工作区级进程内缓存以路径为键，不互相污染）。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureMobiGitignore, MOBI_GITIGNORE_ENTRIES } from '@/git/mobiGitignore'

describe('ensureMobiGitignore', () => {
    const cleanup: string[] = []

    afterEach(async () => {
        for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true })
    })

    async function freshWorkspace(): Promise<string> {
        const dir = await mkdtemp(join(tmpdir(), 'mobi-gitignore-'))
        cleanup.push(dir)
        return dir
    }

    it('文件不存在 → 新建含全量默认条目', async () => {
        const dir = await freshWorkspace()
        await ensureMobiGitignore(dir)
        const content = await readFile(join(dir, '.mobi', '.gitignore'), 'utf-8')
        expect(content).toBe(MOBI_GITIGNORE_ENTRIES.join('\n') + '\n')
    })

    it('已有 uploads/artifacts → 追加缺失的 turn-diffs/，既有行保持', async () => {
        const dir = await freshWorkspace()
        await mkdir(join(dir, '.mobi'), { recursive: true })
        await writeFile(join(dir, '.mobi', '.gitignore'), 'uploads/\nartifacts/\n', 'utf-8')
        await ensureMobiGitignore(dir)
        const content = await readFile(join(dir, '.mobi', '.gitignore'), 'utf-8')
        expect(content).toBe('uploads/\nartifacts/\nturn-diffs/\n')
    })

    it('已含全部条目 → 不重写（内容逐字节不变）', async () => {
        const dir = await freshWorkspace()
        const existing = '# comment\nuploads/\nartifacts/\nturn-diffs/\n'
        await mkdir(join(dir, '.mobi'), { recursive: true })
        await writeFile(join(dir, '.mobi', '.gitignore'), existing, 'utf-8')
        await ensureMobiGitignore(dir)
        await expect(readFile(join(dir, '.mobi', '.gitignore'), 'utf-8')).resolves.toBe(existing)
    })
})
