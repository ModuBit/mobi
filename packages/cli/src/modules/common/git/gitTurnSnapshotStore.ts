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
 * 轮次快照存储的 git 适配器（ADR 0008）——CLI 内 git 执行的唯一收口。
 *
 * 快照动作：临时 GIT_INDEX_FILE 上 `git add -A` 全量收集 + `git rm --cached` 摘除
 * 产物目录（exclude pathspec 会因显式命中被 .gitignore 忽略的路径而整体报错，禁用）
 * + `write-tree` + `update-ref refs/mobi/turn-diffs/<sessionId>/<n>`。
 * 三不碰：不产生 commit、不进分支历史、不动用户 index/工作区；引用不进任何
 * push refspec，永不出本机。
 *
 * 解析格式已实证（git 2.x，`-z` NUL 分隔）：
 * - `--numstat -z -M`：每记录 `added\tdeleted\tpath\0`；rename 为
 *   `added\tdeleted\t\0old\0new\0`（计数 token 以 tab 结尾，old/new 各自成 token）；
 *   二进制计数为 `-`
 * - `--name-status -z -M`：`状态\0path\0`；rename 为 `R100\0old\0new\0`
 * 两命令按「rename 后路径 / 其余按 path」对齐组装条目。
 */

import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { logger } from '@/ui/logger'
import type { LastTurnDiff, TurnSnapshotRef, TurnSnapshotStore, TurnTreeDiffEntry, TurnTreeDiffKind } from './turnSnapshotStore'

const execFileAsync = promisify(execFile)

/** 产物目录不入快照（产物有自己的展示通道，混进变更归因是噪音） */
const EXCLUDE_PATH = '.mobi/artifacts'

const REF_NAMESPACE = 'refs/mobi/turn-diffs'

/** 引用名合法字符白名单外的字符（sessionId 理论上不含，兜底替换保 refname 合法） */
function sanitizeSessionId(sessionId: string): string {
    const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_')
    if (safe !== sessionId) {
        logger.debug(`[TurnSnapshotStore] sessionId 含引用名非法字符，已替换: ${sessionId} -> ${safe}`)
    }
    return safe
}

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd, env, maxBuffer: 64 * 1024 * 1024 })
    return stdout
}

/**
 * 打开 cwd 所在仓库的快照存储；cwd 不在 git 仓库内返回 null——
 * 不可用是显式返回值而非异常，调用方据此走非 git 降级口径。
 */
export async function openTurnSnapshotStore(cwd: string): Promise<TurnSnapshotStore | null> {
    try {
        await git(cwd, ['rev-parse', '--show-toplevel'])
    } catch {
        return null
    }
    return new GitTurnSnapshotStore(cwd)
}

export class GitTurnSnapshotStore implements TurnSnapshotStore {
    constructor(private readonly cwd: string) {}

    async capture(sessionId: string): Promise<TurnSnapshotRef> {
        const safeId = sanitizeSessionId(sessionId)
        // 临时 index：独立于用户暂存区，add 与 write-tree 都指向它，用完即删
        const tmpIndex = join(tmpdir(), `mobi-turn-idx-${randomUUID()}`)
        const env = { ...process.env, GIT_INDEX_FILE: tmpIndex }
        try {
            // 全量 add（-A 只收未忽略文件）后把产物目录从临时 index 摘除——
            // 不用 exclude pathspec：pathspec 显式命中「已被 .gitignore 忽略」的路径
            // 会让整个 add 以「Use -f」报错退出（真仓库实证 2026-09-27），绝对不能容忍
            await git(this.cwd, ['add', '-A'], env)
            await git(this.cwd, ['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', EXCLUDE_PATH], env)
            const tree = (await git(this.cwd, ['write-tree'], env)).trim()
            const chain = await this.listChain(sessionId)
            const ref: TurnSnapshotRef = { index: (chain.at(-1)?.index ?? 0) + 1, tree }
            await git(this.cwd, ['update-ref', `${REF_NAMESPACE}/${safeId}/${ref.index}`, tree])
            return ref
        } finally {
            await fsRemove(tmpIndex)
        }
    }

    async listChain(sessionId: string): Promise<TurnSnapshotRef[]> {
        const safeId = sanitizeSessionId(sessionId)
        const out = await git(this.cwd, [
            'for-each-ref', '--format=%(refname)%00%(objectname)', `${REF_NAMESPACE}/${safeId}/`,
        ]).catch(() => '')
        const refs: TurnSnapshotRef[] = []
        // 输出按行分记录（format 尾随 \n），行内 \0 分字段
        for (const line of out.split('\n')) {
            if (line.trim() === '') continue
            const [refname, objectname] = line.split('\0')
            const index = Number.parseInt(refname!.split('/').at(-1)!, 10)
            if (Number.isFinite(index) && objectname) {
                refs.push({ index, tree: objectname })
            }
        }
        return refs.sort((a, b) => a.index - b.index)
    }

    async lastTurnDiff(sessionId: string): Promise<LastTurnDiff | null> {
        const chain = await this.listChain(sessionId)
        if (chain.length < 2) return null
        const base = chain.at(-2)!
        const head = chain.at(-1)!
        return { base, head, files: await this.diffTrees(base.tree, head.tree) }
    }

    async diffTrees(baseTree: string, headTree: string): Promise<TurnTreeDiffEntry[]> {
        if (baseTree === headTree) return []
        // name-status 定 kind（含 rename 旧路径），numstat 定计数，按路径对齐组装
        const [statusOut, numstatOut] = await Promise.all([
            git(this.cwd, ['diff', '--name-status', '-z', '-M', baseTree, headTree]),
            git(this.cwd, ['diff', '--numstat', '-z', '-M', baseTree, headTree]),
        ])
        const statuses = parseNameStatus(statusOut)
        const counts = parseNumstat(numstatOut)
        const entries: TurnTreeDiffEntry[] = []
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

    async clearSession(sessionId: string): Promise<number> {
        const safeId = sanitizeSessionId(sessionId)
        const chain = await this.listChain(sessionId)
        for (const ref of chain) {
            await git(this.cwd, ['update-ref', '-d', `${REF_NAMESPACE}/${safeId}/${ref.index}`])
        }
        return chain.length
    }
}

/** 临时 index 文件清理（失败不遮蔽主流程） */
async function fsRemove(path: string): Promise<void> {
    const { rm } = await import('node:fs/promises')
    await rm(path, { force: true }).catch(() => undefined)
}

type StatusRecord = { kind: TurnTreeDiffKind; previousPath?: string }

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
            const kind: TurnTreeDiffKind = kindBase === 'A' ? 'add' : kindBase === 'D' ? 'delete' : 'modify'
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
