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
 * worktree 生命周期测试基建：临时真 git 仓库 + 真 worktree（不断言 git 命令序列，
 * 只断言文件内容/分支存在性等外部行为）。
 */

import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGit } from '@/worktree/gitRunner'

/** 真 git 执行（直接复用生产 GitRunner） */
export const git = runGit

export interface TempRepo {
    /** 临时根目录（repo 与 repo-worktrees 的父目录） */
    dir: string
    /** 主仓库根 */
    repo: string
    /** mobi worktree 兄弟目录 */
    worktreesRoot: string
    /** 在约定布局下创建一个 mobi worktree（分支 mobi-<name>） */
    addWorktree(name: string): Promise<string>
    /** 原始 worktree（可指定任意分支，用于归属校验反例） */
    addRawWorktree(name: string, branch: string): Promise<string>
    cleanup(): Promise<void>
}

export async function createTempRepo(): Promise<TempRepo> {
    // 真实路径归一：macOS 的 /var → /private/var，git 回报的是后者
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'mobi-worktree-test-')))
    const repo = join(dir, 'repo')
    await mkdir(repo)
    await git(repo, ['init', '-q'])
    await git(repo, ['config', 'user.email', 'test@example.com'])
    await git(repo, ['config', 'user.name', 'Test'])
    await writeFile(join(repo, 'README.md'), 'init\n')
    await git(repo, ['add', '.'])
    await git(repo, ['commit', '-qm', 'init'])

    const worktreesRoot = join(dir, 'repo-worktrees')
    return {
        dir,
        repo,
        worktreesRoot,
        async addWorktree(name: string) {
            const path = join(worktreesRoot, name)
            await git(repo, ['worktree', 'add', '-q', '-b', `mobi-${name}`, path])
            return path
        },
        async addRawWorktree(name: string, branch: string) {
            const path = join(worktreesRoot, name)
            await git(repo, ['worktree', 'add', '-q', '-b', branch, path])
            return path
        },
        cleanup: () => rm(dir, { recursive: true, force: true })
    }
}
