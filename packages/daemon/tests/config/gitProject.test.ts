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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveGitProjectName } from '@/config/gitProject'

/**
 * 与 vendored hook 侧 gitProjectName 的一致性是红线：recall tag（mobi 展开）与
 * retain tag（hook 展开）错位会让 any 匹配错误隔离本项目记忆。测试形状复刻
 * probeOnce 的三种路径：普通仓 / worktree 指针 / 非 git。
 */

describe('resolveGitProjectName（与 hook retain 侧展开一致性）', () => {
    let root: string
    beforeAll(() => {
        root = mkdtempSync(join(tmpdir(), 'mobi-git-project-test-'))
    })
    afterAll(() => {
        rmSync(root, { recursive: true, force: true })
    })

    it('普通仓：子目录向上找到 .git 目录 → 主仓目录名', async () => {
        const repo = join(root, 'my-repo')
        mkdirSync(join(repo, '.git'), { recursive: true })
        const sub = join(repo, 'packages', 'deep', 'dir')
        mkdirSync(sub, { recursive: true })
        await expect(resolveGitProjectName(sub)).resolves.toBe('my-repo')
    })

    it('worktree：.git 文件指针 + commondir 相对指针 → 归主仓名（不是 worktree 目录名）', async () => {
        // 主仓 <root>/main-repo（.git 目录内 commondir 缺省 = 自身）
        const mainRepo = join(root, 'main-repo')
        mkdirSync(join(mainRepo, '.git'), { recursive: true })
        // worktree gitdir 在主仓 .git/worktrees 下，commondir 指回主仓 .git
        const worktreeGitdir = join(mainRepo, '.git', 'worktrees', 'wt-1')
        mkdirSync(worktreeGitdir, { recursive: true })
        writeFileSync(join(worktreeGitdir, 'commondir'), '../../')
        // worktree 检出目录：.git 是文件，指向 worktreeGitdir
        const checkout = join(root, 'feature-checkout')
        mkdirSync(checkout, { recursive: true })
        writeFileSync(join(checkout, '.git'), `gitdir: ${worktreeGitdir}\n`)

        await expect(resolveGitProjectName(checkout)).resolves.toBe('main-repo')
    })

    it('非 git 目录：回退目录 basename（对齐 hook dirName fallback）', async () => {
        const dir = join(root, 'plain-project')
        mkdirSync(dir, { recursive: true })
        await expect(resolveGitProjectName(dir)).resolves.toBe('plain-project')
    })

    it('本仓库冒烟：与 hook 展开同值（modu/mobi → mobi）', async () => {
        await expect(resolveGitProjectName(process.cwd())).resolves.toBe('mobi')
    })
})
