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
 * turn 档供数（turn-archive B）：统一经 TurnAttributionProvider（归档唯一供数源）——
 * patch 直读归档封口定稿、contents 空降级（归档只存统计+patch，全文零进盘）。
 *
 * cwd 由 daemon 从会话 metadata 注入（与 hostReadFileMeta 同信任模型）；路径统一以
 * repoRoot 为基准（git 在 repoRoot 执行，diff 输出的路径即仓库相对路径，盘上读取
 * 同基准）。untracked 行数计数：`git diff --no-index --numstat /dev/null <path>`
 * （ChatGPT 同解，差异以退出码 1 表达须从 stdout 取），超过 UNTRACKED_COUNT_CAP
 * 只列条目不再计数（truncated 事实随响应返回）。
 */

import { readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
    GIT_REVIEW_RPC,
    OVERSIZE_DIFF_LINES,
    REVIEW_RENDER_MAX_LINES,
    ReviewCommitsResultSchema,
    ReviewContentsResultSchema,
    ReviewFilesResultSchema,
    ReviewOverviewSchema,
    ReviewPatchResultSchema,
    summarizeTurnDiffFiles,
    type DiffTarget,
    type ReviewOverview,
    type TurnDiffFileEntry,
} from '@mobi/shared'
import { assembleDiffEntries, git, MOBI_STATE_DIR, parseNameStatus, textLineCount } from '@mobi/node-core/git/gitExec'
import { FileTurnArchiveStore, getTurnArchivePath, type TurnArchiveRecord } from '@mobi/node-core/git/turnArchiveStore'
import { getTurnFulltextRoot } from '@mobi/node-core/git/turnFulltextStore'
import { gatePathForSource, toReviewEntry, TurnAttributionProvider } from '@mobi/node-core/git/turnAttributionProvider'
import { resolveDiffTarget } from '@mobi/node-core/git/diffTargetResolver'
import type { TurnDiffStats } from '@mobi/shared'
import { rpcError } from './rpcResponses'
import { logger } from '@mobi/node-core/logger'

/** untracked 逐文件计数的上限（防超大仓库海量新文件打爆 exec） */
const UNTRACKED_COUNT_CAP = 100

/** 全文闸上限（字节）：before/after 全文给 web 渲染，超过即不返回（reason=oversized） */
const MAX_TEXT_BYTES = 4 * 1024 * 1024

/** commits 分页页长（游标 = 偏移量字符串，取实现简单者） */
const COMMITS_PAGE_SIZE = 50

/** 文本闸：git 同款二进制嗅探（内容含 NUL）+ 大小上限（只闸字节与二进制，不闸行数
    ——本闸服务 contents 全文对（hydration 展开折叠上下文），普通大源文件是合法输入；
    行数闸是 patch 渲染口径，单源在 truncatePatch）。patch 由 git diff 生成、二进制
    自动只出一行说明，不走此闸 */
function gateText(raw: string): { text: string; reason: null } | { text: null; reason: 'binary' | 'oversized' } {
    if (raw.length > MAX_TEXT_BYTES) return { text: null, reason: 'oversized' }
    if (raw.includes('\0')) return { text: null, reason: 'binary' }
    return { text: raw, reason: null }
}

/**
 * patch 渲染截断：超过 REVIEW_RENDER_MAX_LINES 行只返回前 N 行（API 不全量返回，
 * 防超大 diff 打爆传输与渲染），truncatedLines 带总行数供 web 出「Open in Viewer」。
 * 按行硬切——pierre 对截断在 hunk 中间的 patch 容忍（渲染到截断处）。行数口径单源
 * textLineCount（尾换行不算新行）；导出供测试直采行数闸边界
 */
export function truncatePatch(patch: string): { patch: string; truncatedLines: number } {
    const total = textLineCount(patch)
    if (total <= REVIEW_RENDER_MAX_LINES) return { patch, truncatedLines: 0 }
    return { patch: patch.split('\n').slice(0, REVIEW_RENDER_MAX_LINES).join('\n'), truncatedLines: total }
}

type FulltextSide = { text: string | null; reason: 'missing' | 'binary' | 'oversized' | null }

function missingSide(): FulltextSide {
    return { text: null, reason: 'missing' }
}

function summarizeReviewFiles(files: readonly { additions?: number | null; deletions?: number | null }[]): TurnDiffStats {
    return {
        files: files.length,
        additions: files.reduce((sum, f) => sum + (f.additions ?? 0), 0),
        deletions: files.reduce((sum, f) => sum + (f.deletions ?? 0), 0),
    }
}

export class GitReviewReader {
    private repoRoot: string | null = null

    constructor(private readonly cwd: string) {}

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

    /** git 判定（resolver / 供数器注入用）：与 store 解耦——store 为 null 只代表快照链
     *  不可用。注意 root() 二次调用返回缓存空串（非 null），须按 falsy 判定 */
    private async isGitRepo(): Promise<boolean> {
        return Boolean(await this.root())
    }

    /** turn 档供数器（收口面）：随请求装配（归档唯一供数源，B 方案后无降级链） */
    private turnAttribution(): TurnAttributionProvider {
        return new TurnAttributionProvider(this.cwd)
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

    /** rename 旧路径单查（name-status 一条命令——entries 的 numstat 半边此处用不到，
     *  省一次全树 diff） */
    private async previousPathFor(diffArgs: string[], path: string): Promise<string | null> {
        const statusOut = await this.gitAtRoot([...diffArgs, '--name-status', '-z', '-M'])
        if (statusOut === null) return null
        for (const [newPath, record] of parseNameStatus(statusOut)) {
            if (newPath === path) return record.previousPath ?? null
        }
        return null
    }

    /** name-status + numstat 组装（args 含 'diff' 动词；组装规则单源在 gitExec） */
    private async entries(args: string[]): Promise<TurnDiffFileEntry[]> {
        const [statusOut, numstatOut] = await Promise.all([
            this.gitAtRoot([...args, '--name-status', '-z', '-M']),
            this.gitAtRoot([...args, '--numstat', '-z', '-M']),
        ])
        if (statusOut === null || numstatOut === null) return []
        return assembleDiffEntries(statusOut, numstatOut)
    }

    /** untracked：status porcelain v2 的 `?` 记录（实证形态 `? path\0`，问号与路径同 token）。
     *  statusOut 可传入共享的 status 查询（overview/files 与 generation 同一次 status 喂
     *  两者，省一次全工作区扫描） */
    private async untrackedEntries(statusOut?: Promise<string | null>): Promise<{ files: TurnDiffFileEntry[]; truncated: boolean }> {
        const raw = await (statusOut ?? this.gitAtRoot(['status', '--porcelain=v2', '-z']))
        if (raw === null) return { files: [], truncated: false }
        const tokens = raw.split('\0')
        const paths: string[] = []
        // 实证（git 2.x，-z）：untracked 记录为 `? path\0`——问号与路径同 token，空格分隔。
        // .mobi/ 内部状态目录过滤（审查 v3 票04 留白收口，MOBI_STATE_DIR 单源）：用户项目
        // 未 gitignore 时 journal/归档文件会以 untracked 出现，混进工作区实况档是噪音
        for (const token of tokens) {
            if (!token.startsWith('? ')) continue
            const path = token.slice(2)
            if (isMobiStatePath(path)) continue
            paths.push(path)
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

    /** 审查数据版本（陈旧性判定的缓存键，非单调序号；turn-archive B 票02）：
     *  `floor(sealedAt/10)*10000 + min(dirty,9999)`——0.1s 封口精度刻度 × 10000 +
     *  工作区 status 条数刻度。同进程内按 (sealedAt, dirty) 状态对单调化（见下）。
     *  statusOut 可传入共享的 status 查询（与 untrackedEntries 同一次喂两者）；非 git
     *  目录 gitAtRoot null → dirty 0，generation 只随封口推进 */
    private lastGenState: { turnIndex: number; sealedAt: number; dirty: number; generation: number } | null = null

    private async computeGeneration(sessionId: string, statusOut?: Promise<string | null>): Promise<number> {
        const latest = await this.turnArchiveLatest(sessionId)
        const sealedAt = latest?.sealedAt ?? 0
        const turnIndex = latest?.turnIndex ?? 0
        const raw = await (statusOut ?? this.gitAtRoot(['status', '--porcelain=v2', '-z']))
        // dirty 刻度（记录数，非 token 数——porcelain v2 的 path 是独立 token）与
        // untrackedEntries 同口径：.mobi 状态目录不算工作区改动
        const dirty = raw
            ? raw.split('\0').filter((t) => {
                if (t.startsWith('? ')) return !isMobiStatePath(t.slice(2))
                return /^[12u] /.test(t)
            }).length
            : 0
        // 单调化：公式在同 0.1s 内两次封口且 dirty 未变时不前进（同 ms 连封可达，
        // queue 快速连轮场景），缓存键会永不前进、陈旧数据不自愈——按 (封口轮, 刻度,
        // dirty) 状态对判状态：未变返回原键（同状态同代），前进时保证键严格大于此前
        // 任何值
        const prev = this.lastGenState
        if (prev !== null && prev.turnIndex === turnIndex && prev.sealedAt === sealedAt && prev.dirty === dirty) return prev.generation
        const generation = Math.max(Math.floor(sealedAt / 10) * 10000 + Math.min(dirty, 9999), prev !== null ? prev.generation + 1 : 0)
        this.lastGenState = { turnIndex, sealedAt, dirty, generation }
        return generation
    }

    /** 最新封口轮（generation 的封口刻度来源） */
    private async turnArchiveLatest(sessionId: string): Promise<TurnArchiveRecord | null> {
        try {
            return await new FileTurnArchiveStore(getTurnArchivePath(this.cwd, sessionId)).loadLatest()
        } catch {
            return null
        }
    }

    // ── v2 六方法 ──────────────────────────────────────────────────────────────

    /** 总览：逐档可用性 + 各档统计。非 git：turn 非 null（供数器 journal 档供数），
     *  git 系全 null。turn 档统计统一走 TurnAttributionProvider（审查 v3 反转） */
    async overview(sessionId: string): Promise<ReviewOverview> {
        if (!(await this.isGitRepo())) {
            const turnStats = summarizeReviewFiles(await this.turnAttribution().entriesOf(sessionId, { kind: 'turn' }))
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
                targetGeneration: await this.computeGeneration(sessionId),
            })
        }

        // 五路查询互不依赖 → 并行（总览延迟 = 最慢一路而非五路之和）。status 查询
        // 单跑一份同时喂 untracked 与 generation（全工作区扫描是最贵的 git 操作）
        const statusTask = this.gitAtRoot(['status', '--porcelain=v2', '-z'])
        const [turnEntries, stagedEntries, unstagedTracked, untracked, headExists] = await Promise.all([
            this.turnAttribution().entriesOf(sessionId, { kind: 'turn' }),
            this.entries(['diff', '--cached', '-M', 'HEAD']),
            this.entries(['diff', '-M']),
            this.untrackedEntries(statusTask),
            this.gitAtRoot(['rev-parse', '--verify', 'HEAD']).then((v) => v !== null),
        ])

        const unstagedFull = [...unstagedTracked, ...untracked.files].sort((a, b) => a.path.localeCompare(b.path))
        const uncommittedFull = mergeEntries(stagedEntries, unstagedFull)

        const summary = (files: TurnDiffFileEntry[]) => {
            const stats = summarizeTurnDiffFiles(files)
            return { fileCount: stats.files, additions: stats.additions, deletions: stats.deletions }
        }
        const turnSummary = summarizeReviewFiles(turnEntries)
        const targetGeneration = await this.computeGeneration(sessionId, statusTask)

        return ReviewOverviewSchema.parse({
            unavailableScopes: { turn: false, uncommitted: false, unstaged: false, staged: false, commit: !headExists },
            isGitRepository: true,
            scopes: {
                turn: { fileCount: turnSummary.files, additions: turnSummary.additions, deletions: turnSummary.deletions },
                uncommitted: summary(uncommittedFull),
                unstaged: summary(unstagedFull),
                staged: summary(stagedEntries),
            },
            truncated: untracked.truncated,
            targetGeneration,
        })
    }

    /** 文件明细：五档统一形状。turn 档统一走供数器；工作区三档纯 git */
    async files(sessionId: string, target: DiffTarget): Promise<unknown> {
        if (target.kind === 'turn') {
            const files = await this.turnAttribution().entriesOf(sessionId, target)
            return ReviewFilesResultSchema.parse({ files, stats: summarizeReviewFiles(files), truncated: false, targetGeneration: await this.computeGeneration(sessionId) })
        }
        const resolved = await resolveDiffTarget(target, { isGitRepository: await this.isGitRepo() })
        if (!resolved.isGitRepository) throw new Error('target requires a git repository')

        const includeUntracked = target.kind === 'worktree' && target.area !== 'staged'
        // status 单跑一份喂 untracked 与 generation；generation 并入并行块（原先在块前
        // 串行 await，多付一整段 status 延迟）
        const statusTask = this.gitAtRoot(['status', '--porcelain=v2', '-z'])
        const [tracked, untracked, generation] = await Promise.all([
            this.entries(['diff', ...resolved.diffArgs, '-M']),
            includeUntracked ? this.untrackedEntries(statusTask) : Promise.resolve({ files: [] as TurnDiffFileEntry[], truncated: false }),
            this.computeGeneration(sessionId, statusTask),
        ])
        const merged = target.kind === 'worktree' && target.area === 'uncommitted'
            ? mergeEntries(tracked, [...untracked.files])
            : [...tracked, ...untracked.files].sort((a, b) => a.path.localeCompare(b.path))
        const files = merged.map(toReviewEntry)
        return ReviewFilesResultSchema.parse({
            files,
            stats: summarizeReviewFiles(files),
            truncated: untracked.truncated,
            targetGeneration: generation,
        })
    }

    /** 单文件 patch（pierre PatchDiff 主输入）。空 patch = 无 patch 可给（二进制/归档
     *  未记录），web 落 contents 通道或诚实降级。出口统一渲染截断（REVIEW_RENDER_MAX_LINES，
     *  oversized+ref 现场合成的真实 patch 同样截断——API 不全量返回） */
    async patch(sessionId: string, target: DiffTarget, path: string): Promise<unknown> {
        // turn 档：patch 直读归档封口定稿（B 方案——封口时已合成落盘，查询时零合成）；
        // 未记录路径 / 无归档 = 空 patch；oversized+ref 由 patchOf 现场合成
        if (target.kind === 'turn') {
            const supplied = await this.turnAttribution().patchOf(sessionId, target, path)
            if (supplied === null) return ReviewPatchResultSchema.parse({ patch: '', previousPath: null, oversized: false, binary: false })
            const cut = truncatePatch(supplied.patch)
            return ReviewPatchResultSchema.parse({ patch: cut.patch, previousPath: null, oversized: supplied.oversizedPatch, binary: false, truncatedLines: cut.truncatedLines })
        }
        const resolved = await resolveDiffTarget(target, { isGitRepository: await this.isGitRepo() })
        // git 档路径闸（先 resolve 后闸，源决定闸）
        gatePathForSource('git', path, this.cwd, await this.root())
        if (!resolved.isGitRepository) throw new Error('target requires a git repository')

        return ReviewPatchResultSchema.parse(await this.patchFromGit(resolved.diffArgs, path, {
            allowNoIndex: target.kind === 'worktree' && target.area !== 'staged',
        }))
    }

    /** git 档单文件 patch：rename 旧路径解析 + untracked no-index 兜底（仅工作区非
     *  staged 档）+ 二进制打标 + 渲染截断（oversized 打标保留供 web 语义，超行不再
     *  置空 patch——截断渲染 + viewer 出口取代一刀切不可看） */
    private async patchFromGit(diffArgs: string[], path: string, opts: { allowNoIndex: boolean }): Promise<{ patch: string; previousPath: string | null; oversized: boolean; binary: boolean; truncatedLines: number }> {
        // rename 旧路径解析：name-status 单查（不走 entries——那里的全树 numstat 此处用不到）
        const previousPath = await this.previousPathFor(diffArgs, path)
        const pathArgs = previousPath ? [previousPath, path] : [path]

        // untracked：index 无此路径，普通 diff 不覆盖——no-index 兜底（仅工作区非 staged 档）
        let [patch, numstat] = await Promise.all([
            this.gitAtRoot(['diff', ...diffArgs, '--find-renames', '--', ...pathArgs]),
            this.gitAtRoot(['diff', ...diffArgs, '--numstat', '--', ...pathArgs]),
        ])
        if (opts.allowNoIndex && !patch) {
            const noIndex = await this.noIndexDiff(['diff', '--no-index', '--', '/dev/null', path])
            if (noIndex) {
                patch = noIndex
                numstat = await this.noIndexDiff(['diff', '--no-index', '--numstat', '--', '/dev/null', path])
            }
        }

        // 二进制：numstat 计数列 `-`——patch 不出（git 的一行说明对渲染无意义）
        const cols = numstat?.split('\n')[0]?.split('\t') ?? []
        const binary = cols[0] === '-' || cols[1] === '-'
        const oversized = patch !== null && textLineCount(patch) > OVERSIZE_DIFF_LINES
        if (binary) return { patch: '', previousPath, oversized, binary, truncatedLines: 0 }
        const cut = truncatePatch(patch ?? '')
        return { patch: cut.patch, previousPath, oversized, binary, truncatedLines: cut.truncatedLines }
    }

    /** 全文对（pierre hydration 懒拉）。reason = 两侧都拿不到时的降级原因；一侧有值
     *  （add/delete 的合法半对）reason 为 null */
    async contents(sessionId: string, target: DiffTarget, path: string): Promise<unknown> {
        // turn 档：hydration——条目带 ref 时读归档全文目录（历史轮 before 也可得，该轮
        // 事实不受工作区后续变化影响）；无 ref（旧归档）/ 未记录 / 无归档 = 空降级（协议不变）
        if (target.kind === 'turn') {
            const supplied = await this.turnAttribution().contentsOf(sessionId, target, path)
            if (!supplied) return ReviewContentsResultSchema.parse({ before: null, after: null, reason: 'missing' })
            const side = (raw: string | null): FulltextSide => {
                if (raw === null) return missingSide()
                const gated = gateText(raw)
                return gated.text !== null ? { text: gated.text, reason: null } : { text: null, reason: gated.reason }
            }
            const base = side(supplied.before)
            const head = side(supplied.after)
            return ReviewContentsResultSchema.parse({
                before: base.text,
                after: head.text,
                reason: base.text === null && head.text === null ? pickDegradedReason(base.reason, head.reason) : null,
            })
        }
        const resolved = await resolveDiffTarget(target, { isGitRepository: await this.isGitRepo() })
        // git 档路径闸（先 resolve 后闸，源决定闸，同 patch）
        gatePathForSource('git', path, this.cwd, await this.root())
        if (!resolved.isGitRepository) throw new Error('target requires a git repository')

        return ReviewContentsResultSchema.parse(await this.contentsFromGit(resolved.diffArgs, resolved.baseRev!, resolved.headRev, path))
    }

    /** git 档全文对：rename 基线侧取旧路径（新路径在基线树不存在）；headRev null =
     *  工作区 fs（'' = index） */
    private async contentsFromGit(diffArgs: string[], baseRev: string, headRev: string | null, path: string): Promise<{ before: string | null; after: string | null; reason: 'binary' | 'oversized' | 'missing' | null }> {
        // rename 基线侧取旧路径（新路径在基线树不存在）；headRev null = 工作区 fs，无 rename 概念
        const previousPath = headRev !== null ? await this.previousPathFor(diffArgs, path) : null
        const [base, head] = await Promise.all([
            this.showRev(baseRev, previousPath ?? path),
            headRev === null ? this.readWorktreeRev(path) : this.showRev(headRev, path),
        ])
        return {
            before: base.text,
            after: head.text,
            reason: base.text === null && head.text === null ? pickDegradedReason(base.reason, head.reason) : null,
        }
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

    /** 一键 git init（Codex 同款非 git 兜底）：成功后失效 reader 的仓库判定缓存 */
    async initRepo(): Promise<unknown> {
        try {
            await git(this.cwd, ['init'])
            this.repoRoot = null
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

/** .mobi 状态目录内路径（generation dirty 刻度的过滤口径） */
function isMobiStatePath(path: string): boolean {
    return path === MOBI_STATE_DIR || path.startsWith(`${MOBI_STATE_DIR}/`)
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
 * machine 通道 gitReview RPC 注册（cwd 由 daemon 从会话 metadata 注入，信任模型同 hostReadFileMeta）。
 * git 执行统一走 gitExec 的收口 git()；本模块只负责查询编排与降级语义。
 *
 * 七连 handler 样板（reader 装配 + try/catch rpcError 同构）收敛为方法表 +
 * 通用 wrapper（⑤ 表驱动收口）：wire 契约（方法名/数据形状/错误文案/debug 标签）不变。
 */

/** RPC 方法表条目：run 的 data 参数以 never 反变收窄（各条目自带数据形状注解，
 *  表外零断言）；log/error 与收口前逐条一致 */
type GitReviewHandlerDef = {
    /** debug 日志标签（`[GitReview] <log> failed`） */
    log: string
    /** rpcError 文案（daemon 透传给 web 的错误信息） */
    error: string
    run: (reader: GitReviewReader, data: never) => Promise<unknown>
}

/** 会话删除清落盘状态（wire 名留 clearTurnSnapshots——daemon 契约不变，语义已换）：
 *  删 `.mobi/turn-diffs/<sid>/` 整目录——turn 归档在此，tool-changes.json 孤儿
 *  （持久层已退场）同目录顺带清掉 */
async function clearSessionState(cwd: string, sessionId: string): Promise<number> {
    try {
        await rm(getTurnFulltextRoot(cwd, sessionId), { recursive: true, force: true })
        return 1
    } catch {
        return 0
    }
}

const GIT_REVIEW_HANDLERS: readonly (GitReviewHandlerDef & { method: string })[] = [
    {
        method: GIT_REVIEW_RPC.clear,
        log: 'clearTurnSnapshots',
        error: 'Failed to clear turn snapshots',
        run: async (_reader, data: { cwd: string; sessionId: string }) => {
            const cleared = await clearSessionState(data.cwd, data.sessionId)
            return { success: true, cleared }
        },
    },
    // ── v2 六方法 ──
    {
        method: GIT_REVIEW_RPC.overview,
        log: 'overview',
        error: 'Failed to collect review overview',
        run: async (reader, data: { cwd: string; sessionId: string }) => reader.overview(data.sessionId),
    },
    {
        method: GIT_REVIEW_RPC.files,
        log: 'files',
        error: 'Failed to list review files',
        run: async (reader, data: { sessionId: string; target: DiffTarget }) => reader.files(data.sessionId, data.target),
    },
    {
        method: GIT_REVIEW_RPC.diff,
        log: 'diff',
        error: 'Failed to read review diff',
        run: async (reader, data: { sessionId: string; target: DiffTarget; path: string }) => reader.patch(data.sessionId, data.target, data.path),
    },
    {
        method: GIT_REVIEW_RPC.contents,
        log: 'contents',
        error: 'Failed to read review contents',
        run: async (reader, data: { sessionId: string; target: DiffTarget; path: string }) => reader.contents(data.sessionId, data.target, data.path),
    },
    {
        method: GIT_REVIEW_RPC.commits,
        log: 'commits',
        error: 'Failed to list commits',
        run: async (reader, data: { cursor?: string }) => reader.commits(data.cursor),
    },
    {
        method: GIT_REVIEW_RPC.init,
        log: 'init',
        error: 'Failed to initialize git repository',
        run: async (reader) => reader.initRepo(),
    },
]


/**
 * gitReview 族 RPC 统一实现（ticket-17 本地化直调目标）：注册闭包与 LocalExecutor
 * 共用，行为单源——socket 路径与本地直调不会分叉（方法表查表 + 同构 try/catch rpcError）。
 */
export async function gitReviewRpcImpl(method: string, data: { cwd: string } & Record<string, unknown>): Promise<unknown> {
    const def = GIT_REVIEW_HANDLERS.find((d) => d.method === method)
    if (!def) return rpcError('Method not found')
    try {
        return await def.run(readerFor(data.cwd), data as never)
    } catch (e) {
        logger.debug(`[GitReview] ${def.log} failed`, e)
        return rpcError(def.error)
    }
}

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
