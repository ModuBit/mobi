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
 * worktree 脏判定（三态）：clean / dirty / unknown。`git status --porcelain -z`
 * 于 worktree 目录执行，条目排除 `.mobi` 状态路径（isMobiStatePath 单源——turn-diff
 * 归档/journal 落在 worktree 内是 mobi 自产噪音，不是用户改动）。
 *
 * unknown（git 失败）按 dirty 保守对待：调用方据此「不删、可合回但 WIP 提交可能空跑」。
 */

import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isMobiStatePath } from '@mobi/node-core/git/gitExec'
import type { GitRunner } from './gitRunner'

export type WorktreeDirtyState = 'clean' | 'dirty' | 'unknown'

export interface WorktreeStatus {
    state: WorktreeDirtyState
    /** 排除 .mobi 后的改动文件数（unknown 时无从得知，恒 0） */
    dirtyFileCount: number
    /** 脏文件大小和（近似占用；unknown 时恒 0） */
    sizeBytes: number
}

const UNKNOWN_STATUS: WorktreeStatus = { state: 'unknown', dirtyFileCount: 0, sizeBytes: 0 }
const CLEAN_STATUS: WorktreeStatus = { state: 'clean', dirtyFileCount: 0, sizeBytes: 0 }

export interface StatusRecordEntry {
    /** porcelain 两字符状态码（XY；`??` = 未跟踪） */
    code: string
    /** 变更后路径 */
    path: string
}

/**
 * 解析 `git status --porcelain -z -uall` 输出为记录列表。
 *
 * -z 形态（实证 git 2.x）：普通记录 `XY path\0`；rename/copy `XY new\0old\0`
 * （-z 下没有 ` -> ` 分隔符，旧路径是紧随其后的独立 token）。
 */
export function parseStatusEntries(statusOutput: string): StatusRecordEntry[] {
    const tokens = statusOutput.split('\0')
    const entries: StatusRecordEntry[] = []
    for (let i = 0; i < tokens.length; i += 1) {
        const record = tokens[i]
        if (record === undefined || record.length < 4) continue
        const code = record.slice(0, 2)
        entries.push({ code, path: record.slice(3) })
        if (code.startsWith('R') || code.startsWith('C')) i += 1
    }
    return entries
}

/** 排除 .mobi 状态路径后的改动路径（脏判定口径） */
export function parseDirtyPaths(statusOutput: string): string[] {
    return parseStatusEntries(statusOutput)
        .map((entry) => entry.path)
        .filter((path) => !isMobiStatePath(path))
}

/** 暂存区是否有内容（WIP 提交前的空提交判定；`.mobi` 不进暂存，无需再过滤） */
export function hasStagedChanges(statusOutput: string): boolean {
    return parseStatusEntries(statusOutput).some(
        (entry) => entry.code !== '??' && entry.code[0] !== ' '
    )
}

/** 脏文件大小和：文件已删（status 仍报 D）或缺权限时按 0 计，不阻断判定 */
async function sumFileSizes(worktreePath: string, paths: string[]): Promise<number> {
    const sizes = await Promise.all(paths.map(async (path) => {
        try {
            const info = await stat(join(worktreePath, path))
            return info.isFile() ? info.size : 0
        } catch {
            return 0
        }
    }))
    return sizes.reduce((total, size) => total + size, 0)
}

/** 脏判定（每次现跑 git；新鲜度由前端查询缓存控制，避免进程内隐藏的陈旧窗口） */
export async function inspectWorktreeStatus(
    git: GitRunner,
    worktreePath: string
): Promise<WorktreeStatus> {
    try {
        const output = await git(worktreePath, ['status', '--porcelain', '-z', '-uall'])
        const paths = parseDirtyPaths(output)
        return paths.length === 0
            ? CLEAN_STATUS
            : { state: 'dirty', dirtyFileCount: paths.length, sizeBytes: await sumFileSizes(worktreePath, paths) }
    } catch {
        return UNKNOWN_STATUS
    }
}

/** unknown 视为不可安全删除（保守：不删、留给用户处置） */
export function isSafeToRemove(status: WorktreeStatus): boolean {
    return status.state === 'clean'
}
