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

import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { logger } from '@/ui/logger'
import type { LastTurnDiff, TurnSnapshotRef, TurnSnapshotStore, TurnTreeDiffEntry, TurnTreeDiffKind } from './turnSnapshotStore'

const execFileAsync = promisify(execFile)

/** .mobi 内部状态目录不入快照（审查 v3 票04 由 '.mobi/artifacts' 收敛为全目录：
 *  artifacts/turn-diffs journal/封口归档都是 mobi 自身状态，有自己的展示通道，
 *  混进变更归因是噪音——journal 每轮都在写，不摘除会让快照兜底档每轮多出内部文件） */
const EXCLUDE_PATH = '.mobi'

const REF_NAMESPACE = 'refs/mobi/turn-diffs'

/** 引用名合法字符白名单外的字符（sessionId 理论上不含，兜底替换保 refname 合法） */
function sanitizeSessionId(sessionId: string): string {
    const safe = sessionId.replace(/[^A-Za-z0-9._-]/g, '_')
    if (safe !== sessionId) {
        logger.debug(`[TurnSnapshotStore] sessionId 含引用名非法字符，已替换: ${sessionId} -> ${safe}`)
    }
    return safe
}

/** CLI 内 git 执行唯一收口：maxBuffer 64MB（diff 输出可能很大），env 供临时 index 注入 */
export async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd, env, maxBuffer: 64 * 1024 * 1024 })
    return stdout
}

/** store 按 cwd 复用（仅携带 cwd 与 prefix 缓存）：同 cwd 的每次 RPC 不必重跑
 *  rev-parse。仓库消失时 git 调用自然失败 → 上层诚实置空，无需失效机制；
 *  规模上界 = 出现过的工作区目录数，无需淘汰。 */
const stores = new Map<string, TurnSnapshotStore | null>()

/** 仓库判定缓存失效（审查 v2 git init 后放行）：下次 openTurnSnapshotStore 重跑 rev-parse */
export function dropTurnSnapshotStoreCache(cwd: string): void {
    stores.delete(cwd)
}

/**
 * 打开 cwd 所在仓库的快照存储；cwd 不在 git 仓库内返回 null——
 * 不可用是显式返回值而非异常，调用方据此走非 git 降级口径。
 */
export async function openTurnSnapshotStore(cwd: string): Promise<TurnSnapshotStore | null> {
    const cached = stores.get(cwd)
    if (cached !== undefined) return cached
    let store: TurnSnapshotStore | null
    try {
        await git(cwd, ['rev-parse', '--show-toplevel'])
        store = new GitTurnSnapshotStore(cwd)
    } catch {
        store = null
    }
    stores.set(cwd, store)
    return store
}

export class GitTurnSnapshotStore implements TurnSnapshotStore {
    constructor(private readonly cwd: string) {}

    /** 仓库根与 prefix（scope 收敛用，按实例缓存——store 按 cwd 复用）。scope 类 git
     *  命令统一在 repoRoot 执行 + 仓库相对 pathspec（子目录 cwd 下 pathspec 相对 cwd
     *  解析，直接用 prefix 会指向 sub/sub/——真仓库实证 2026-09-29） */
    private scopeCache: { root: string; prefix: string } | undefined

    async capture(sessionId: string): Promise<TurnSnapshotRef> {
        const safeId = sanitizeSessionId(sessionId)
        // 临时 index：独立于用户暂存区，add 与 write-tree 都指向它，用完即删
        const tmpIndex = join(tmpdir(), `mobi-turn-idx-${randomUUID()}`)
        const env = { ...process.env, GIT_INDEX_FILE: tmpIndex }
        try {
            // 预热临时 index（审查 v3 票04，ZCode gitCheckpointRepo 同款解法）：空 index 下
            // `add -A` 对每个未改动文件 open/read/hash 写对象（Windows+Defender 实测放大到
            // 5-15ms/文件，大仓库单次 capture 秒级）。优先复制用户 index——stat cache 让
            // 未改动文件走 stat-match 快速路径直接跳过；无 index（刚 init 的空仓）降级
            // read-tree HEAD（tracked 文件 hash-match）；再失败回落空 index。
            // 最终树由 add 决定，预热只影响速度不影响语义
            await this.primeIndex(tmpIndex, env)
            // scope 收敛（审查 v3 票04）：只 add 会话 cwd（prefix）内的变更——monorepo
            // 子目录会话不裹挟其他 workspace 的改动；prefix 外保持预热 index 的内容
            // （ZCode 同构）。不用 exclude pathspec：pathspec 显式命中「已被 .gitignore
            // 忽略」的路径会让整个 add 以「Use -f」报错退出（真仓库实证 2026-09-27）
            const scope = await this.repoScope()
            await git(scope.root, scope.prefix ? ['add', '-A', '--', scope.prefix] : ['add', '-A'], env)
            await git(this.cwd, ['rm', '--cached', '-r', '-q', '--ignore-unmatch', '--', EXCLUDE_PATH], env)
            const tree = (await git(this.cwd, ['write-tree'], env)).trim()
            // index 分配 CAS：update-ref 带全零 oldvalue 断言「引用尚不存在」，并发
            // capture（fork 场景同仓库同 sessionId）输家重读链重试，不会互相覆盖引用
            const zero = '0'.repeat(40)
            let ref: TurnSnapshotRef | undefined
            for (let attempt = 0; attempt < 5; attempt++) {
                const chain = await this.listChain(sessionId)
                const candidate: TurnSnapshotRef = { index: (chain.at(-1)?.index ?? 0) + 1, tree }
                try {
                    await git(this.cwd, ['update-ref', `${REF_NAMESPACE}/${safeId}/${candidate.index}`, tree, zero])
                    ref = candidate
                    break
                } catch {
                    logger.debug(`[TurnSnapshotStore] capture index ${candidate.index} contended, retrying`)
                }
            }
            if (!ref) throw new Error('capture failed: index allocation contended 5 times')
            return ref
        } finally {
            await fsRemove(tmpIndex)
        }
    }

    /** 预热临时 index：copyFile 用户 index → 降级 read-tree HEAD → 空 index（全吞错） */
    private async primeIndex(tmpIndex: string, env: NodeJS.ProcessEnv): Promise<void> {
        const { root } = await this.repoScope()
        try {
            // rev-parse --git-path 可能返回相对执行 cwd 的路径（worktree/submodule 场景），resolve 兜底
            const rel = (await git(root, ['rev-parse', '--git-path', 'index'])).trim()
            if (rel.length > 0) {
                await copyFile(resolve(root, rel), tmpIndex)
                return
            }
        } catch {
            // 用户 index 不存在或不可读：降级
        }
        try {
            await git(root, ['read-tree', 'HEAD'], env)
        } catch {
            // 无 HEAD（全新空仓）：空 index
        }
    }

    /** 仓库根 + prefix 查询（失败 = 以 cwd 本体全量 scope，按实例缓存） */
    private async repoScope(): Promise<{ root: string; prefix: string }> {
        if (this.scopeCache !== undefined) return this.scopeCache
        try {
            const root = (await git(this.cwd, ['rev-parse', '--show-toplevel'])).trim()
            const prefix = (await git(this.cwd, ['rev-parse', '--show-prefix'])).trim()
            this.scopeCache = { root, prefix }
        } catch {
            this.scopeCache = { root: this.cwd, prefix: '' }
        }
        return this.scopeCache
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
        // name-status 定 kind（含 rename 旧路径），numstat 定计数，按路径对齐组装。
        // pathspec 收敛（审查 v3 票04）：树是全仓库的，diff 输出收敛到会话 cwd scope
        const { root, prefix } = await this.repoScope()
        const spec = prefix ? ['--', prefix] : []
        const [statusOut, numstatOut] = await Promise.all([
            git(root, ['diff', '--name-status', '-z', '-M', baseTree, headTree, ...spec]),
            git(root, ['diff', '--numstat', '-z', '-M', baseTree, headTree, ...spec]),
        ])
        return assembleDiffEntries(statusOut, numstatOut)
    }

    async clearSession(sessionId: string): Promise<number> {
        const safeId = sanitizeSessionId(sessionId)
        const chain = await this.listChain(sessionId)
        if (chain.length === 0) return 0
        // --stdin 单进程批删：逐 ref 一次 spawn 在长会话（成百上千快照）下线性劣化
        const input = chain.map((ref) => `delete ${REF_NAMESPACE}/${safeId}/${ref.index}`).join('\n') + '\n'
        await new Promise<void>((resolve, reject) => {
            const child = spawn('git', ['update-ref', '--stdin'], { cwd: this.cwd })
            child.stdin.end(input)
            let stderr = ''
            child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
            child.on('error', reject)
            child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`git update-ref --stdin exited ${code}: ${stderr}`))))
        })
        return chain.length
    }
}

/**
 * name-status + numstat 两命令输出 → 按路径对齐的条目列表（rename 后路径对齐、
 * 二进制计数兜底、按 path localeCompare 排序）。快照两树 diff 与审查工作区实况
 * 查询共用同一组装——格式规则（见文件头实证记录）只此一处。
 */
export function assembleDiffEntries(statusOut: string, numstatOut: string): TurnTreeDiffEntry[] {
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
