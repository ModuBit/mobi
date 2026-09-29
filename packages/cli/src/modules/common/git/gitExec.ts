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
 * CLI 内 git 执行与 diff 输出解析的唯一收口（turn-archive B 票03：快照链退场，
 * 自 gitTurnSnapshotStore 迁出存活件——快照类动作随链删除，此处只留共享设施）。
 *
 * 解析格式已实证（git 2.x，`-z` NUL 分隔）：
 * - `--numstat -z -M`：每记录 `added\tdeleted\tpath\0`；rename 为
 *   `added\tdeleted\t\0old\0new\0`（计数 token 以 tab 结尾，old/new 各自成 token）；
 *   二进制计数为 `-`
 * - `--name-status -z -M`：`状态\0path\0`；rename 为 `R100\0old\0new\0`
 * 两命令按「rename 后路径 / 其余按 path」对齐组装条目。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { logger } from '@/ui/logger'
import type { TurnDiffFileEntry, TurnDiffFileKind } from '@mobi/shared'

const execFileAsync = promisify(execFile)

/** .mobi 内部状态目录（单源）：归档/journal 等 mobi 自身状态有自己的展示通道，
 *  不入工作区实况口径（审查 untracked 清单与 generation dirty 刻度同源引用此常量） */
export const MOBI_STATE_DIR = '.mobi'

/** 引用名合法字符白名单外的字符（sessionId 理论上不含，兜底替换）。
 *  归档/journal 落盘目录（`.mobi/turn-diffs/<sid>/`）靠同一清洗对上（getTurnArchivePath
 *  派生自它），字符面单源在此 */
export function sanitizeSessionId(sessionId: string): string {
    const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_')
    if (safe !== sessionId) {
        logger.debug(`[GitExec] sessionId 含非法字符，已替换: ${sessionId} -> ${safe}`)
    }
    return safe
}

/** CLI 内 git 执行唯一收口：maxBuffer 64MB（diff 输出可能很大），env 供临时 index 注入 */
export async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd, env, maxBuffer: 64 * 1024 * 1024 })
    return stdout
}

export type StatusRecord = { kind: TurnDiffFileKind; previousPath?: string }

/** `--name-status -z -M` 解析：`状态\0path\0` / `R100\0old\0new\0`，键为变更后路径 */
export function parseNameStatus(out: string): Map<string, StatusRecord> {
    const tokens = out.split('\0')
    const records = new Map<string, StatusRecord>()
    let i = 0
    while (i < tokens.length) {
        const status = tokens[i]
        if (status === undefined || status.trim() === '') break
        const kindBase = status[0]!
        const path = tokens[i + 1]!
        if (kindBase === 'R' || kindBase === 'C') {
            const newPath = tokens[i + 2]!
            records.set(newPath, { kind: 'rename', previousPath: path })
            i += 3
        } else {
            const kind: TurnDiffFileKind = kindBase === 'A' ? 'add' : kindBase === 'D' ? 'delete' : 'modify'
            records.set(path, { kind })
            i += 2
        }
    }
    return records
}

type CountRecord = { additions: number; deletions: number; binary: boolean }

/**
 * `--numstat -z -M` 解析。token 形态（已实证）：普通/二进制记录计数与 path 同 token
 * （`1\t0\ta.txt`、`-\t-\td.bin`）；rename 记录计数 token 以 tab 结尾
 * （`0\t0\t`），old/new 各自成后续 token。键为变更后路径。
 */
export function parseNumstat(out: string): Map<string, CountRecord> {
    const tokens = out.split('\0')
    const records = new Map<string, CountRecord>()
    let i = 0
    while (i < tokens.length) {
        const token = tokens[i]
        if (token === undefined || token === '') break
        const [addedRaw, deletedRaw, ...rest] = token.split('\t')
        if (addedRaw === undefined || deletedRaw === undefined) break
        const binary = addedRaw === '-'
        const record: CountRecord = {
            additions: binary ? 0 : Number.parseInt(addedRaw, 10) || 0,
            deletions: binary ? 0 : Number.parseInt(deletedRaw, 10) || 0,
            binary,
        }
        if (rest.length > 0 && rest[0] !== '') {
            // 普通记录：path 与计数同 token
            records.set(rest[0], record)
            i += 1
        } else {
            // rename 记录：old/new 各自成 token（old 仅作对齐参考，键取 new）
            const newPath = tokens[i + 2]
            if (newPath === undefined || newPath === '') break
            records.set(newPath, record)
            i += 3
        }
    }
    return records
}

/**
 * name-status + numstat 两命令输出 → 按路径对齐的条目列表（rename 后路径对齐、
 * 二进制计数兜底、按 path localeCompare 排序）。审查工作区实况查询与 diff 组装
 * 共用——格式规则（见文件头实证记录）只此一处。
 */
export function assembleDiffEntries(statusOut: string, numstatOut: string): TurnDiffFileEntry[] {
    const statuses = parseNameStatus(statusOut)
    const counts = parseNumstat(numstatOut)
    const entries: TurnDiffFileEntry[] = []
    for (const [path, status] of statuses) {
        const count = counts.get(path) ?? { additions: 0, deletions: 0, binary: false }
        entries.push({
            path,
            kind: status.kind,
            additions: count.additions,
            deletions: count.deletions,
            binary: count.binary,
            ...(status.previousPath !== undefined && { previousPath: status.previousPath }),
        })
    }
    return entries.sort((a, b) => a.path.localeCompare(b.path))
}
