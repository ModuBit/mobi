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
 * mobi worktree 归属约定单一事实源（creation 侧 executor/worktree 与消费侧
 * worktree 生命周期服务共用）：
 *
 * - 目录：`<repoParent>/<repoName>-worktrees/<name>`
 * - 分支：`mobi-<name>`
 *
 * 识别逻辑只写在这里；创建、列表扫描、合回/丢弃的归属校验都引用本文件。
 */

import { basename, dirname, join } from 'node:path'

/** worktree 根目录的兄弟目录后缀（`mobi` 仓库 → `mobi-worktrees`） */
export const MOBI_WORKTREE_DIR_SUFFIX = '-worktrees'

/** mobi 分支前缀 */
export const MOBI_WORKTREE_BRANCH_PREFIX = 'mobi-'

/** 给定主仓库根目录，返回存放其 mobi worktree 的兄弟目录 */
export function worktreesRootForRepo(repoRoot: string): string {
    return join(dirname(repoRoot), `${basename(repoRoot)}${MOBI_WORKTREE_DIR_SUFFIX}`)
}

/** worktree 名 → 分支名（创建与识别共用） */
export function branchForWorktreeName(name: string): string {
    return `${MOBI_WORKTREE_BRANCH_PREFIX}${name}`
}

/**
 * 分支名 → worktree 名；非 mobi 分支返回 null。
 * 接受短名（`mobi-x`）或完整 ref（`refs/heads/mobi-x`，`git worktree list --porcelain` 的形态）。
 */
export function worktreeNameFromBranch(branch: string): string | null {
    const short = branch.startsWith('refs/heads/') ? branch.slice('refs/heads/'.length) : branch
    if (!short.startsWith(MOBI_WORKTREE_BRANCH_PREFIX)) return null
    const name = short.slice(MOBI_WORKTREE_BRANCH_PREFIX.length)
    return name === '' ? null : name
}

/** 给定主仓库根目录与 worktree 名，返回约定的 worktree 路径 */
export function worktreePathFor(repoRoot: string, name: string): string {
    return join(worktreesRootForRepo(repoRoot), name)
}

/**
 * 从路径本身解析归属布局：`<repoParent>/<repoName>-worktrees/<name>` →
 * `{ repoRoot, name }`；不符合约定返回 null。只做路径形状判定，不访问磁盘。
 */
export function parseMobiWorktreeLayout(worktreePath: string): { repoRoot: string; name: string } | null {
    const name = basename(worktreePath)
    const worktreesRoot = dirname(worktreePath)
    const worktreesRootName = basename(worktreesRoot)
    if (!name || !worktreesRootName.endsWith(MOBI_WORKTREE_DIR_SUFFIX)) return null
    if (name === '.' || name === '..') return null
    const repoName = worktreesRootName.slice(0, -MOBI_WORKTREE_DIR_SUFFIX.length)
    if (!repoName) return null
    return { repoRoot: join(dirname(worktreesRoot), repoName), name }
}
