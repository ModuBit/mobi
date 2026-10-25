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
 * worktree 删除原语（生命周期挂点共用）：干净才删、脏/未知保留。
 *
 * spawn 失败与会话删除两条路径都走 {@link removeWorktreeIfClean}——不在这里
 * 复制脏判定与分支删除顺序；合回/丢弃的强制删除另走 {@link forceRemoveWorktree}。
 */

import type { GitRunner } from './gitRunner'
import { errorMessage, runGit } from './gitRunner'
import { inspectWorktreeStatus, isSafeToRemove, type WorktreeDirtyState } from './status'

export interface WorktreeCleanupResult {
    /** worktree 目录是否已删除 */
    removed: boolean
    /** 分支是否已删除（`-d` 被 git 拒绝时降级为 false，不追杀） */
    branchDeleted: boolean
    /** 判定时的脏状态（removed=false 时调用方据此说明「为什么保留」） */
    state: WorktreeDirtyState
    dirtyFileCount: number
    /** 删除失败/降级细节（诊断用） */
    warning?: string
}

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

/**
 * 强制删除 worktree 后按需删分支（合回清理 / 丢弃共用）：worktree 删除失败即终止，
 * 分支删除失败只降级为 warning，不回滚已完成的 worktree 删除。
 */
export async function removeWorktreeAndBranch(
    git: GitRunner,
    options: { repoRoot: string; worktreePath: string; branch: string; forceBranch: boolean }
): Promise<{ worktreeRemoved: boolean; branchDeleted: boolean; warning?: string }> {
    const removal = await forceRemoveWorktree(git, options.repoRoot, options.worktreePath)
    if (!removal.ok) {
        return {
            worktreeRemoved: false,
            branchDeleted: false,
            warning: `Failed to remove worktree: ${removal.error ?? 'unknown error'}`
        }
    }

    const deleted = await deleteWorktreeBranch(git, options.repoRoot, options.branch, options.forceBranch)
    return {
        worktreeRemoved: true,
        branchDeleted: deleted.ok,
        ...(deleted.ok ? {} : { warning: `Failed to delete branch ${options.branch}: ${deleted.error ?? 'unknown error'}` })
    }
}

/**
 * 「干净才删、脏则保留」：脏或 unknown 一律保留（unknown 保守不删——git 失败时
 * 无法证明没有未提交改动）。删除口径与合回/丢弃共用 {@link removeWorktreeAndBranch}。
 */
export async function removeWorktreeIfClean(
    options: { repoRoot: string; worktreePath: string; branch: string },
    deps: { git?: GitRunner } = {}
): Promise<WorktreeCleanupResult> {
    const git = deps.git ?? runGit
    const status = await inspectWorktreeStatus(git, options.worktreePath)
    if (!isSafeToRemove(status)) {
        return {
            removed: false,
            branchDeleted: false,
            state: status.state,
            dirtyFileCount: status.dirtyFileCount
        }
    }

    const cleanup = await removeWorktreeAndBranch(git, { ...options, forceBranch: false })
    return {
        removed: cleanup.worktreeRemoved,
        branchDeleted: cleanup.branchDeleted,
        state: status.state,
        dirtyFileCount: 0,
        ...(cleanup.warning ? { warning: cleanup.warning } : {})
    }
}
