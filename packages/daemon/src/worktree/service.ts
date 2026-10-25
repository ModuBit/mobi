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
 * worktree 生命周期服务（深模块）：把「归属判定 + 脏判定 + 列表扫描」
 * 收在一个进程内服务里，路由只做鉴权/校验/转发。worktree 生命周期长于会话
 * （孤儿 worktree 没有会话可寻址），所以挂 host 直调族而非 session machine 通道。
 *
 * 无持久登记表：列表按需扫描 workspaces 目录，会话归属用 worktreePath 反查
 * sessions 表 WorktreeMetadata；扫不到会话的即孤儿条目。
 */

import { realpath, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { WorktreeSummary } from '@mobi/shared'
import type { GitRunner } from './gitRunner'
import { runGit } from './gitRunner'
import { branchForWorktreeName, parseMobiWorktreeLayout, worktreeNameFromBranch } from './identity'
import { inspectWorktreeStatus } from './status'

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
