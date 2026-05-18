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

import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

import type { WorktreeInfo } from '@/runner/worktree';
import { logger } from '@/ui/logger';

export function readWorktreeEnv(): WorktreeInfo | null {
    return readWorktreeFromEnv() ?? readWorktreeFromGit();
}

function readWorktreeFromEnv(): WorktreeInfo | null {
    const basePath = process.env.MOBI_WORKTREE_BASE_PATH?.trim();
    const branch = process.env.MOBI_WORKTREE_BRANCH?.trim();
    const name = process.env.MOBI_WORKTREE_NAME?.trim();
    const worktreePath = process.env.MOBI_WORKTREE_PATH?.trim();
    const createdAtRaw = process.env.MOBI_WORKTREE_CREATED_AT?.trim();

    if (!basePath || !branch || !name || !worktreePath || !createdAtRaw) {
        return null;
    }

    const createdAt = Number(createdAtRaw);
    if (!Number.isFinite(createdAt)) {
        return null;
    }

    return {
        basePath,
        branch,
        name,
        worktreePath,
        createdAt
    };
}

function readWorktreeFromGit(): WorktreeInfo | null {
    const start = Date.now();
    let result: WorktreeInfo | null = null;

    try {
        const cwd = process.cwd();
        const isInside = runGit(['rev-parse', '--is-inside-work-tree'], cwd);
        if (isInside !== 'true') {
            return null;
        }

        const gitDir = runGit(['rev-parse', '--git-dir'], cwd);
        const gitCommonDir = runGit(['rev-parse', '--git-common-dir'], cwd);
        if (!gitDir || !gitCommonDir) {
            return null;
        }

        const resolvedGitDir = normalizePath(gitDir, cwd);
        const resolvedGitCommonDir = normalizePath(gitCommonDir, cwd);
        if (resolvedGitDir === resolvedGitCommonDir) {
            return null;
        }

        const worktreeRoot = runGit(['rev-parse', '--show-toplevel'], cwd);
        if (!worktreeRoot) {
            return null;
        }
        const worktreePath = normalizePath(worktreeRoot, cwd);
        const basePath = dirname(resolvedGitCommonDir);

        const branch = runGit(['symbolic-ref', '--short', 'HEAD'], cwd)
            ?? runGit(['rev-parse', '--short', 'HEAD'], cwd);
        if (!branch) {
            return null;
        }

        result = {
            basePath,
            branch,
            name: basename(worktreePath),
            worktreePath,
            createdAt: readCreatedAt(worktreePath)
        };
        return result;
    } finally {
        const elapsedMs = Date.now() - start;
        logger.debug(`[WORKTREE] Git probe ${result ? 'hit' : 'miss'} in ${elapsedMs}ms`);
    }
}

/**
 * 读取指定目录的 git 分支名
 *
 * 在 session 启动时（buildSessionMetadata）和 local→remote 切换时采集。
 * 覆盖 95% 使用场景（分支切换通常意味着重启会话）。
 * 若后续需要实时更新，可复用 CLI 已有的 startFileWatcher 监听 .git/HEAD 文件变化，
 * 通过 client.updateMetadata() 推送，无需改动 Hub 和 Web。
 */
export function readGitBranch(cwd: string): string | null {
    return runGit(['symbolic-ref', '--short', 'HEAD'], cwd)
        ?? runGit(['rev-parse', '--short', 'HEAD'], cwd)
}

function runGit(args: string[], cwd: string): string | null {
    try {
        const output = execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        return output.length > 0 ? output : null;
    } catch {
        return null;
    }
}

function normalizePath(rawPath: string, cwd: string): string {
    const resolved = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
    try {
        return realpathSync(resolved);
    } catch {
        return resolved;
    }
}

function readCreatedAt(worktreePath: string): number {
    try {
        const stat = statSync(worktreePath);
        const birthtimeMs = Math.round(stat.birthtimeMs);
        if (Number.isFinite(birthtimeMs) && birthtimeMs > 0) {
            return birthtimeMs;
        }
        const ctimeMs = Math.round(stat.ctimeMs);
        if (Number.isFinite(ctimeMs) && ctimeMs > 0) {
            return ctimeMs;
        }
    } catch {
        return Date.now();
    }
    return Date.now();
}
