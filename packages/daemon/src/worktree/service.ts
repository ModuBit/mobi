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
import type { MergeBackResult, WorktreeSummary } from '@mobi/shared'
import { deleteWorktreeBranch, forceRemoveWorktree } from './cleanup'
import type { GitRunner } from './gitRunner'
import { runGit } from './gitRunner'
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
    head: string | null
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

/** porcelain 输出按空行分块；每块取 worktree / HEAD / branch 三键 */
export function parseWorktreeList(output: string): WorktreeListEntry[] {
    const entries: WorktreeListEntry[] = []
    for (const block of output.split(/\n\s*\n/)) {
        const entry: WorktreeListEntry = { path: '', branch: null, head: null }
        for (const line of block.split('\n')) {
            if (line.startsWith('worktree ')) entry.path = line.slice('worktree '.length).trim()
            else if (line.startsWith('HEAD ')) entry.head = line.slice('HEAD '.length).trim()
            else if (line.startsWith('branch ')) entry.branch = line.slice('branch '.length).trim()
        }
        if (entry.path) entries.push(entry)
    }
    return entries
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
        const repoRoots = await this.collectRepoRoots()
        const sessionsByWorktreePath = await this.sessionsByWorktreePath()

        const summaries: WorktreeSummary[] = []
        const seen = new Set<string>()
        for (const repoRoot of repoRoots) {
            const repoBranch = await this.currentBranch(repoRoot)
            for (const entry of await this.listRepoWorktrees(repoRoot)) {
                const worktreePath = await canonicalPath(entry.path)
                if (seen.has(worktreePath)) continue
                const layout = parseMobiWorktreeLayout(worktreePath)
                if (!layout) continue
                if (resolve(layout.repoRoot) !== resolve(repoRoot)) continue
                const nameFromBranch = entry.branch ? worktreeNameFromBranch(entry.branch) : null
                if (!nameFromBranch || nameFromBranch !== layout.name) continue

                seen.add(worktreePath)
                summaries.push(await this.toSummary({
                    worktreePath,
                    repoRoot: resolve(repoRoot),
                    name: layout.name,
                    branch: branchForWorktreeName(layout.name),
                    repoBranch,
                    session: sessionsByWorktreePath.get(worktreePath)
                }))
            }
        }

        return summaries.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || a.name.localeCompare(b.name))
    }

    /** 候选仓库根：工作区 folders + 会话 WorktreeMetadata.basePath，各自 rev-parse 收敛去重 */
    private async collectRepoRoots(): Promise<string[]> {
        const candidates = new Set<string>()
        for (const workspace of this.store.workspaces.getAllWorkspaces()) {
            for (const folder of workspace.folders) candidates.add(folder.path)
        }
        for (const session of this.store.sessions.getSessions()) {
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
        try {
            const branch = (await this.git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
            return branch && branch !== 'HEAD' ? branch : undefined
        } catch {
            return undefined
        }
    }

    private async listRepoWorktrees(repoRoot: string): Promise<WorktreeListEntry[]> {
        try {
            return parseWorktreeList(await this.git(repoRoot, ['worktree', 'list', '--porcelain']))
        } catch {
            return []
        }
    }

    /** worktreePath → 所属会话（同一路径理论上唯一；多行时取最近更新的一行） */
    private async sessionsByWorktreePath(): Promise<Map<string, WorktreeSessionRow>> {
        const byPath = new Map<string, WorktreeSessionRow>()
        for (const session of this.store.sessions.getSessions()) {
            const worktreePath = readWorktreeMetadata(session)?.worktreePath
            if (!worktreePath) continue
            const key = await canonicalPath(worktreePath)
            const existing = byPath.get(key)
            if (!existing || session.updatedAt > existing.updatedAt) byPath.set(key, session)
        }
        return byPath
    }

    private async toSummary(input: {
        worktreePath: string
        repoRoot: string
        name: string
        branch: string
        repoBranch?: string
        session: WorktreeSessionRow | undefined
    }): Promise<WorktreeSummary> {
        const [status, createdAt, lastCommitAt] = await Promise.all([
            inspectWorktreeStatus(this.git, input.worktreePath),
            this.worktreeCreatedAt(input.worktreePath),
            this.lastCommitAt(input.worktreePath)
        ])
        const running = input.session ? this.isSessionRunning(input.session.id) : false
        return {
            name: input.name,
            branch: input.branch,
            worktreePath: input.worktreePath,
            repoRoot: input.repoRoot,
            ...(input.repoBranch ? { repoBranch: input.repoBranch } : {}),
            ...(input.session ? { sessionId: input.session.id } : {}),
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
    async mergeBack(request: {
        worktreePath: string
        strategy?: 'no-ff' | 'squash'
        cleanup?: boolean
    }): Promise<MergeBackResult> {
        const strategy = request.strategy ?? 'no-ff'
        const cleanup = request.cleanup ?? true

        const located = await this.locate(request.worktreePath)
        if (!located.ok) return located.result
        const { worktreePath, repoRoot, name, branch, session } = located

        if (session && this.isSessionRunning(session.id)) {
            return { ok: false, reason: 'session-running' }
        }

        const mainDirty = await this.dirtyPaths(repoRoot)
        if (mainDirty === null) {
            return { ok: false, reason: 'git-failed', message: 'Unable to read main repository status' }
        }
        if (mainDirty.length > 0) {
            return { ok: false, reason: 'main-dirty', files: mainDirty }
        }

        let mainBranch: string
        try {
            mainBranch = (await this.git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
        } catch (error) {
            return { ok: false, reason: 'git-failed', message: errorText(error) }
        }
        if (!mainBranch || mainBranch === 'HEAD') {
            return { ok: false, reason: 'detached-head' }
        }

        // 脏 worktree → 自动 WIP 提交（只含非 .mobi 改动；无改动不产生空提交）
        const wip = await this.commitWipIfNeeded(worktreePath, name)
        if (!wip.ok) return wip.result

        // 目标恒为主仓库当前检出分支（用户想合到别的分支自己先切）
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

        const warnings: string[] = []
        const removal = await forceRemoveWorktree(this.git, repoRoot, worktreePath)
        let branchDeleted = false
        if (!removal.ok) {
            warnings.push(`Failed to remove worktree: ${removal.error ?? 'unknown error'}`)
        } else {
            // no-ff 用 -d（已合入才删得掉，天然防呆）；squash 后 git 认为未合入，用 -D
            const deleted = await deleteWorktreeBranch(this.git, repoRoot, branch, strategy === 'squash')
            branchDeleted = deleted.ok
            if (!deleted.ok) warnings.push(`Failed to delete branch ${branch}: ${deleted.error ?? 'unknown error'}`)
        }

        return {
            ok: true,
            strategy,
            worktreeRemoved: removal.ok,
            branchDeleted,
            ...(warnings.length > 0 ? { warning: warnings.join('; ') } : {})
        }
    }

    // ── 丢弃 ───────────────────────────────────────────────────────────────

    /** 丢弃：`worktree remove --force` + `branch -D`；定位参数经归属约定校验后才执行 */
    async discard(request: { worktreePath: string }): Promise<{
        ok: true
        worktreeRemoved: boolean
        branchDeleted: boolean
        warning?: string
    } | {
        ok: false
        reason: 'invalid-worktree' | 'session-running' | 'git-failed'
        message?: string
    }> {
        const located = await this.locate(request.worktreePath)
        if (!located.ok) {
            return located.result.reason === 'repo-mismatch'
                ? { ok: false, reason: 'invalid-worktree' }
                : { ok: false, reason: located.result.reason }
        }
        const { worktreePath, repoRoot, branch, session } = located
        if (session && this.isSessionRunning(session.id)) {
            return { ok: false, reason: 'session-running' }
        }

        const removal = await forceRemoveWorktree(this.git, repoRoot, worktreePath)
        if (!removal.ok) return { ok: false, reason: 'git-failed', message: removal.error }

        const deleted = await deleteWorktreeBranch(this.git, repoRoot, branch, true)
        return {
            ok: true,
            worktreeRemoved: true,
            branchDeleted: deleted.ok,
            ...(deleted.ok ? {} : { warning: deleted.error })
        }
    }

    // ── 归属定位与校验 ─────────────────────────────────────────────────────

    /**
     * 定位 + 归属校验（合回/丢弃共用）：路径形状符合约定 → worktree 实际分支必须是
     * `mobi-<name>` → 与解析出的主仓库共享同一 commonDir（防路径被挪动后误操作）。
     */
    private async locate(worktreePath: string): Promise<
        | { ok: true; worktreePath: string; repoRoot: string; name: string; branch: string; session: WorktreeSessionRow | undefined }
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
            return { ok: false, result: { ok: false, reason: 'invalid-worktree', message: errorText(error) } }
        }

        const repoRoot = resolve(layout.repoRoot)
        const sameRepo = await this.sharesCommonDir(absolutePath, repoRoot)
        if (sameRepo === null) {
            return { ok: false, result: { ok: false, reason: 'git-failed' } }
        }
        if (!sameRepo) {
            return { ok: false, result: { ok: false, reason: 'repo-mismatch' } }
        }

        const session = (await this.sessionsByWorktreePath()).get(absolutePath)
        return { ok: true, worktreePath: absolutePath, repoRoot, name: layout.name, branch: expectedBranch, session }
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
            await this.git(worktreePath, ['add', '-A', '--', '.', ':(exclude).mobi'])
            const status = await this.git(worktreePath, ['status', '--porcelain', '-z', '-uall'])
            if (!hasStagedChanges(status)) return { ok: true }
            await this.git(worktreePath, ['commit', '--no-verify', '-m', `WIP: mobi ${name} pre-merge`])
            return { ok: true }
        } catch (error) {
            return {
                ok: false,
                result: { ok: false, reason: 'git-failed', message: errorText(error) }
            }
        }
    }

    /** 执行合并；成功返回 null，失败返回错误文案 */
    private async runMerge(repoRoot: string, branch: string, strategy: 'no-ff' | 'squash'): Promise<string | null> {
        try {
            if (strategy === 'squash') {
                await this.git(repoRoot, ['merge', '--squash', branch])
                const name = worktreeNameFromBranch(branch) ?? branch
                await this.git(repoRoot, ['commit', '--no-verify', '-m', `mobi worktree ${name}: squash merge`])
            } else {
                await this.git(repoRoot, ['merge', '--no-ff', branch])
            }
            return null
        } catch (error) {
            return errorText(error)
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
            await this.git(repoRoot, ['clean', '-fdq', '--', '.', ':(exclude).mobi'])
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

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}
