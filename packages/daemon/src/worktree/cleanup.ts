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
 * worktree 删除原语：合回清理与丢弃共用的强制删除 / 分支删除（调用方已完成
 * 前置校验：内容已合并或用户显式确认）。
 */

import type { GitRunner } from './gitRunner'

/** 强制删除 worktree 目录（合回清理 / 丢弃；内容已合并或用户显式确认） */
export async function forceRemoveWorktree(
    git: GitRunner,
    repoRoot: string,
    worktreePath: string
): Promise<{ ok: boolean; error?: string }> {
    try {
        await git(repoRoot, ['worktree', 'remove', '--force', worktreePath])
        return { ok: true }
    } catch (error) {
        return { ok: false, error: errorMessage(error) }
    }
}

/** 删除分支：`-d` = 已合入才删（防呆）；`-D` = 显式强删（squash / 丢弃） */
export async function deleteWorktreeBranch(
    git: GitRunner,
    repoRoot: string,
    branch: string,
    force: boolean
): Promise<{ ok: boolean; error?: string }> {
    try {
        await git(repoRoot, ['branch', force ? '-D' : '-d', branch])
        return { ok: true }
    } catch (error) {
        return { ok: false, error: errorMessage(error) }
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
