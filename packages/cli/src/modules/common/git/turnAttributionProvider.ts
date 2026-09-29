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
 * turn 档供数器（Turn Attribution Provider，审查 v3 供数反转的结构收口）。
 *
 * 「轮次归因」域的唯一供数面：审查四路消费（overview 统计 / files 明细 / patch /
 * contents）的 turn 档统一经此取数，内部降级链单点——
 * 1. 封口归档（FileTurnArchiveStore，主源）：归因全量（含 gitignored），内容对封口
 *    时已记全；缺省 = 最新封口轮（「上一轮」语义）
 * 2. 快照两树（snapshot store 链上 pair，兜底实况源）：链尾 pair / 链上该序号 pair
 *    （原 diffTargetResolver 的 chainPairAt/tailPair 随 turn 职责迁入）
 * 3. journal 补全（loadToolJournalForReview，末位）：非 git 目录全权供数、链不可用
 *    （toolSourceOnly 判定随之收口于此，resolver 不再平行解析）
 *
 * 「上一轮」判定（归档 turns.at(-1) vs 快照链尾 pair）随 resolve() 收口，调用方不再
 * 各自分流；diffTargetResolver 的 turn 档委托本供数器（消除不知归档存在的平行解析）。
 *
 * 路径闸随源走：内容型源（归档/journal）的 path 是工具输入的文件系统路径（工作区
 * 闸），快照两树源是仓库相对路径（repo 相对闸）——闸在本模块内按源施加，caller 无感。
 *
 * git 执行不入本模块：条目组装经 gitOps 注入（reader 的收口 git() 同源），测试用桩。
 */

import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve, sep } from 'node:path'
import {
    OVERSIZE_DIFF_LINES,
    ReviewFileEntrySchema,
    type DiffTarget,
    type ReviewFileEntry,
    type TurnDiffFileEntry,
} from '@mobi/shared'
import { reviewEntryFromContents } from './reviewEntry'
import { getToolChangesPath, loadToolChangeJournal, ToolChangeJournal } from './toolChangeJournal'
import { FileTurnArchiveStore, getTurnArchivePath, type TurnArchiveRecord } from './turnArchiveStore'
import type { TurnSnapshotStore } from './turnSnapshotStore'

// ── 路径闸（源决定闸，① 自 gitReview 迁入）─────────────────────────────────────

/** 仓库相对路径安全闸门：拒绝绝对路径、反斜杠与 `..` 逃逸（git 子系统自带同规则，盘上读取同闸门） */
export function isSafeRepoRelative(path: string): boolean {
    if (path === '' || path.startsWith('/') || path.includes('\\')) return false
    return path.split('/').every((seg) => seg !== '..')
}

/** 内容型源（归档/journal 供数档）的路径闸：path 是工具输入的文件系统路径
 *  （E2E 实证为绝对路径；相对时以 cwd 为基准），只要求解析后不逃出 cwd */
export function isSafeWorkspacePath(path: string, cwd: string): boolean {
    if (path === '' || path.includes('\0') || path.includes('\\')) return false
    const abs = resolve(isAbsolute(path) ? path : join(cwd, path))
    return abs === cwd || abs.startsWith(cwd + sep)
}

// ── 内容对 → review 条目（判定单源在 reviewEntry，② 收口）──────────────────────

/** journal → review 条目（kind/counts/oversized 判定单源 reviewEntryFromContents） */
export function journalToEntries(journal: { listPaths(): string[]; get(path: string): { beforeContent: string | null; afterContent: string | null } | undefined }): ReviewFileEntry[] {
    return journal.listPaths().sort((a, b) => a.localeCompare(b)).map((path) => {
        const entry = journal.get(path)!
        return reviewEntryFromContents(path, entry.beforeContent, entry.afterContent)
    })
}

/** 归档轮 → review 条目（判定单源 reviewEntryFromContents；内容对封口时已记全） */
export function archiveToReviewEntries(record: TurnArchiveRecord): ReviewFileEntry[] {
    return record.files
        .map((f) => reviewEntryFromContents(f.path, f.beforeContent, f.afterContent))
        .sort((a, b) => a.path.localeCompare(b.path))
}

/** git 条目 → review 条目（oversized 单点打标；untracked=false 由调用方向补） */
export function toReviewEntry(e: TurnDiffFileEntry): ReviewFileEntry {
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

// ── journal 装载（① 自 gitReview 迁入）─────────────────────────────────────────

/** turn 档审查用 journal 装载（after 补全）：Edit 类 toolUseResult 只带 originalFile
 *  （before 全文）不带 after——journal 占位 null（spec 2.1「归并规则自理」）。消费时
 *  用磁盘当前内容补 after（编辑后文件已删 = null 保持，全删语义成立）；before 缺失
 *  （Write 只记 after）不补。E2E 实证（票09）：缺此补全时非 git turn 档统计与全文对
 *  呈「整文件删除」假象（+0 -2 / after missing） */
export async function loadToolJournalForReview(sessionId: string, cwd: string): Promise<ToolChangeJournal> {
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

// ── 供数器 ─────────────────────────────────────────────────────────────────────

/** turn 档供数源（降级链的显式结果）：journal 源即 toolSourceOnly（判定收口于此），
 *  sealed/snapshot 源为 git 语义（内容对 / 两树） */
export type TurnAttributionSource =
    | { kind: 'sealed'; record: TurnArchiveRecord }
    | { kind: 'snapshot'; baseTree: string; headTree: string }
    | { kind: 'journal' }

/** pairOf 出口：内容型源直出内容对；快照源交回两树（调用方走 git 查询出口） */
export type TurnSuppliedPair =
    | { kind: 'contents'; before: string | null; after: string | null }
    | { kind: 'snapshot'; baseTree: string; headTree: string }

/** git 执行注入（reader 的收口 git() 同源；条目组装不入本模块，测试用桩） */
export type TurnAttributionGitOps = {
    isGitRepository: () => Promise<boolean>
    /** name-status + numstat 组装（args 含 'diff' 动词与两树） */
    entries: (args: string[]) => Promise<TurnDiffFileEntry[]>
}

export class TurnAttributionProvider {
    constructor(
        private readonly cwd: string,
        /** 快照链 store（null = 链不可用，兜底直接落 journal） */
        private readonly store: TurnSnapshotStore | null,
        private readonly gitOps: TurnAttributionGitOps,
    ) {}

    /** 供数源判定（降级链单点，「上一轮」判定与 isGit/toolSourceOnly 收口于此）：
     *  封口归档（缺省 = 最新封口轮）→ 非 git 判定 → 快照两树（链尾 pair / 链上该序号
     *  pair）→ journal。带 turnIndex 而归档与快照链均未覆盖 → 抛错（明确请求了不存在的
     *  轮次，journal 只有当前状态，兜底会给错数据） */
    async resolve(sessionId: string, target: DiffTarget): Promise<TurnAttributionSource> {
        if (target.kind !== 'turn') throw new Error('turn attribution provider only serves turn targets')
        const turns = await this.loadTurnArchive(sessionId)
        const sealed = target.turnIndex !== undefined
            ? turns.find((t) => t.turnIndex === target.turnIndex) ?? null
            : turns.at(-1) ?? null
        if (sealed) return { kind: 'sealed', record: sealed }
        // 非 git：journal 全权供数（快照链不存在，与 resolver 旧判定同语义）
        if (!(await this.gitOps.isGitRepository())) return { kind: 'journal' }
        const pair = this.store
            ? (target.turnIndex !== undefined
                ? await chainPairAt(this.store, sessionId, target.turnIndex)
                : await tailPair(this.store, sessionId))
            : null
        if (pair) return { kind: 'snapshot', baseTree: pair.base.tree, headTree: pair.head.tree }
        if (target.turnIndex !== undefined) throw new Error(`turn snapshot not found (turnIndex: ${target.turnIndex})`)
        return { kind: 'journal' }
    }

    /** turn 档文件明细（review 条目形状，全量）：封口归档已是归因全量（含 gitignored，
     *  无需 journal 补入）；快照两树 ∪ journal 补入（git 视野外路径）；journal 全权供数 */
    async entriesOf(sessionId: string, target: DiffTarget): Promise<ReviewFileEntry[]> {
        const source = await this.resolve(sessionId, target)
        switch (source.kind) {
            case 'sealed':
                return archiveToReviewEntries(source.record)
            case 'journal':
                return journalToEntries(await loadToolJournalForReview(sessionId, this.cwd))
            case 'snapshot': {
                const [tracked, journal] = await Promise.all([
                    this.gitOps.entries(['diff', source.baseTree, source.headTree, '-M']),
                    loadToolJournalForReview(sessionId, this.cwd),
                ])
                // journal 补入 git 视野外路径（gitignored 等）；已在 git 条目中的不重复。
                // supplement 保持 review 条目形状（untracked 事实不经过 TurnDiffFileEntry 有损转换）
                const known = new Set(tracked.map((f) => f.path))
                return [...tracked.map(toReviewEntry), ...journalToEntries(journal).filter((f) => !known.has(f.path))]
                    .sort((a, b) => a.path.localeCompare(b.path))
            }
        }
    }

    /** 内容对出口（patch/contents 共用）：内容型源直出内容对（未记录路径返回 null，
     *  空结果降级语义归调用方）；快照源交回两树由调用方走 git 查询。路径闸随源在内部
     *  施加（源决定闸，caller 无感） */
    async pairOf(sessionId: string, target: DiffTarget, path: string): Promise<TurnSuppliedPair | null> {
        const source = await this.resolve(sessionId, target)
        if (source.kind === 'snapshot') {
            if (!isSafeRepoRelative(path)) throw new Error(`Invalid path: ${path}`)
            return { kind: 'snapshot', baseTree: source.baseTree, headTree: source.headTree }
        }
        if (!isSafeWorkspacePath(path, this.cwd)) throw new Error(`Invalid path: ${path}`)
        if (source.kind === 'sealed') {
            const entry = source.record.files.find((f) => f.path === path)
            return entry ? { kind: 'contents', before: entry.beforeContent, after: entry.afterContent } : null
        }
        const entry = (await loadToolJournalForReview(sessionId, this.cwd)).get(path)
        return entry ? { kind: 'contents', before: entry.beforeContent, after: entry.afterContent } : null
    }

    /** 封口归档装载（审查 v3 主供数源）：无归档/损坏 = 空数组（兜底链接手） */
    private async loadTurnArchive(sessionId: string): Promise<TurnArchiveRecord[]> {
        try {
            return await new FileTurnArchiveStore(getTurnArchivePath(this.cwd, sessionId)).listTurns()
        } catch {
            return []
        }
    }
}

/** 链上 turnIndex 处的一对快照（turnIndex 的基线 = 链上前一颗）；越界/链不足返回 null
 *  （原 diffTargetResolver 私有实现随 turn 职责迁入） */
async function chainPairAt(store: TurnSnapshotStore, sessionId: string, turnIndex: number): Promise<{ base: { tree: string }; head: { tree: string } } | null> {
    const chain = await store.listChain(sessionId)
    const idx = chain.findIndex((r) => r.index === turnIndex)
    if (idx < 1) return null
    const base = chain[idx - 1]!
    const head = chain[idx]!
    return { base: { tree: base.tree }, head: { tree: head.tree } }
}

/** 链尾一对（「上一轮」缺省语义）；链不足两颗（无 baseline/无链）返回 null */
async function tailPair(store: TurnSnapshotStore, sessionId: string): Promise<{ base: { tree: string }; head: { tree: string } } | null> {
    const last = await store.lastTurnDiff(sessionId)
    if (!last) return null
    return { base: { tree: last.base.tree }, head: { tree: last.head.tree } }
}
