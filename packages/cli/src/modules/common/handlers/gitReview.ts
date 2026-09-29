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
 * v2（审查重写，spec .scratch/review-render-rewrite）：DiffTarget 统一寻址的六方法
 * （overview / files / diff / contents / commits / init）——五档语义收口在
 * diffTargetResolver，本模块只做查询编排与降级语义。数据链：patch 主通道 +
 * 全文对懒拉（web pierre hydration），全文只在 contents 方法给。
 *
 * 兜底事实源（spec 2.1）：工具层 journal（.mobi/turn-diffs/<sid>/tool-changes.json）。
 * turn 档 = 快照两树 diff ∪ journal 补入（gitignored 文件；Bash 写文件已进快照，
 * journal 只补 git 视野外）；非 git 目录 turn 档由 journal 全权供数（toolSourceOnly）。
 *
 * cwd 由 hub 从会话 metadata 注入（与 machineReadFileMeta 同信任模型）；路径统一以
 * repoRoot 为基准（git 在 repoRoot 执行，diff 输出的路径即仓库相对路径，盘上读取
 * 同基准）。untracked 行数计数：`git diff --no-index --numstat /dev/null <path>`
 * （ChatGPT 同解，差异以退出码 1 表达须从 stdout 取），超过 UNTRACKED_COUNT_CAP
 * 只列条目不再计数（truncated 事实随响应返回）。
 */

import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import {
    GIT_REVIEW_RPC,
    OVERSIZE_DIFF_LINES,
    ReviewCommitsResultSchema,
    ReviewContentsResultSchema,
    ReviewFileEntrySchema,
    ReviewFilesResultSchema,
    ReviewOverviewSchema,
    ReviewPatchResultSchema,
    summarizeTurnDiffFiles,
    type DiffTarget,
    type ReviewFileEntry,
    type ReviewOverview,
    type TurnDiffFileEntry,
} from '@mobi/shared'
import { assembleDiffEntries, dropTurnSnapshotStoreCache, git, openTurnSnapshotStore } from '../git/gitTurnSnapshotStore'
import { getToolChangesPath, loadToolChangeJournal, ToolChangeJournal } from '../git/toolChangeJournal'
import { resolveDiffTarget } from '../git/diffTargetResolver'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import type { TurnDiffStats } from '@mobi/shared'
import type { TurnSnapshotStore } from '../git/turnSnapshotStore'
import { rpcError } from '../rpcResponses'
import { logger } from '@/ui/logger'

/** untracked 逐文件计数的上限（防超大仓库海量新文件打爆 exec） */
const UNTRACKED_COUNT_CAP = 100

/** 全文闸上限（字节）：before/after 全文给 web 渲染，超过即不返回（reason=oversized） */
const MAX_TEXT_BYTES = 4 * 1024 * 1024

/** commits 分页页长（游标 = 偏移量字符串，取实现简单者） */
const COMMITS_PAGE_SIZE = 50

/** 文本闸：git 同款二进制嗅探（内容含 NUL）+ 大小上限。patch 由 git diff 生成、
    二进制自动只出一行说明，不受此闸影响 */
function gateText(raw: string): { text: string; reason: null } | { text: null; reason: 'binary' | 'oversized' } {
    if (raw.length > MAX_TEXT_BYTES) return { text: null, reason: 'oversized' }
    if (raw.includes('\0')) return { text: null, reason: 'binary' }
    return { text: raw, reason: null }
}

type FulltextSide = { text: string | null; reason: 'missing' | 'binary' | 'oversized' | null }

function missingSide(): FulltextSide {
    return { text: null, reason: 'missing' }
}

/** 单文件 review 条目（journal 兜底源组装） */
export function countLineChanges(before: string | null, after: string | null): { additions: number; deletions: number } {
    const multiset = (lines: string[]): Map<string, number> => {
        const m = new Map<string, number>()
        for (const line of lines) m.set(line, (m.get(line) ?? 0) + 1)
        return m
    }
    const split = (content: string): string[] => {
        const lines = content.split('\n')
        if (lines.at(-1) === '') lines.pop()
        return lines
    }
    const b = multiset(before === null ? [] : split(before))
    const a = multiset(after === null ? [] : split(after))
    let additions = 0
    let deletions = 0
    for (const [line, count] of a) additions += Math.max(count - (b.get(line) ?? 0), 0)
    for (const [line, count] of b) deletions += Math.max(count - (a.get(line) ?? 0), 0)
    return { additions, deletions }
}

function summarizeReviewFiles(files: readonly ReviewFileEntry[]): TurnDiffStats {
    return {
        files: files.length,
        additions: files.reduce((sum, f) => sum + (f.additions ?? 0), 0),
        deletions: files.reduce((sum, f) => sum + (f.deletions ?? 0), 0),
    }
}

/** journal → review 条目：before null 且 after 有 = 新建（add），其余 modify；计数行多重集近似 */
function journalToEntries(journal: { listPaths(): string[]; get(path: string): { beforeContent: string | null; afterContent: string | null } | undefined }): ReviewFileEntry[] {
    return journal.listPaths().sort((a, b) => a.localeCompare(b)).map((path) => {
        const entry = journal.get(path)!
        const kind = entry.beforeContent === null && entry.afterContent !== null ? 'add' as const : 'modify' as const
        const counts = countLineChanges(entry.beforeContent, entry.afterContent)
        const lineCount = (entry.afterContent ?? entry.beforeContent ?? '').split('\n').length
        return ReviewFileEntrySchema.parse({
            path,
            previousPath: null,
            kind,
            additions: counts.additions,
            deletions: counts.deletions,
            binary: false,
            untracked: true,
            oversized: lineCount > OVERSIZE_DIFF_LINES,
        })
    })
}

function totalWriteCount(journal: { listPaths(): string[]; get(path: string): { writeCount: number } | undefined }): number {
    return journal.listPaths().reduce((sum, path) => sum + (journal.get(path)?.writeCount ?? 0), 0)
}

/** turn 档审查用 journal 装载（after 补全）：Edit 类 toolUseResult 只带 originalFile
 *  （before 全文）不带 after——journal 占位 null（spec 2.1「归并规则自理」）。消费时
 *  用磁盘当前内容补 after（编辑后文件已删 = null 保持，全删语义成立）；before 缺失
 *  （Write 只记 after）不补。E2E 实证（票09）：缺此补全时非 git turn 档统计与全文对
 *  呈「整文件删除」假象（+0 -2 / after missing） */
async function loadToolJournalForReview(sessionId: string, cwd: string): Promise<ToolChangeJournal> {
    const journal = await loadToolChangeJournal(getToolChangesPath(cwd, sessionId))
    const snapshot = journal.snapshot()
    let patched = false
    for (const [path, entry] of Object.entries(snapshot.files)) {
        if (entry.afterContent !== null || entry.beforeContent === null) continue
        const abs = isAbsolute(path) ? path : join(cwd, path)
        try {
            entry.afterContent = await readFile(abs, 'utf8')
            patched = true
        } catch {
            // 文件已删除：保持 null = 全删
        }
    }
    return patched ? ToolChangeJournal.restore(snapshot) : journal
}

export class GitReviewReader {
    private repoRoot: string | null = null

    constructor(private readonly cwd: string) {}

    /** 仓库相对路径安全闸门：拒绝绝对路径、反斜杠与 `..` 逃逸（git 子系统自带同规则，盘上读取同闸门） */
    private static isSafeRepoRelative(path: string): boolean {
        if (path === '' || path.startsWith('/') || path.includes('\\')) return false
        return path.split('/').every((seg) => seg !== '..')
    }

    /** journal 供数档（toolSourceOnly）的路径闸：path 是工具输入的文件系统路径
     *  （E2E 实证为绝对路径；相对时以 cwd 为基准），只要求解析后不逃出 cwd */
    private static isSafeWorkspacePath(path: string, cwd: string): boolean {
        if (path === '' || path.includes('\0') || path.includes('\\')) return false
        const abs = resolve(isAbsolute(path) ? path : join(cwd, path))
        return abs === cwd || abs.startsWith(cwd + sep)
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

    /** git 判定（resolver 注入用）：与 store 解耦——store 为 null 只代表快照链不可用。
     *  注意 root() 二次调用返回缓存空串（非 null），须按 falsy 判定 */
    private async isGitRepo(): Promise<boolean> {
        return Boolean(await this.root())
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

    /** journal 全文对 → 真 unified patch（git diff --no-index 目录模式）：before/after 各
     *  落 a/ b/ 子目录的同名文件，输出的 a/<basename> b/<basename> 头正是 pierre 期望的
     *  形状，无需重写。单侧 null = add/delete（对端 /dev/null 语义由目录缺文件表达）。
     *  临时目录即写即清，失败吞错返回空串（web 落 contents 通道兜底） */
    private async synthesizePatchFromContents(path: string, before: string | null, after: string | null): Promise<string> {
        if (before === null && after === null) return ''
        const dir = await mkdtemp(join(tmpdir(), 'mobi-review-patch-'))
        try {
            const base = basename(path)
            const sideA = join(dir, 'a', base)
            const sideB = join(dir, 'b', base)
            await mkdir(dirname(sideA), { recursive: true })
            await mkdir(dirname(sideB), { recursive: true })
            if (before !== null) await writeFile(sideA, before)
            if (after !== null) await writeFile(sideB, after)
            // 非 git 目录 root 为 null（noIndexDiff 的 root 前置会短路），直接以临时目录为执行点
            let raw: string
            try {
                raw = await git(dir, ['diff', '--no-index', '--', join(dir, 'a'), join(dir, 'b')])
            } catch (e) {
                // git diff --no-index 以退出码 1 表达差异，stdout 在异常对象上
                raw = (e as { stdout?: string }).stdout ?? ''
            }
            // 头部剥临时目录前缀（git 规范化绝对路径的前导 /）：a<TMP>/a/app.ts → a/app.ts
            return raw.replaceAll(`a${dir}/a/`, 'a/').replaceAll(`b${dir}/b/`, 'b/')
        } catch (e) {
            logger.debug('[GitReviewReader] synthesize patch failed', e)
            return ''
        } finally {
            await rm(dir, { recursive: true, force: true })
        }
    }

    /** name-status + numstat 组装（args 含 'diff' 动词；组装规则单源在 gitTurnSnapshotStore） */
    private async entries(args: string[]): Promise<TurnDiffFileEntry[]> {
        const [statusOut, numstatOut] = await Promise.all([
            this.gitAtRoot([...args, '--name-status', '-z', '-M']),
            this.gitAtRoot([...args, '--numstat', '-z', '-M']),
        ])
        if (statusOut === null || numstatOut === null) return []
        return assembleDiffEntries(statusOut, numstatOut)
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

    /** 由 journal 补入 git 视野外的路径（gitignored 文件；已在 git 条目中的路径不重复） */
    private mergeJournalSupplement(gitFiles: TurnDiffFileEntry[], journal: Awaited<ReturnType<typeof loadToolChangeJournal>>): TurnDiffFileEntry[] {
        const known = new Set(gitFiles.map((f) => f.path))
        const supplement = journalToEntries(journal).filter((f) => !known.has(f.path))
        return [...gitFiles, ...supplement.map((f) => ({ path: f.path, kind: f.kind, additions: f.additions ?? 0, deletions: f.deletions ?? 0 }))]
    }

    /** 审查数据版本（陈旧性判定的缓存键原料，非单调序号）：快照链尾序号为百万位刻度
     *  + 工作区 status 条数；非 git 用 journal 写入次数之和 */
    private async computeGeneration(sessionId: string, store: TurnSnapshotStore | null): Promise<number> {
        if (!store) {
            return totalWriteCount(await loadToolChangeJournal(getToolChangesPath(this.cwd, sessionId)))
        }
        const [chain, statusOut] = await Promise.all([
            store.listChain(sessionId),
            this.gitAtRoot(['status', '--porcelain=v2', '-z']),
        ])
        const dirty = statusOut ? statusOut.split('\0').filter((t) => t.trim() !== '').length : 0
        return (chain.at(-1)?.index ?? 0) * 1_000_000 + dirty
    }

    // ── v2 六方法 ──────────────────────────────────────────────────────────────

    /** 总览：逐档可用性 + 各档统计。非 git：turn 非 null（journal 供数），git 系全 null */
    async overview(sessionId: string, store: TurnSnapshotStore | null): Promise<ReviewOverview> {
        const journal = await loadToolJournalForReview(sessionId, this.cwd)

        if (!store) {
            const turnFiles = journalToEntries(journal)
            const turnStats = summarizeReviewFiles(turnFiles)
            return ReviewOverviewSchema.parse({
                unavailableScopes: { turn: false, uncommitted: true, unstaged: true, staged: true, commit: true },
                isGitRepository: false,
                scopes: {
                    turn: { fileCount: turnStats.files, additions: turnStats.additions, deletions: turnStats.deletions },
                    uncommitted: null,
                    unstaged: null,
                    staged: null,
                },
                truncated: false,
                targetGeneration: totalWriteCount(journal),
            })
        }

        // 四路查询互不依赖 → 并行（总览延迟 = 最慢一路而非四路之和）
        const [last, stagedEntries, unstagedTracked, untracked, headExists] = await Promise.all([
            store.lastTurnDiff(sessionId),
            this.entries(['diff', '--cached', '-M', 'HEAD']),
            this.entries(['diff', '-M']),
            this.untrackedEntries(),
            this.gitAtRoot(['rev-parse', '--verify', 'HEAD']).then((v) => v !== null),
        ])

        const turnGit = last ? last.files : []
        const turnFull = this.mergeJournalSupplement(turnGit, journal)
        const unstagedFull = [...unstagedTracked, ...untracked.files].sort((a, b) => a.path.localeCompare(b.path))
        const uncommittedFull = mergeEntries(stagedEntries, unstagedFull)

        const summary = (files: TurnDiffFileEntry[]) => {
            const stats = summarizeTurnDiffFiles(files)
            return { fileCount: stats.files, additions: stats.additions, deletions: stats.deletions }
        }

        return ReviewOverviewSchema.parse({
            unavailableScopes: { turn: false, uncommitted: false, unstaged: false, staged: false, commit: !headExists },
            isGitRepository: true,
            scopes: {
                turn: summary(turnFull),
                uncommitted: summary(uncommittedFull),
                unstaged: summary(unstagedFull),
                staged: summary(stagedEntries),
            },
            truncated: untracked.truncated,
            targetGeneration: await this.computeGeneration(sessionId, store),
        })
    }

    /** 文件明细：五档统一形状。turn 档 = 快照两树 ∪ journal 补入；工作区三档纯 git */
    async files(sessionId: string, target: DiffTarget, store: TurnSnapshotStore | null): Promise<unknown> {
        const resolved = await resolveDiffTarget(sessionId, target, { isGitRepository: await this.isGitRepo(), snapshotStore: store })
        const generation = await this.computeGeneration(sessionId, store)

        if (resolved.toolSourceOnly) {
            const files = journalToEntries(await loadToolJournalForReview(sessionId, this.cwd))
            return ReviewFilesResultSchema.parse({ files, stats: summarizeReviewFiles(files), truncated: false, targetGeneration: generation })
        }
        if (!resolved.isGitRepository) throw new Error('target requires a git repository')

        const includeUntracked = target.kind === 'worktree' && target.area !== 'staged'
        const [tracked, untracked] = await Promise.all([
            this.entries(['diff', ...resolved.diffArgs, '-M']),
            includeUntracked ? this.untrackedEntries() : Promise.resolve({ files: [] as TurnDiffFileEntry[], truncated: false }),
        ])
        const merged = target.kind === 'worktree' && target.area === 'uncommitted'
            ? mergeEntries(tracked, [...untracked.files])
            : [...tracked, ...untracked.files].sort((a, b) => a.path.localeCompare(b.path))
        // turn 档补入 journal（git 视野外路径，gitignored 等）；已在 git 条目中的不重复。
        // supplement 保持 review 条目形状（untracked 事实不经过 TurnDiffFileEntry 有损转换）
        let files = merged.map(toReviewEntry)
        if (target.kind === 'turn') {
            const journal = await loadToolJournalForReview(sessionId, this.cwd)
            const known = new Set(files.map((f) => f.path))
            files = [...files, ...journalToEntries(journal).filter((f) => !known.has(f.path))]
                .sort((a, b) => a.path.localeCompare(b.path))
        }
        return ReviewFilesResultSchema.parse({
            files,
            stats: summarizeReviewFiles(files),
            truncated: untracked.truncated,
            targetGeneration: generation,
        })
    }

    /** 单文件 patch（pierre PatchDiff 主输入）。空 patch = 无 patch 可给（journal 源/二进制/
     *  超预算），web 落 contents 通道或诚实降级 */
    async patch(sessionId: string, target: DiffTarget, path: string, store: TurnSnapshotStore | null): Promise<unknown> {
        const resolved = await resolveDiffTarget(sessionId, target, { isGitRepository: await this.isGitRepo(), snapshotStore: store })
        // 路径闸按供数源分流（先 resolve 后闸）：journal 档的 path 是文件系统路径，git 档是仓库相对路径
        if (resolved.toolSourceOnly) {
            if (!GitReviewReader.isSafeWorkspacePath(path, this.cwd)) throw new Error(`Invalid path: ${path}`)
            const entry = (await loadToolJournalForReview(sessionId, this.cwd)).get(path)
            if (!entry) return ReviewPatchResultSchema.parse({ patch: '', previousPath: null, oversized: false, binary: false })
            const patch = await this.synthesizePatchFromContents(path, entry.beforeContent, entry.afterContent)
            const oversized = (patch.split('\n').length) > OVERSIZE_DIFF_LINES
            return ReviewPatchResultSchema.parse({ patch: oversized ? '' : patch, previousPath: null, oversized, binary: false })
        }
        if (!GitReviewReader.isSafeRepoRelative(path)) {
            throw new Error(`Invalid path: ${path}`)
        }
        if (!resolved.isGitRepository) throw new Error('target requires a git repository')

        // rename 旧路径解析：目标 pair 的 name-status 单查（entry 的 previousPath）
        const entries = await this.entries(['diff', ...resolved.diffArgs, '-M'])
        const previousPath = entries.find((e) => e.path === path)?.previousPath ?? null
        const pathArgs = previousPath ? [previousPath, path] : [path]

        // untracked：index 无此路径，普通 diff 不覆盖——no-index 兜底（仅工作区非 staged 档）
        let patch = await this.gitAtRoot(['diff', ...resolved.diffArgs, '--find-renames', '--', ...pathArgs])
        let numstat = await this.gitAtRoot(['diff', ...resolved.diffArgs, '--numstat', '--', ...pathArgs])
        if (target.kind === 'worktree' && target.area !== 'staged' && !patch) {
            const noIndex = await this.noIndexDiff(['diff', '--no-index', '--', '/dev/null', path])
            if (noIndex) {
                patch = noIndex
                numstat = await this.noIndexDiff(['diff', '--no-index', '--numstat', '--', '/dev/null', path])
            }
        }

        // 二进制：numstat 计数列 `-`——patch 不出（git 的一行说明对渲染无意义）
        const cols = numstat?.split('\n')[0]?.split('\t') ?? []
        const binary = cols[0] === '-' || cols[1] === '-'
        const oversized = (patch?.split('\n').length ?? 0) > OVERSIZE_DIFF_LINES
        return ReviewPatchResultSchema.parse({
            patch: binary || oversized ? '' : patch ?? '',
            previousPath,
            oversized,
            binary,
        })
    }

    /** 全文对（pierre hydration 懒拉）。reason = 两侧都拿不到时的降级原因；一侧有值
     *  （add/delete 的合法半对）reason 为 null */
    async contents(sessionId: string, target: DiffTarget, path: string, store: TurnSnapshotStore | null): Promise<unknown> {
        const resolved = await resolveDiffTarget(sessionId, target, { isGitRepository: await this.isGitRepo(), snapshotStore: store })
        // 路径闸按供数源分流（同 patch）：journal 档的 path 是文件系统路径，git 档是仓库相对路径
        if (resolved.toolSourceOnly) {
            if (!GitReviewReader.isSafeWorkspacePath(path, this.cwd)) throw new Error(`Invalid path: ${path}`)
            const entry = (await loadToolJournalForReview(sessionId, this.cwd)).get(path)
            if (!entry) return ReviewContentsResultSchema.parse({ before: null, after: null, reason: 'missing' })
            const before = entry.beforeContent === null ? missingSide() : gateText(entry.beforeContent)
            const after = entry.afterContent === null ? missingSide() : gateText(entry.afterContent)
            return ReviewContentsResultSchema.parse({
                before: before.text,
                after: after.text,
                reason: before.text === null && after.text === null ? pickDegradedReason(before.reason, after.reason) : null,
            })
        }
        if (!GitReviewReader.isSafeRepoRelative(path)) {
            throw new Error(`Invalid path: ${path}`)
        }
        if (!resolved.isGitRepository) throw new Error('target requires a git repository')

        // rename：基线侧取旧路径（新路径在基线树不存在）——name-status 单查解析
        const previousPath = resolved.headRev !== null
            ? (await this.entries(['diff', ...resolved.diffArgs, '-M'])).find((e) => e.path === path)?.previousPath ?? null
            : null
        const [base, head] = await Promise.all([
            this.showRev(resolved.baseRev!, previousPath ?? path),
            resolved.headRev === null ? this.readWorktreeRev(path) : this.showRev(resolved.headRev, path),
        ])
        return ReviewContentsResultSchema.parse({
            before: base.text,
            after: head.text,
            reason: base.text === null && head.text === null ? pickDegradedReason(base.reason, head.reason) : null,
        })
    }

    /** 历史提交（游标分页，游标 = 偏移量字符串——sha 游标需 ^exclude 语义，偏移最简单） */
    async commits(cursor?: string): Promise<unknown> {
        const skip = Number.parseInt(cursor ?? '0', 10) || 0
        const out = await this.gitAtRoot([
            'log', `--skip=${skip}`, `--max-count=${COMMITS_PAGE_SIZE + 1}`,
            '--format=%H%x00%P%x00%s%x00%an%x00%at',
        ])
        if (out === null || out.trim() === '') {
            return ReviewCommitsResultSchema.parse({ commits: [], nextCursor: null })
        }
        const records = out.split('\n').filter((line) => line.trim() !== '')
        const hasMore = records.length > COMMITS_PAGE_SIZE
        const commits = records.slice(0, COMMITS_PAGE_SIZE).map((line) => {
            const [sha, parents, subject, authorName, timestamp] = line.split('\0')
            return {
                sha: sha!,
                // 多父取第一父（first-parent 语义，Codex 同款）；根提交无父 = null
                parentSha: parents?.split(' ')[0] || null,
                subject: subject ?? '',
                authorName: authorName ?? '',
                authorTimestamp: Number.parseInt(timestamp ?? '0', 10) || 0,
            }
        })
        return ReviewCommitsResultSchema.parse({ commits, nextCursor: hasMore ? String(skip + COMMITS_PAGE_SIZE) : null })
    }

    /** 一键 git init（Codex 同款非 git 兜底）：成功后失效 reader 与 store 的仓库判定缓存 */
    async initRepo(): Promise<unknown> {
        try {
            await git(this.cwd, ['init'])
            this.repoRoot = null
            dropTurnSnapshotStoreCache(this.cwd)
            return { success: true, error: null }
        } catch (e) {
            return { success: false, error: e instanceof Error ? e.message : String(e) }
        }
    }

    // ── 全文读取设施 ───────────────────────────────────────────────────────────

    /** git show <rev>:<path>（目标不存在返回 null；rev 形如 tree sha / HEAD / ''=index）。
     *  先 cat-file -s 卡大小再读，缺失/二进制/超大三态区分（reason 供新协议降级原因） */
    private async showRev(rev: string, path: string): Promise<FulltextSide> {
        const sizeOut = await this.gitAtRoot(['cat-file', '-s', `${rev}:${path}`])
        if (sizeOut === null) return missingSide()
        if (Number.parseInt(sizeOut.trim(), 10) > MAX_TEXT_BYTES) return { text: null, reason: 'oversized' }
        const out = await this.gitAtRoot(['show', `${rev}:${path}`])
        if (out === null) return missingSide()
        const gated = gateText(out)
        return gated.text !== null ? { text: gated.text, reason: null } : { text: null, reason: gated.reason }
    }

    /** 盘上文件（repo 相对路径）；不存在=missing / 超限=oversized / 二进制=binary */
    private async readWorktreeRev(path: string): Promise<FulltextSide> {
        const root = await this.root()
        if (!root) return missingSide()
        const full = join(root, path)
        try {
            if ((await stat(full)).size > MAX_TEXT_BYTES) return { text: null, reason: 'oversized' }
            const gated = gateText(await readFile(full, 'utf8'))
            return gated.text !== null ? { text: gated.text, reason: null } : { text: null, reason: gated.reason }
        } catch {
            return missingSide()
        }
    }
}

// ── 组装辅助（模块级纯函数，测试直采）──────────────────────────────────────────

/** 降级原因择优：binary > oversized > missing（两侧都空时才有意义） */
function pickDegradedReason(a: FulltextSide['reason'], b: FulltextSide['reason']): 'binary' | 'oversized' | 'missing' {
    if (a === 'binary' || b === 'binary') return 'binary'
    if (a === 'oversized' || b === 'oversized') return 'oversized'
    return 'missing'
}

/** git 条目 → review 条目（oversized 单点打标；untracked=false 由调用方向补） */
function toReviewEntry(e: TurnDiffFileEntry): ReviewFileEntry {
    return ReviewFileEntrySchema.parse({
        path: e.path,
        previousPath: e.previousPath ?? null,
        kind: e.kind,
        additions: e.additions,
        deletions: e.deletions,
        binary: e.binary ?? false,
        untracked: false,
        oversized: e.additions + e.deletions > OVERSIZE_DIFF_LINES,
    })
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

/**
 * machine 通道 gitReview RPC 注册（cwd 由 hub 从会话 metadata 注入，信任模型同 machineReadFileMeta）。
 * git 执行统一走 gitTurnSnapshotStore 的收口 git()；本模块只负责查询编排与降级语义。
 */
export function registerGitReviewHandlers(rpcHandlerManager: RpcHandlerManager): void {
    // 会话删除清引用（ADR 0008 refs 治理，hub best-effort 调用）：git mv 不适用——
    // 快照引用本就不进 index，直接逐个删 ref
    rpcHandlerManager.registerHandler<{ cwd: string; sessionId: string }, unknown>(GIT_REVIEW_RPC.clear, async (data) => {
        try {
            const store = await openTurnSnapshotStore(data.cwd)
            const cleared = store ? await store.clearSession(data.sessionId) : 0
            return { success: true, cleared }
        } catch (e) {
            logger.debug('[GitReview] clearTurnSnapshots failed', e)
            return rpcError('Failed to clear turn snapshots')
        }
    })

    // ── v2 六方法 ──
    rpcHandlerManager.registerHandler<{ cwd: string; sessionId: string }, unknown>(GIT_REVIEW_RPC.overview, async (data) => {
        try {
            return await readerFor(data.cwd).overview(data.sessionId, await openTurnSnapshotStore(data.cwd))
        } catch (e) {
            logger.debug('[GitReview] overview failed', e)
            return rpcError('Failed to collect review overview')
        }
    })
    rpcHandlerManager.registerHandler<{ cwd: string; sessionId: string; target: DiffTarget }, unknown>(GIT_REVIEW_RPC.files, async (data) => {
        try {
            return await readerFor(data.cwd).files(data.sessionId, data.target, await openTurnSnapshotStore(data.cwd))
        } catch (e) {
            logger.debug('[GitReview] files failed', e)
            return rpcError('Failed to list review files')
        }
    })
    rpcHandlerManager.registerHandler<{ cwd: string; sessionId: string; target: DiffTarget; path: string }, unknown>(GIT_REVIEW_RPC.diff, async (data) => {
        try {
            return await readerFor(data.cwd).patch(data.sessionId, data.target, data.path, await openTurnSnapshotStore(data.cwd))
        } catch (e) {
            logger.debug('[GitReview] diff failed', e)
            return rpcError('Failed to read review diff')
        }
    })
    rpcHandlerManager.registerHandler<{ cwd: string; sessionId: string; target: DiffTarget; path: string }, unknown>(GIT_REVIEW_RPC.contents, async (data) => {
        try {
            return await readerFor(data.cwd).contents(data.sessionId, data.target, data.path, await openTurnSnapshotStore(data.cwd))
        } catch (e) {
            logger.debug('[GitReview] contents failed', e)
            return rpcError('Failed to read review contents')
        }
    })
    rpcHandlerManager.registerHandler<{ cwd: string; cursor?: string }, unknown>(GIT_REVIEW_RPC.commits, async (data) => {
        try {
            return await readerFor(data.cwd).commits(data.cursor)
        } catch (e) {
            logger.debug('[GitReview] commits failed', e)
            return rpcError('Failed to list commits')
        }
    })
    rpcHandlerManager.registerHandler<{ cwd: string }, unknown>(GIT_REVIEW_RPC.init, async (data) => {
        try {
            return await readerFor(data.cwd).initRepo()
        } catch (e) {
            logger.debug('[GitReview] init failed', e)
            return rpcError('Failed to initialize git repository')
        }
    })
}

export type { ReviewOverview }

/**
 * memoized 工厂：reader 按 cwd 复用，私有 repoRoot 缓存才真正跨请求生效
 * （每次 RPC new 实例的话，首个 rev-parse 之后缓存即随实例丢弃，每请求都要重跑）。
 * 缓存值只是 cwd 解析出的仓库根路径；仓库消失时 git 调用自然失败 → gitAtRoot null
 * → 各档诚实置空，无需失效机制（init 由 initRepo 主动失效）。规模上界 = 出现过的
 * 工作区目录数，无需淘汰。
 */
const readers = new Map<string, GitReviewReader>()

function readerFor(cwd: string): GitReviewReader {
    let reader = readers.get(cwd)
    if (!reader) {
        reader = new GitReviewReader(cwd)
        readers.set(cwd, reader)
    }
    return reader
}
