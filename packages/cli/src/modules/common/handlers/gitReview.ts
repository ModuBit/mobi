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
 * turn 档供数（审查 v3 反转，结构收口）：统一经 TurnAttributionProvider（降级链
 * 单点：封口归档 → 快照两树 → journal；路径闸随源走）——本模块不再自行做封口档
 * 前置分流，只承接供数器交回的出口（内容对合成 patch/全文、两树 git 查询）。
 *
 * cwd 由 hub 从会话 metadata 注入（与 machineReadFileMeta 同信任模型）；路径统一以
 * repoRoot 为基准（git 在 repoRoot 执行，diff 输出的路径即仓库相对路径，盘上读取
 * 同基准）。untracked 行数计数：`git diff --no-index --numstat /dev/null <path>`
 * （ChatGPT 同解，差异以退出码 1 表达须从 stdout 取），超过 UNTRACKED_COUNT_CAP
 * 只列条目不再计数（truncated 事实随响应返回）。
 */

import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import {
    GIT_REVIEW_RPC,
    OVERSIZE_DIFF_LINES,
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
import { assembleDiffEntries, dropTurnSnapshotStoreCache, git, openTurnSnapshotStore } from '../git/gitTurnSnapshotStore'
import { getToolChangesPath, loadToolChangeJournal } from '../git/toolChangeJournal'
import { gatePathForSource, toReviewEntry, TurnAttributionProvider } from '../git/turnAttributionProvider'
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

function summarizeReviewFiles(files: readonly { additions?: number | null; deletions?: number | null }[]): TurnDiffStats {
    return {
        files: files.length,
        additions: files.reduce((sum, f) => sum + (f.additions ?? 0), 0),
        deletions: files.reduce((sum, f) => sum + (f.deletions ?? 0), 0),
    }
}

function totalWriteCount(journal: { listPaths(): string[]; get(path: string): { writeCount: number } | undefined }): number {
    return journal.listPaths().reduce((sum, path) => sum + (journal.get(path)?.writeCount ?? 0), 0)
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

    /** turn 档供数器（审查 v3 反转的收口面）：随请求装配——store 由调用方注入，
     *  git 执行注入本实例的收口方法（gitAtRoot 同源） */
    private turnAttribution(store: TurnSnapshotStore | null): TurnAttributionProvider {
        return new TurnAttributionProvider(this.cwd, store, {
            isGitRepository: () => this.isGitRepo(),
            entries: (args) => this.entries(args),
        })
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

    /** 全文对 → patch 结果（oversize 打标清空；供数档 patch 通道唯一出口） */
    private async patchFromContents(path: string, before: string | null, after: string | null): Promise<{ patch: string; previousPath: null; oversized: boolean; binary: boolean }> {
        const patch = await this.synthesizePatchFromContents(path, before, after)
        const oversized = patch.split('\n').length > OVERSIZE_DIFF_LINES
        return { patch: oversized ? '' : patch, previousPath: null, oversized, binary: false }
    }

    /** 全文对 → contents 结果（gateText 三态 + 双空降级择优；供数档 contents 通道唯一出口） */
    private contentsFromPair(before: string | null, after: string | null): { before: string | null; after: string | null; reason: 'binary' | 'oversized' | 'missing' | null } {
        const b = before === null ? missingSide() : gateText(before)
        const a = after === null ? missingSide() : gateText(after)
        return {
            before: b.text,
            after: a.text,
            reason: b.text === null && a.text === null ? pickDegradedReason(b.reason, a.reason) : null,
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
        // 实证（git 2.x，-z）：untracked 记录为 `? path\0`——问号与路径同 token，空格分隔。
        // .mobi/ 内部状态目录过滤（审查 v3 票04 留白收口）：用户项目未 gitignore 时
        // journal/归档文件会以 untracked 出现，混进工作区实况档是噪音
        for (const token of tokens) {
            if (!token.startsWith('? ')) continue
            const path = token.slice(2)
            if (path === '.mobi' || path.startsWith('.mobi/')) continue
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

    /** 总览：逐档可用性 + 各档统计。非 git：turn 非 null（供数器 journal 档供数），
     *  git 系全 null。turn 档统计统一走 TurnAttributionProvider（审查 v3 反转） */
    async overview(sessionId: string, store: TurnSnapshotStore | null): Promise<ReviewOverview> {
        if (!(await this.isGitRepo())) {
            const turnStats = summarizeReviewFiles(await this.turnAttribution(store).entriesOf(sessionId, { kind: 'turn' }))
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
                targetGeneration: await this.computeGeneration(sessionId, store),
            })
        }

        // 五路查询互不依赖 → 并行（总览延迟 = 最慢一路而非五路之和）
        const [turnEntries, stagedEntries, unstagedTracked, untracked, headExists] = await Promise.all([
            this.turnAttribution(store).entriesOf(sessionId, { kind: 'turn' }),
            this.entries(['diff', '--cached', '-M', 'HEAD']),
            this.entries(['diff', '-M']),
            this.untrackedEntries(),
            this.gitAtRoot(['rev-parse', '--verify', 'HEAD']).then((v) => v !== null),
        ])

        const unstagedFull = [...unstagedTracked, ...untracked.files].sort((a, b) => a.path.localeCompare(b.path))
        const uncommittedFull = mergeEntries(stagedEntries, unstagedFull)

        const summary = (files: TurnDiffFileEntry[]) => {
            const stats = summarizeTurnDiffFiles(files)
            return { fileCount: stats.files, additions: stats.additions, deletions: stats.deletions }
        }
        const turnSummary = summarizeReviewFiles(turnEntries)

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
            targetGeneration: await this.computeGeneration(sessionId, store),
        })
    }

    /** 文件明细：五档统一形状。turn 档统一走供数器（审查 v3 反转）；工作区三档纯 git */
    async files(sessionId: string, target: DiffTarget, store: TurnSnapshotStore | null): Promise<unknown> {
        if (target.kind === 'turn') {
            const files = await this.turnAttribution(store).entriesOf(sessionId, target)
            return ReviewFilesResultSchema.parse({ files, stats: summarizeReviewFiles(files), truncated: false, targetGeneration: await this.computeGeneration(sessionId, store) })
        }
        const resolved = await resolveDiffTarget(target, { isGitRepository: await this.isGitRepo(), snapshotStore: store })
        if (!resolved.isGitRepository) throw new Error('target requires a git repository')
        const generation = await this.computeGeneration(sessionId, store)

        const includeUntracked = target.kind === 'worktree' && target.area !== 'staged'
        const [tracked, untracked] = await Promise.all([
            this.entries(['diff', ...resolved.diffArgs, '-M']),
            includeUntracked ? this.untrackedEntries() : Promise.resolve({ files: [] as TurnDiffFileEntry[], truncated: false }),
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

    /** 单文件 patch（pierre PatchDiff 主输入）。空 patch = 无 patch 可给（内容对无记录/
     *  journal 源/二进制/超预算），web 落 contents 通道或诚实降级 */
    async patch(sessionId: string, target: DiffTarget, path: string, store: TurnSnapshotStore | null): Promise<unknown> {
        // turn 档统一走供数器（审查 v3 反转）：内容型源直出内容对合成 patch；快照源走
        // 两树 git 查询（无 untracked no-index 兜底——turn 档清单不含 untracked）
        if (target.kind === 'turn') {
            const supplied = await this.turnAttribution(store).pairOf(sessionId, target, path)
            if (supplied === null) return ReviewPatchResultSchema.parse({ patch: '', previousPath: null, oversized: false, binary: false })
            if (supplied.kind === 'contents') return ReviewPatchResultSchema.parse(await this.patchFromContents(path, supplied.before, supplied.after))
            return ReviewPatchResultSchema.parse(await this.patchFromGit([supplied.baseTree, supplied.headTree], path, { allowNoIndex: false }))
        }
        const resolved = await resolveDiffTarget(target, { isGitRepository: await this.isGitRepo(), snapshotStore: store })
        // git 档路径闸（先 resolve 后闸，源决定闸）
        gatePathForSource('git', path, this.cwd, await this.root())
        if (!resolved.isGitRepository) throw new Error('target requires a git repository')

        return ReviewPatchResultSchema.parse(await this.patchFromGit(resolved.diffArgs, path, {
            allowNoIndex: target.kind === 'worktree' && target.area !== 'staged',
        }))
    }

    /** git 档单文件 patch：rename 旧路径解析 + untracked no-index 兜底（仅工作区非
     *  staged 档）+ 二进制/超预算打标 */
    private async patchFromGit(diffArgs: string[], path: string, opts: { allowNoIndex: boolean }): Promise<{ patch: string; previousPath: string | null; oversized: boolean; binary: boolean }> {
        // rename 旧路径解析：目标 pair 的 name-status 单查（entry 的 previousPath）
        const entries = await this.entries(['diff', ...diffArgs, '-M'])
        const previousPath = entries.find((e) => e.path === path)?.previousPath ?? null
        const pathArgs = previousPath ? [previousPath, path] : [path]

        // untracked：index 无此路径，普通 diff 不覆盖——no-index 兜底（仅工作区非 staged 档）
        let patch = await this.gitAtRoot(['diff', ...diffArgs, '--find-renames', '--', ...pathArgs])
        let numstat = await this.gitAtRoot(['diff', ...diffArgs, '--numstat', '--', ...pathArgs])
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
        const oversized = (patch?.split('\n').length ?? 0) > OVERSIZE_DIFF_LINES
        return {
            patch: binary || oversized ? '' : patch ?? '',
            previousPath,
            oversized,
            binary,
        }
    }

    /** 全文对（pierre hydration 懒拉）。reason = 两侧都拿不到时的降级原因；一侧有值
     *  （add/delete 的合法半对）reason 为 null */
    async contents(sessionId: string, target: DiffTarget, path: string, store: TurnSnapshotStore | null): Promise<unknown> {
        // turn 档统一走供数器（审查 v3 反转）：内容型源直出内容对（历史轮回看冻结）；
        // 快照源走两树 git show
        if (target.kind === 'turn') {
            const supplied = await this.turnAttribution(store).pairOf(sessionId, target, path)
            if (supplied === null) return ReviewContentsResultSchema.parse({ before: null, after: null, reason: 'missing' })
            if (supplied.kind === 'contents') return ReviewContentsResultSchema.parse(this.contentsFromPair(supplied.before, supplied.after))
            return ReviewContentsResultSchema.parse(await this.contentsFromGit([supplied.baseTree, supplied.headTree], supplied.baseTree, supplied.headTree, path))
        }
        const resolved = await resolveDiffTarget(target, { isGitRepository: await this.isGitRepo(), snapshotStore: store })
        // git 档路径闸（先 resolve 后闸，源决定闸，同 patch）
        gatePathForSource('git', path, this.cwd, await this.root())
        if (!resolved.isGitRepository) throw new Error('target requires a git repository')

        return ReviewContentsResultSchema.parse(await this.contentsFromGit(resolved.diffArgs, resolved.baseRev!, resolved.headRev, path))
    }

    /** git 档全文对：rename 基线侧取旧路径（新路径在基线树不存在）；headRev null =
     *  工作区 fs（'' = index） */
    private async contentsFromGit(diffArgs: string[], baseRev: string, headRev: string | null, path: string): Promise<{ before: string | null; after: string | null; reason: 'binary' | 'oversized' | 'missing' | null }> {
        const previousPath = headRev !== null
            ? (await this.entries(['diff', ...diffArgs, '-M'])).find((e) => e.path === path)?.previousPath ?? null
            : null
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
 *
 * 七连 handler 样板（reader/store 装配 + try/catch rpcError 同构）收敛为方法表 +
 * 通用 wrapper（⑤ 表驱动收口）：wire 契约（方法名/数据形状/错误文案/debug 标签）不变。
 */

/** RPC 方法表条目：run 的 data 参数以 never 反变收窄（各条目自带数据形状注解，
 *  表外零断言）；log/error 与收口前逐条一致 */
type GitReviewHandlerDef = {
    /** debug 日志标签（`[GitReview] <log> failed`） */
    log: string
    /** rpcError 文案（hub 透传给 web 的错误信息） */
    error: string
    /** 是否装配快照 store（commits/init 用不到，不做多余的 store 打开副作用） */
    withStore: boolean
    run: (reader: GitReviewReader, store: TurnSnapshotStore | null, data: never) => Promise<unknown>
}

const GIT_REVIEW_HANDLERS: readonly (GitReviewHandlerDef & { method: string })[] = [
    {
        // 会话删除清引用（ADR 0008 refs 治理，hub best-effort 调用）：git mv 不适用——
        // 快照引用本就不进 index，直接逐个删 ref
        method: GIT_REVIEW_RPC.clear,
        log: 'clearTurnSnapshots',
        error: 'Failed to clear turn snapshots',
        withStore: true,
        run: async (_reader, store, data: { cwd: string; sessionId: string }) => {
            const cleared = store ? await store.clearSession(data.sessionId) : 0
            return { success: true, cleared }
        },
    },
    // ── v2 六方法 ──
    {
        method: GIT_REVIEW_RPC.overview,
        log: 'overview',
        error: 'Failed to collect review overview',
        withStore: true,
        run: async (reader, store, data: { cwd: string; sessionId: string }) => reader.overview(data.sessionId, store),
    },
    {
        method: GIT_REVIEW_RPC.files,
        log: 'files',
        error: 'Failed to list review files',
        withStore: true,
        run: async (reader, store, data: { sessionId: string; target: DiffTarget }) => reader.files(data.sessionId, data.target, store),
    },
    {
        method: GIT_REVIEW_RPC.diff,
        log: 'diff',
        error: 'Failed to read review diff',
        withStore: true,
        run: async (reader, store, data: { sessionId: string; target: DiffTarget; path: string }) => reader.patch(data.sessionId, data.target, data.path, store),
    },
    {
        method: GIT_REVIEW_RPC.contents,
        log: 'contents',
        error: 'Failed to read review contents',
        withStore: true,
        run: async (reader, store, data: { sessionId: string; target: DiffTarget; path: string }) => reader.contents(data.sessionId, data.target, data.path, store),
    },
    {
        method: GIT_REVIEW_RPC.commits,
        log: 'commits',
        error: 'Failed to list commits',
        withStore: false,
        run: async (reader, _store, data: { cursor?: string }) => reader.commits(data.cursor),
    },
    {
        method: GIT_REVIEW_RPC.init,
        log: 'init',
        error: 'Failed to initialize git repository',
        withStore: false,
        run: async (reader) => reader.initRepo(),
    },
]

export function registerGitReviewHandlers(rpcHandlerManager: RpcHandlerManager): void {
    for (const def of GIT_REVIEW_HANDLERS) {
        rpcHandlerManager.registerHandler<{ cwd: string }, unknown>(def.method, async (data) => {
            try {
                const reader = readerFor(data.cwd)
                const store = def.withStore ? await openTurnSnapshotStore(data.cwd) : null
                return await def.run(reader, store, data as never)
            } catch (e) {
                logger.debug(`[GitReview] ${def.log} failed`, e)
                return rpcError(def.error)
            }
        })
    }
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
