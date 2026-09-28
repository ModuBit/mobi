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
 * 审查数据 reader（gitReview RPC 的 CLI 侧实现，ADR 0006 machine 通道）。
 *
 * 只读 git 查询：四档 scope 的文件与统计 + 单文件 diff 三件套。cwd 由 hub 从会话
 * metadata 注入（与 machineReadFileMeta 同信任模型）；路径统一以 repoRoot 为基准
 * （git 在 repoRoot 执行，diff 输出的路径即仓库相对路径，盘上读取同基准）。
 *
 * 快照相关（链、last-turn 两树、快照间 diff）复用 TurnSnapshotStore——git 执行
 * 的收口纪律不破；本模块自己的 exec 只跑工作区实况的只读查询（staged/unstaged/
 * untracked/status/show）。
 *
 * untracked 行数计数：`git diff --no-index --numstat /dev/null <path>`（ChatGPT 同解，
 * 差异以退出码 1 表达须从 stdout 取），超过 UNTRACKED_COUNT_CAP 只列条目不再计数
 * （truncated 事实随响应返回）。
 */

import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
    GIT_REVIEW_RPC,
    GitReviewDataSchema,
    GitReviewFileDiffSchema,
    summarizeTurnDiffFiles,
    type GitReviewFileDiff,
    type GitReviewFileQuery,
    type TurnDiffFileEntry,
} from '@mobi/shared'
import { openTurnSnapshotStore, parseNameStatus, parseNumstat } from '../git/gitTurnSnapshotStore'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import type { TurnSnapshotStore } from '../git/turnSnapshotStore'
import { rpcError } from '../rpcResponses'
import { logger } from '@/ui/logger'

const execFileAsync = promisify(execFile)

/** untracked 逐文件计数的上限（防超大仓库海量新文件打爆 exec） */
const UNTRACKED_COUNT_CAP = 100

/** 全文兜底闸上限（字节）：before/after 全文给 web 渲染，超过即不返回（web 落「无法呈现」） */
const MAX_TEXT_BYTES = 4 * 1024 * 1024

/** 全文兜底闸：git 同款二进制嗅探（内容含 NUL 字节）+ 大小上限（utf8 解码后按长度近似）。
    patch 由 git diff 生成、二进制自动只出一行说明，不受此闸影响 */
function asRenderableText(raw: string): string | null {
    if (raw.length > MAX_TEXT_BYTES) return null
    if (raw.includes('\0')) return null
    return raw
}

type ScopeFiles = { files: TurnDiffFileEntry[]; stats: ReturnType<typeof summarizeTurnDiffFiles>; git: null }
type LastTurnScope = { files: TurnDiffFileEntry[]; stats: ReturnType<typeof summarizeTurnDiffFiles>; git: { baseTree: string; headTree: string } } | null

function emptyScope(): ScopeFiles {
    return { files: [], stats: summarizeTurnDiffFiles([]), git: null }
}

/** 由 name-status + numstat 输出组装条目（两命令同 diff 参数，路径按变更后路径对齐） */
function toEntries(statusOut: string, numstatOut: string): TurnDiffFileEntry[] {
    const counts = parseNumstat(numstatOut)
    const entries: TurnDiffFileEntry[] = []
    for (const [path, status] of parseNameStatus(statusOut)) {
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

/** uncommitted = staged ∪ unstaged：按 path 合并计数（kind 取信息量更大的优先） */
function mergeEntries(a: TurnDiffFileEntry[], b: TurnDiffFileEntry[]): TurnDiffFileEntry[] {
    const byPath = new Map<string, TurnDiffFileEntry>()
    const priority: Record<TurnDiffFileEntry['kind'], number> = { add: 3, delete: 2, rename: 1, modify: 0 }
    for (const entry of [...a, ...b]) {
        const existing = byPath.get(entry.path)
        if (!existing) {
            byPath.set(entry.path, { ...entry })
            continue
        }
        existing.additions += entry.additions
        existing.deletions += entry.deletions
        if (priority[entry.kind] > priority[existing.kind]) existing.kind = entry.kind
        existing.binary = existing.binary || entry.binary
        if (!existing.previousPath && entry.previousPath) existing.previousPath = entry.previousPath
    }
    return [...byPath.values()].sort((x, y) => x.path.localeCompare(y.path))
}

export class GitReviewReader {
    private repoRoot: string | null = null

    constructor(private readonly cwd: string) {}

    /** 仓库相对路径安全闸门：拒绝绝对路径、反斜杠与 `..` 逃逸（git 子系统自带同规则，盘上读取同闸门） */
    private static isSafeRepoRelative(path: string): boolean {
        if (path === '' || path.startsWith('/') || path.includes('\\')) return false
        return path.split('/').every((seg) => seg !== '..')
    }

    private async root(): Promise<string | null> {
        if (this.repoRoot !== null) return this.repoRoot
        try {
            this.repoRoot = (await git(this.cwd, ['rev-parse', '--show-toplevel'])).trim()
        } catch {
            this.repoRoot = ''
        }
        return this.repoRoot || null
    }

    /** 失败（含空仓库无 HEAD）返回 null，由调用方决定空档语义 */
    private async gitAtRoot(args: string[]): Promise<string | null> {
        const root = await this.root()
        if (!root) return null
        try {
            return await git(root, args)
        } catch {
            return null
        }
    }

    /**
     * `--no-index` diff 专用执行：git 以退出码 1 表达「有差异」（非失败），
     * execFile 会把这种「成功」当异常抛出——输出须从 error.stdout 取回。
     */
    private async noIndexDiff(args: string[]): Promise<string | null> {
        const root = await this.root()
        if (!root) return null
        try {
            return await git(root, args)
        } catch (e) {
            const out = (e as { stdout?: string }).stdout
            return typeof out === 'string' && out !== '' ? out : null
        }
    }

    private async entries(args: string[]): Promise<TurnDiffFileEntry[]> {
        const [statusOut, numstatOut] = await Promise.all([
            this.gitAtRoot([...args, '--name-status', '-z', '-M']),
            this.gitAtRoot([...args, '--numstat', '-z', '-M']),
        ])
        if (statusOut === null || numstatOut === null) return []
        return toEntries(statusOut, numstatOut)
    }

    /** untracked：status porcelain v2 的 `?` 记录（实证形态 `? path\0`，问号与路径同 token） */
    private async untrackedEntries(): Promise<{ files: TurnDiffFileEntry[]; truncated: boolean }> {
        const statusOut = await this.gitAtRoot(['status', '--porcelain=v2', '-z'])
        if (statusOut === null) return { files: [], truncated: false }
        const tokens = statusOut.split('\0')
        const paths: string[] = []
        // 实证（git 2.x，-z）：untracked 记录为 `? path\0`——问号与路径同 token，空格分隔
        for (const token of tokens) {
            if (token.startsWith('? ')) paths.push(token.slice(2))
        }
        if (paths.length === 0) return { files: [], truncated: false }
        const truncated = paths.length > UNTRACKED_COUNT_CAP
        const counted = truncated ? paths.slice(0, UNTRACKED_COUNT_CAP) : paths
        const files = await Promise.all(counted.map(async (path) => {
            // no-index numstat 的路径列是「 /dev/null <path>」两段拼接（-z 下无法与 parseNumstat
            // 的 key 匹配，实证 2026-09-27）——单文件直取首行前两列，`-` 即二进制
            const stdout = await this.noIndexDiff(['diff', '--no-index', '--numstat', '--', '/dev/null', path])
            const cols = stdout?.split('\n')[0]?.split('\t') ?? []
            const binary = cols[0] === '-' || cols[1] === '-'
            return {
                path,
                kind: 'add' as const,
                additions: binary ? 0 : Number.parseInt(cols[0] ?? '0', 10) || 0,
                deletions: binary ? 0 : Number.parseInt(cols[1] ?? '0', 10) || 0,
                binary,
            }
        }))
        return { files: files.sort((a, b) => a.path.localeCompare(b.path)), truncated }
    }

    /** 审查总览：四档一次拉。非 git 目录返回 unavailable 总开关（web 据此诚实空态） */
    async reviewData(sessionId: string, store: TurnSnapshotStore | null): Promise<unknown> {
        if (!store) {
            return GitReviewDataSchema.parse({
                unavailable: true,
                scopes: { 'last-turn': null, uncommitted: emptyScope(), unstaged: emptyScope(), staged: emptyScope() },
            })
        }

        // last-turn：链尾两树。链只有 baseline（会话启动基线，尚无完成轮次）时视为
        // 无上一轮——回落 HEAD 会把历史未提交改动塞进「上一轮」，违背档位语义
        let lastTurn: LastTurnScope = null
        const chain = await store.listChain(sessionId)
        if (chain.length >= 2) {
            const baseTree = chain.at(-2)!.tree
            const headTree = chain.at(-1)!.tree
            if (baseTree !== headTree) {
                const files = await store.diffTrees(baseTree, headTree)
                lastTurn = { files, stats: summarizeTurnDiffFiles(files), git: { baseTree, headTree } }
            }
        }

        const staged = await this.entries(['diff', '--cached', '-M', 'HEAD'])
        const unstagedTracked = await this.entries(['diff', '-M'])
        const untracked = await this.untrackedEntries()
        const unstaged = [...unstagedTracked, ...untracked.files].sort((a, b) => a.path.localeCompare(b.path))
        const uncommitted = mergeEntries(staged, unstaged)

        return GitReviewDataSchema.parse({
            unavailable: false,
            scopes: {
                'last-turn': lastTurn,
                uncommitted: { files: uncommitted, stats: summarizeTurnDiffFiles(uncommitted), git: null },
                unstaged: {
                    files: unstaged,
                    stats: summarizeTurnDiffFiles(unstaged),
                    git: null,
                    ...(untracked.truncated && { truncated: true }),
                },
                staged: { files: staged, stats: summarizeTurnDiffFiles(staged), git: null },
            },
        })
    }

    /** git show <rev>:<path>（目标不存在返回 null；rev 形如 tree sha / HEAD / 空=暂存区）。
     *  先 cat-file -s 卡大小再读，读出后过文本闸——二进制/超大对象不进全文 */
    private async show(rev: string, path: string): Promise<string | null> {
        const sizeOut = await this.gitAtRoot(['cat-file', '-s', `${rev}:${path}`])
        if (sizeOut === null || Number.parseInt(sizeOut.trim(), 10) > MAX_TEXT_BYTES) return null
        const out = await this.gitAtRoot(['show', `${rev}:${path}`])
        return out === null ? null : asRenderableText(out)
    }

    /** 盘上文件（repo 相对路径）；不存在/超限/二进制返回 null */
    private async readWorktree(path: string): Promise<string | null> {
        const root = await this.root()
        if (!root) return null
        const full = join(root, path)
        try {
            if ((await stat(full)).size > MAX_TEXT_BYTES) return null
            return asRenderableText(await readFile(full, 'utf8'))
        } catch {
            return null
        }
    }

    /** 单文件 diff 三件套（patch 统计/降级用，before/after 全文给 @codemirror/merge 渲染） */
    async fileDiff(query: GitReviewFileQuery): Promise<unknown> {
        if (!GitReviewReader.isSafeRepoRelative(query.path)) {
            throw new Error(`Invalid path: ${query.path}`)
        }
        let patch: string | null
        let before: string | null
        let after: string | null

        if (query.scope === 'last-turn') {
            // rename：基线侧取旧路径（新路径在基线树不存在），patch 双路径让 -M 识别 rename 对
            const beforePath = query.previousPath ?? query.path
            patch = await this.gitAtRoot(['diff', '--find-renames', query.baseTree, query.headTree, '--', beforePath, query.path])
            before = await this.show(query.baseTree, beforePath)
            after = await this.show(query.headTree, query.path)
        } else if (query.scope === 'unstaged') {
            patch = await this.gitAtRoot(['diff', '--', query.path])
            before = await this.show('', query.path)
            after = await this.readWorktree(query.path)
            // untracked：index 无此路径，普通 diff 不覆盖——no-index 兜底（diff 差异以退出码 1 表达）
            if (before === null && after !== null && !patch) {
                patch = await this.noIndexDiff(['diff', '--no-index', '--', '/dev/null', query.path])
            }
        } else if (query.scope === 'staged') {
            patch = await this.gitAtRoot(['diff', '--cached', '--', query.path])
            before = await this.show('HEAD', query.path)
            after = await this.show('', query.path)
        } else {
            // uncommitted：HEAD vs 盘上；untracked 新文件（HEAD 无此路径）用 no-index 兜底
            patch = await this.gitAtRoot(['diff', 'HEAD', '--', query.path])
            before = await this.show('HEAD', query.path)
            after = await this.readWorktree(query.path)
            if (before === null && after !== null && !patch) {
                patch = await this.noIndexDiff(['diff', '--no-index', '--', '/dev/null', query.path])
            }
        }

        return GitReviewFileDiffSchema.parse({ patch: patch ?? '', before, after })
    }
}

async function git(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
    return stdout
}

/** machine 通道 gitReview RPC 注册（cwd 由 hub 从会话 metadata 注入，信任模型同 machineReadFileMeta） */
export function registerGitReviewHandlers(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<{ cwd: string; sessionId: string }, unknown>(GIT_REVIEW_RPC.data, async (data) => {
        const reader = new GitReviewReader(data.cwd)
        try {
            return await reader.reviewData(data.sessionId, await openTurnSnapshotStore(data.cwd))
        } catch (e) {
            logger.debug('[GitReview] reviewData failed', e)
            return rpcError('Failed to collect git review data')
        }
    })
    rpcHandlerManager.registerHandler<{ cwd: string; query: GitReviewFileQuery }, unknown>(GIT_REVIEW_RPC.file, async (data) => {
        try {
            return await new GitReviewReader(data.cwd).fileDiff(data.query)
        } catch (e) {
            logger.debug('[GitReview] fileDiff failed', e)
            return rpcError('Failed to read git diff')
        }
    })
    // 会话删除清引用（ADR 0008 refs 治理，hub best-effort 调用）：git mv 不适用——
    // 快照引用本就不进 index，直接逐个删 ref
    rpcHandlerManager.registerHandler<{ cwd: string; sessionId: string }, unknown>('clearTurnSnapshots', async (data) => {
        try {
            const store = await openTurnSnapshotStore(data.cwd)
            const cleared = store ? await store.clearSession(data.sessionId) : 0
            return { success: true, cleared }
        } catch (e) {
            logger.debug('[GitReview] clearTurnSnapshots failed', e)
            return rpcError('Failed to clear turn snapshots')
        }
    })
}

export type { GitReviewFileDiff }
