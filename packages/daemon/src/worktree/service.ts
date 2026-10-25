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
 * worktree 生命周期服务（深模块）：把「归属判定 + 脏判定 + 列表扫描 + 合回 + 丢弃」
 * 收在一个进程内服务里，路由只做鉴权/校验/转发。worktree 生命周期长于会话
 * （孤儿 worktree 没有会话可寻址），所以挂 host 直调族而非 session machine 通道。
 *
 * 无持久登记表：列表按需扫描 workspaces 目录，会话归属用 worktreePath 反查
 * sessions 表 WorktreeMetadata；扫不到会话的即孤儿条目。
 */

import { realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { MOBI_STATE_EXCLUDE_PATHSPEC } from '@mobi/node-core/git/gitExec'
import type {
    DiscardRequest,
    DiscardResult,
    MergeBackRequest,
    MergeBackResult,
    RetainedWorktree,
    WorktreeSummary
} from '@mobi/shared'
import { removeWorktreeAndBranch, removeWorktreeIfClean, type WorktreeCleanupResult } from './cleanup'
import type { GitRunner } from './gitRunner'
import { errorMessage, runGit } from './gitRunner'
import { branchForWorktreeName, parseMobiWorktreeLayout, worktreeNameFromBranch } from './identity'
import { hasStagedChanges, inspectWorktreeStatus, parseDirtyPaths } from './status'

/** 会话只读来源（Store 的结构子集）：列表反查与孤儿判定只需要 id / 更新时间 / metadata */
export interface WorktreeSessionRow {
    id: string
    updatedAt: number
    metadata: unknown
}

/** 工作区只读来源：列表扫描只需 folders 里的目录 */
export interface WorktreeWorkspaceRow {
    folders: Array<{ path: string }>
}

/** worktree 服务消费的 store 面（结构类型，测试注入假件无需起 bun:sqlite） */
export interface WorktreeStoreSource {
    sessions: { getSessions(): WorktreeSessionRow[] }
    workspaces: { getAllWorkspaces(): WorktreeWorkspaceRow[] }
}

export interface WorktreeLifecycleServiceOptions {
    store: WorktreeStoreSource
    /** 会话运行态判定（daemon 路由注入 SyncEngine 实时态）；缺省视为非运行 */
    isSessionRunning?: (sessionId: string) => boolean
    /** git 执行（测试注入假件；缺省真实 git） */
    git?: GitRunner
}

/** `git worktree list --porcelain` 的单条记录（只取本服务消费的字段） */
interface WorktreeListEntry {
    path: string
    branch: string | null
}

/** 同一 worktree 可能被多行会话引用（fork 继承 parent 的 worktree 元数据）：取最近更新的一行作列表归属展示 */
function newestSession(sessions: readonly WorktreeSessionRow[]): WorktreeSessionRow | undefined {
    let newest: WorktreeSessionRow | undefined
    for (const session of sessions) {
        if (!newest || session.updatedAt > newest.updatedAt) newest = session
    }
    return newest
}

/** 从会话 metadata 读取 worktree 三字段（metadata 是 json blob，形状非法按无 worktree 处理） */
function readWorktreeMetadata(session: { metadata: unknown }): { worktreePath?: string; basePath?: string; name?: string; branch?: string } | null {
    const metadata = session.metadata
    if (!metadata || typeof metadata !== 'object') return null
    const worktree = (metadata as { worktree?: unknown }).worktree
    if (!worktree || typeof worktree !== 'object') return null
    const { worktreePath, basePath, name, branch } = worktree as Record<string, unknown>
    return {
        worktreePath: typeof worktreePath === 'string' ? worktreePath : undefined,
        basePath: typeof basePath === 'string' ? basePath : undefined,
        name: typeof name === 'string' ? name : undefined,
        branch: typeof branch === 'string' ? branch : undefined
    }
}

/** porcelain 输出按空行分块；每块取 worktree / branch 两键 */
export function parseWorktreeList(output: string): WorktreeListEntry[] {
    const entries: WorktreeListEntry[] = []
    for (const block of output.split(/\n\s*\n/)) {
        const entry: WorktreeListEntry = { path: '', branch: null }
        for (const line of block.split('\n')) {
            if (line.startsWith('worktree ')) entry.path = line.slice('worktree '.length).trim()
            else if (line.startsWith('branch ')) entry.branch = line.slice('branch '.length).trim()
        }
        if (entry.path) entries.push(entry)
    }
    return entries
}

/** 会话实时态来源（SyncEngine 的结构子集）：运行态直读进程内状态，不信任落库旧值 */
export interface SessionLivenessSource {
    getSession(sessionId: string): { active?: boolean; running?: boolean } | null | undefined
}

/**
 * 路由装配工厂：把「会话活者（active 进程在 / running 轮次中）即不可处置」这条
 * 生命周期规则收在服务侧，路由只注入 SyncEngine 读取入口。
 */
export function createWorktreeLifecycleService(deps: {
    store: WorktreeStoreSource
    getSyncEngine: () => SessionLivenessSource | null | undefined
}): WorktreeLifecycleService {
    return new WorktreeLifecycleService({
        store: deps.store,
        isSessionRunning: (sessionId) => {
            const session = deps.getSyncEngine()?.getSession(sessionId)
            return Boolean(session?.active || session?.running)
        }
    })
}

export class WorktreeLifecycleService {
    private readonly store: WorktreeStoreSource
    private readonly isSessionRunning: (sessionId: string) => boolean
    private readonly git: GitRunner

    constructor(options: WorktreeLifecycleServiceOptions) {
        this.store = options.store
        this.isSessionRunning = options.isSessionRunning ?? (() => false)
        this.git = options.git ?? runGit
    }

    // ── 列表 ───────────────────────────────────────────────────────────────

    /** 扫描本机所有 mobi worktree 的完整画像（无登记表，按需扫描） */
    async list(): Promise<WorktreeSummary[]> {
        // 会话表一次读取，候选仓库根与会话反查共用（避免同请求两次全表查询）
        const sessions = this.store.sessions.getSessions()
        const repoRoots = await this.collectRepoRoots(sessions)
        const sessionsByWorktreePath = await this.sessionsByWorktreePath(sessions)

        // 仓库维度并发：每个仓库的分支 / worktree 列表 / 画像互不依赖
        const perRepo = await Promise.all(repoRoots.map(async (repoRoot) => {
            const [repoBranch, entries] = await Promise.all([
                this.currentBranch(repoRoot),
                this.listRepoWorktrees(repoRoot)
            ])
            const candidates: Array<Parameters<typeof this.toSummary>[0]> = []
            // realpath 批量并发：逐条 await 在 worktree 多时是请求内线性 I/O
            const paths = await Promise.all(entries.map((entry) => canonicalPath(entry.path)))
            entries.forEach((entry, index) => {
                const worktreePath = paths[index]!
                const layout = parseMobiWorktreeLayout(worktreePath)
                if (!layout) return
                if (resolve(layout.repoRoot) !== resolve(repoRoot)) return
                const nameFromBranch = entry.branch ? worktreeNameFromBranch(entry.branch) : null
                if (!nameFromBranch || nameFromBranch !== layout.name) return
                candidates.push({
                    worktreePath,
                    repoRoot: resolve(repoRoot),
                    name: layout.name,
                    branch: branchForWorktreeName(layout.name),
                    repoBranch,
                    sessions: sessionsByWorktreePath.get(worktreePath) ?? []
                })
            })
            return candidates
        }))

        // 候选仓库根可能因软链/嵌套重叠命中同一 worktree：顺序去重后再并发生成画像
        const seen = new Set<string>()
        const unique = perRepo.flat().filter((candidate) => {
            if (seen.has(candidate.worktreePath)) return false
            seen.add(candidate.worktreePath)
            return true
        })
        const summaries = await Promise.all(unique.map((candidate) => this.toSummary(candidate)))
        return summaries.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.name.localeCompare(b.name))
    }

    /** 候选仓库根：工作区 folders + 会话 WorktreeMetadata.basePath，各自 rev-parse 收敛去重 */
    private async collectRepoRoots(sessions: readonly WorktreeSessionRow[]): Promise<string[]> {
        const candidates = new Set<string>()
        for (const workspace of this.store.workspaces.getAllWorkspaces()) {
            for (const folder of workspace.folders) candidates.add(folder.path)
        }
        for (const session of sessions) {
            const worktree = readWorktreeMetadata(session)
            if (worktree?.basePath) candidates.add(worktree.basePath)
        }

        const roots = new Set<string>()
        await Promise.all([...candidates].map(async (path) => {
            try {
                const output = await this.git(path, ['rev-parse', '--show-toplevel'])
                const root = output.trim()
                if (root) roots.add(resolve(root))
            } catch {
                // 目录缺失/非 git：容错跳过（列表不因单个工作区失效而整体失败）
            }
        }))
        return [...roots]
    }

    /** 主仓库当前检出分支（detached HEAD / 读取失败返回 undefined） */
    private async currentBranch(repoRoot: string): Promise<string | undefined> {
        const head = await this.headBranch(repoRoot)
        return head.ok ? head.branch ?? undefined : undefined
    }

    /** HEAD 指向的分支；detached HEAD 时 branch 为 null（合回前置闸据此区分 detached-head） */
    private async headBranch(repoRoot: string): Promise<
        { ok: true; branch: string | null } | { ok: false; error: string }
    > {
        try {
            const branch = (await this.git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
            return { ok: true, branch: branch && branch !== 'HEAD' ? branch : null }
        } catch (error) {
            return { ok: false, error: errorMessage(error) }
        }
    }

    private async listRepoWorktrees(repoRoot: string): Promise<WorktreeListEntry[]> {
        try {
            return parseWorktreeList(await this.git(repoRoot, ['worktree', 'list', '--porcelain']))
        } catch {
            return []
        }
    }

    /** worktreePath → 引用该路径的全部会话行（fork 会继承 parent 的 worktree 元数据，
     *  同一 worktree 可被多行引用；运行态与删除处置必须按全集收敛，不能只看一行） */
    private async sessionsByWorktreePath(sessions: readonly WorktreeSessionRow[]): Promise<Map<string, WorktreeSessionRow[]>> {
        const candidates = sessions
            .map((session) => ({ session, worktreePath: readWorktreeMetadata(session)?.worktreePath }))
            .filter((candidate): candidate is { session: WorktreeSessionRow; worktreePath: string } => Boolean(candidate.worktreePath))
        // realpath 批量并发（串行时历史会话多会成为请求内的线性 I/O）
        const keys = await Promise.all(candidates.map((candidate) => canonicalPath(candidate.worktreePath)))

        const byPath = new Map<string, WorktreeSessionRow[]>()
        candidates.forEach((candidate, index) => {
            const key = keys[index]!
            const group = byPath.get(key)
            if (group) group.push(candidate.session)
            else byPath.set(key, [candidate.session])
        })
        return byPath
    }

    private async toSummary(input: {
        worktreePath: string
        repoRoot: string
        name: string
        branch: string
        repoBranch?: string
        sessions: WorktreeSessionRow[]
    }): Promise<WorktreeSummary> {
        const [status, createdAt, lastCommitAt] = await Promise.all([
            inspectWorktreeStatus(this.git, input.worktreePath),
            this.worktreeCreatedAt(input.worktreePath),
            this.lastCommitAt(input.worktreePath)
        ])
        const owner = newestSession(input.sessions)
        // 任一引用行处于运行态即视为运行中（fork 行不能掩盖仍在跑的原会话）
        const running = input.sessions.some((session) => this.isSessionRunning(session.id))
        return {
            name: input.name,
            branch: input.branch,
            worktreePath: input.worktreePath,
            repoRoot: input.repoRoot,
            ...(input.repoBranch ? { repoBranch: input.repoBranch } : {}),
            ...(owner ? { sessionId: owner.id } : {}),
            state: running ? 'running' : status.state,
            dirtyFileCount: status.dirtyFileCount,
            sizeBytes: status.sizeBytes,
            ...(createdAt === undefined ? {} : { createdAt }),
            ...(lastCommitAt === undefined ? {} : { lastCommitAt })
        }
    }

    private async worktreeCreatedAt(worktreePath: string): Promise<number | undefined> {
        try {
            const info = await stat(worktreePath)
            const createdAt = info.birthtimeMs || info.ctimeMs
            return createdAt > 0 ? Math.round(createdAt) : undefined
        } catch {
            return undefined
        }
    }

    private async lastCommitAt(worktreePath: string): Promise<number | undefined> {
        try {
            const output = await this.git(worktreePath, ['log', '-1', '--format=%ct', 'HEAD'])
            const seconds = Number.parseInt(output.trim(), 10)
            return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined
        } catch {
            return undefined
        }
    }

    // ── 合回主树 ───────────────────────────────────────────────────────────

    /**
     * 合回：脏 worktree 先 WIP 提交 → 主仓库当前检出分支 merge（no-ff / squash）→
     * 成功后按需清理。冲突诚实失败：主树回滚到合并前，WIP 提交留在 worktree 分支。
     */
    async mergeBack(request: MergeBackRequest): Promise<MergeBackResult> {
        const strategy = request.strategy ?? 'no-ff'
        const cleanup = request.cleanup ?? true

        const located = await this.locate(request.worktreePath)
        if (!located.ok) return located.result
        const { worktreePath, repoRoot, name, branch, sessions } = located

        if (sessions.some((session) => this.isSessionRunning(session.id))) {
            return { ok: false, reason: 'session-running' }
        }

        const mainDirty = await this.dirtyPaths(repoRoot)
        if (mainDirty === null) {
            return { ok: false, reason: 'git-failed', message: 'Unable to read main repository status' }
        }
        if (mainDirty.length > 0) {
            return { ok: false, reason: 'main-dirty', files: mainDirty }
        }

        // 合回目标恒为主仓库当前检出分支（用户想合到别的分支自己先切）；detached HEAD
        // 没有「当前分支」可作目标，直接拒绝。
        const head = await this.headBranch(repoRoot)
        if (!head.ok) {
            return { ok: false, reason: 'git-failed', message: head.error }
        }
        if (!head.branch) {
            return { ok: false, reason: 'detached-head' }
        }

        // 脏 worktree → 自动 WIP 提交（只含非 .mobi 改动；无改动不产生空提交）
        const wip = await this.commitWipIfNeeded(worktreePath, name)
        if (!wip.ok) return wip.result

        const mergeError = await this.runMerge(repoRoot, branch, strategy)
        if (mergeError !== null) {
            const conflictFiles = await this.conflictFiles(repoRoot)
            await this.rollbackMerge(repoRoot)
            if (conflictFiles.length > 0) {
                return { ok: false, reason: 'merge-failed', conflict: true, files: conflictFiles }
            }
            return { ok: false, reason: 'merge-failed', message: mergeError }
        }

        if (!cleanup) {
            return { ok: true, strategy, worktreeRemoved: false, branchDeleted: false }
        }

        // no-ff 用 -d（已合入才删得掉，天然防呆）；squash 后 git 认为未合入，用 -D
        const cleanupResult = await removeWorktreeAndBranch(this.git, {
            repoRoot,
            worktreePath,
            branch,
            forceBranch: strategy === 'squash'
        })
        return { ok: true, strategy, ...cleanupResult }
    }

    // ── 丢弃 ───────────────────────────────────────────────────────────────

    /** 丢弃：`worktree remove --force` + `branch -D`；定位参数经归属约定校验后才执行 */
    async discard(request: DiscardRequest): Promise<DiscardResult> {
        const located = await this.locate(request.worktreePath)
        if (!located.ok) {
            return located.result.reason === 'repo-mismatch'
                ? { ok: false, reason: 'invalid-worktree' }
                : { ok: false, reason: located.result.reason }
        }
        const { worktreePath, repoRoot, branch, sessions } = located
        if (sessions.some((session) => this.isSessionRunning(session.id))) {
            return { ok: false, reason: 'session-running' }
        }

        const cleanupResult = await removeWorktreeAndBranch(this.git, {
            repoRoot,
            worktreePath,
            branch,
            forceBranch: true
        })
        if (!cleanupResult.worktreeRemoved) {
            return { ok: false, reason: 'git-failed', message: cleanupResult.warning }
        }
        return {
            ok: true,
            worktreeRemoved: true,
            branchDeleted: cleanupResult.branchDeleted,
            ...(cleanupResult.warning ? { warning: cleanupResult.warning } : {})
        }
    }

    // ── 会话删除处置 ───────────────────────────────────────────────────────

    /**
     * 会话删除后的 worktree 处置：干净 → 删 worktree + `-d` 删分支；脏/unknown →
     * 保留并回传事实（前端据此 toast）。无 WorktreeMetadata 的会话零行为变化。
     * 同一 worktree 仍被其他会话行引用（fork 继承 parent 元数据）时不处置。
     * 处置失败不阻塞删除（best-effort，warning 带回）。
     */
    async disposeAfterSessionDelete(session: { id?: string; metadata: unknown }): Promise<{
        retained?: RetainedWorktree
        warning?: string
    }> {
        const worktree = readWorktreeMetadata(session)
        if (!worktree?.worktreePath || !worktree.basePath || !worktree.name) return {}

        const branch = worktree.branch ?? branchForWorktreeName(worktree.name)
        const worktreePath = await canonicalPath(worktree.worktreePath)

        // 同一 worktree 可能仍被其他会话引用（fork 继承 parent 的 worktree 元数据）：
        // 还有主人就不处置——否则删掉一行会把仍在用的工作树连根删除。
        const owners = (await this.sessionsByWorktreePath(this.store.sessions.getSessions()))
            .get(worktreePath)
            ?.filter((owner) => owner.id !== session.id)
        if (owners && owners.length > 0) return {}

        let result: WorktreeCleanupResult
        try {
            result = await removeWorktreeIfClean(
                { repoRoot: await canonicalPath(worktree.basePath), worktreePath, branch },
                { git: this.git }
            )
        } catch (error) {
            return { warning: errorMessage(error) }
        }
        if (result.removed) return result.warning ? { warning: result.warning } : {}
        return {
            retained: {
                name: worktree.name,
                branch,
                worktreePath,
                state: result.state,
                dirtyFileCount: result.dirtyFileCount
            },
            ...(result.warning ? { warning: result.warning } : {})
        }
    }

    // ── 归属定位与校验 ─────────────────────────────────────────────────────

    /**
     * 定位 + 归属校验（合回/丢弃共用）：路径形状符合约定 → worktree 实际分支必须是
     * `mobi-<name>` → 与解析出的主仓库共享同一 commonDir（防路径被挪动后误操作）。
     */
    private async locate(worktreePath: string): Promise<
        | { ok: true; worktreePath: string; repoRoot: string; name: string; branch: string; sessions: WorktreeSessionRow[] }
        | { ok: false; result: { ok: false; reason: 'invalid-worktree' | 'repo-mismatch' | 'git-failed'; message?: string } }
    > {
        const absolutePath = await canonicalPath(worktreePath)
        const layout = parseMobiWorktreeLayout(absolutePath)
        if (!layout) return { ok: false, result: { ok: false, reason: 'invalid-worktree' } }

        const expectedBranch = branchForWorktreeName(layout.name)
        try {
            const actualBranch = (await this.git(absolutePath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
            if (actualBranch !== expectedBranch) {
                return { ok: false, result: { ok: false, reason: 'invalid-worktree' } }
            }
        } catch (error) {
            return { ok: false, result: { ok: false, reason: 'invalid-worktree', message: errorMessage(error) } }
        }

        const repoRoot = resolve(layout.repoRoot)
        const sameRepo = await this.sharesCommonDir(absolutePath, repoRoot)
        if (sameRepo === null) {
            return { ok: false, result: { ok: false, reason: 'git-failed' } }
        }
        if (!sameRepo) {
            return { ok: false, result: { ok: false, reason: 'repo-mismatch' } }
        }

        const sessions = (await this.sessionsByWorktreePath(this.store.sessions.getSessions())).get(absolutePath) ?? []
        return { ok: true, worktreePath: absolutePath, repoRoot, name: layout.name, branch: expectedBranch, sessions }
    }

    /** 两个目录的 git commonDir 是否相同（null = git 读取失败） */
    private async sharesCommonDir(worktreePath: string, repoRoot: string): Promise<boolean | null> {
        try {
            const [worktreeCommon, repoCommon] = await Promise.all([
                this.git(worktreePath, ['rev-parse', '--git-common-dir']),
                this.git(repoRoot, ['rev-parse', '--git-common-dir'])
            ])
            const [worktreeGitDir, repoGitDir] = await Promise.all([
                canonicalPath(resolve(worktreePath, worktreeCommon.trim())),
                canonicalPath(resolve(repoRoot, repoCommon.trim()))
            ])
            return worktreeGitDir === repoGitDir
        } catch {
            return null
        }
    }

    /** 主仓库当前工作树改动（排除 .mobi）；null = git 失败 */
    private async dirtyPaths(repoRoot: string): Promise<string[] | null> {
        try {
            return parseDirtyPaths(await this.git(repoRoot, ['status', '--porcelain', '-z', '-uall']))
        } catch {
            return null
        }
    }

    // ── merge 内部步骤 ─────────────────────────────────────────────────────

    /** 脏 worktree 自动 WIP 提交；只暂存非 .mobi 改动，暂存区为空时跳过（不产生空提交） */
    private async commitWipIfNeeded(
        worktreePath: string,
        name: string
    ): Promise<{ ok: true } | { ok: false; result: MergeBackResult }> {
        try {
            await this.git(worktreePath, ['add', '-A', '--', '.', MOBI_STATE_EXCLUDE_PATHSPEC])
            const status = await this.git(worktreePath, ['status', '--porcelain', '-z', '-uall'])
            if (!hasStagedChanges(status)) return { ok: true }
            await this.git(worktreePath, ['commit', '--no-verify', '-m', `WIP: mobi ${name} pre-merge`])
            return { ok: true }
        } catch (error) {
            return {
                ok: false,
                result: { ok: false, reason: 'git-failed', message: errorMessage(error) }
            }
        }
    }

    /** 执行合并；成功返回 null，失败返回错误文案 */
    private async runMerge(repoRoot: string, branch: string, strategy: 'no-ff' | 'squash'): Promise<string | null> {
        try {
            if (strategy === 'squash') {
                await this.git(repoRoot, ['merge', '--squash', branch])
                // 分支已并入（无新改动）时 merge --squash 只报 "Already up to date." 且不产生
                // 暂存内容，此时 commit 会以 "nothing to commit" 失败——按成功（无事可做）处理，
                // 与 no-ff 的行为保持一致。
                const status = await this.git(repoRoot, ['status', '--porcelain', '-z', '-uall'])
                if (!hasStagedChanges(status)) return null
                const name = worktreeNameFromBranch(branch) ?? branch
                await this.git(repoRoot, ['commit', '--no-verify', '-m', `mobi worktree ${name}: squash merge`])
            } else {
                await this.git(repoRoot, ['merge', '--no-ff', branch])
            }
            return null
        } catch (error) {
            return errorMessage(error)
        }
    }

    /** 冲突文件清单（merge 失败后、abort 前取）；git 失败返回空（按非冲突失败处理） */
    private async conflictFiles(repoRoot: string): Promise<string[]> {
        try {
            const output = await this.git(repoRoot, ['diff', '--name-only', '--diff-filter=U'])
            return output.split('\n').map((line) => line.trim()).filter(Boolean)
        } catch {
            return []
        }
    }

    /**
     * 合并失败回滚：no-ff 冲突有 MERGE_HEAD，`merge --abort` 是标准路径；squash
     * 冲突不写 MERGE_HEAD（git 语义：不记录 merge 信息），退化为 reset 到 HEAD 并
     * 清掉 merge 引入的未跟踪文件（前置闸已保证主树在合并前是干净的，非 .mobi 的
     * 未跟踪文件只可能来自本次 merge）。
     */
    private async rollbackMerge(repoRoot: string): Promise<void> {
        try {
            await this.git(repoRoot, ['merge', '--abort'])
            return
        } catch {
            // squash 冲突 / 无进行中的 merge：走下面的 reset 路径
        }
        try {
            await this.git(repoRoot, ['reset', '--hard', 'HEAD'])
            await this.git(repoRoot, ['clean', '-fdq', '--', '.', MOBI_STATE_EXCLUDE_PATHSPEC])
        } catch {
            // 回滚本身失败时不再抛：调用方拿到的是 merge 失败事实，主树状态交 git 报告
        }
    }
}

/** 路径归一（真实路径）：mkdtemp 的 /var 与 git 回报的 /private/var 是同一目录，
 *  归属比对与会话反查必须按真实路径对齐 */
async function canonicalPath(path: string): Promise<string> {
    try {
        return await realpath(path)
    } catch {
        return resolve(path)
    }
}
