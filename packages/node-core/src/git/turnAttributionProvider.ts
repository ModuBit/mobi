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
 * turn 档供数器（Turn Attribution Provider，审查供数的结构收口）。
 *
 * 「轮次归因」域的唯一供数面：审查四路消费（overview 统计 / files 明细 / patch /
 * contents）的 turn 档统一经此取数。turn-archive B 方案（2026-09-29 用户裁决）后
 * 降级链收单层——**封口归档（滚动单条，主源且唯一源）**：归档 = `{统计 + patch + ref}`，
 * patch 封口时当场合成落盘；无归档/历史轮 = 空（供数缺失，调用方走空降级语义）。
 * hydration（2026-09-29）：oversized 带 ref 读全文现场合成 patch、contents 带 ref
 * 读归档全文（历史轮 before 可得）；无 ref 条目（旧归档）走 B 方案现状。
 * 旧快照两树 / journal 兜底随 B 方案退役（journal 持久层票04 删）。
 *
 * 路径闸：归档的 path 是工具输入的文件系统路径（工作区闸，isSafeWorkspacePath）。
 */

import { OVERSIZE_DIFF_LINES, ReviewFileEntrySchema, type DiffTarget, type ReviewFileEntry } from '@mobi/shared'
import { FileTurnArchiveStore, getTurnArchivePath, type TurnArchiveRecord } from './turnArchiveStore'
import { FileTurnFulltextStore, getTurnFulltextRoot } from './turnFulltextStore'
import { synthesizeContentsPatch } from './contentsPatch'
import { gatePathForSource } from './pathGates'
import { git } from './gitExec'
import { logger } from '../logger'

// 路径闸单源在 pathGates（工作区闸/仓库闸 + 源分流）；re-export 保持既有 import 面不变
export { gatePathForSource }

// ── 归档轮 → review 条目（判定单源在 reviewEntry）─────────────────────────────

/** 归档轮 → review 条目：kind 直读封口定稿值，counts 读封口定稿值（turnArchiveStore
 *  的契约——行数封口时定稿、消费端只读不算，历史统计不随消费端算法演进漂移） */
export function archiveToReviewEntries(record: TurnArchiveRecord): ReviewFileEntry[] {
    return record.files
        .map((f) => ReviewFileEntrySchema.parse({
            path: f.path,
            previousPath: null,
            kind: f.kind,
            additions: f.additions,
            deletions: f.deletions,
            binary: false,
            untracked: true,
            oversized: f.additions + f.deletions > OVERSIZE_DIFF_LINES || f.oversizedPatch,
        }))
        .sort((a, b) => a.path.localeCompare(b.path))
}

/** git 条目 → review 条目（oversized 单点打标；untracked=false 由调用方向补） */
export function toReviewEntry(e: { path: string; previousPath?: string | null; kind: 'add' | 'modify' | 'delete' | 'rename'; additions: number; deletions: number; binary?: boolean }): ReviewFileEntry {
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

// ── 供数器 ─────────────────────────────────────────────────────────────────────

/** 单文件 patch 出口形状（patch 直读归档封口定稿，不再查询时合成） */
export type TurnSuppliedPatch = { patch: string; oversizedPatch: boolean }

export class TurnAttributionProvider {
    constructor(private readonly cwd: string) {}

    /** 供数源判定（单层）：归档最新轮（滚动单条）；带 turnIndex 而非最新轮 = 抛错
     *  （明确请求了不存在的轮次）；无归档 = null（调用方走空降级） */
    async resolve(sessionId: string, target: DiffTarget): Promise<TurnArchiveRecord | null> {
        if (target.kind !== 'turn') throw new Error('turn attribution provider only serves turn targets')
        const latest = await this.loadTurnArchive(sessionId)
        if (target.turnIndex === undefined) return latest
        if (latest?.turnIndex !== target.turnIndex) throw new Error(`turn not found (turnIndex: ${target.turnIndex})`)
        return latest
    }

    /** turn 档文件明细（review 条目形状，全量）：封口归档已是归因全量；无归档 = 空 */
    async entriesOf(sessionId: string, target: DiffTarget): Promise<ReviewFileEntry[]> {
        const record = await this.resolve(sessionId, target)
        return record ? archiveToReviewEntries(record) : []
    }

    /** patch 出口（patch 直读归档，供数档 patch 通道单点）：路径闸 workspace（归档
     *  path 是工具输入的文件系统路径）；未记录路径 / 无归档 = null（调用方空降级）。
     *  hydration：oversized 带 ref → 读全文现场合成 patch（惰性加载，不落盘、不回写
     *  归档）；无 ref（旧归档）/ 合成失败 = 维持空+打标（B 方案语义） */
    async patchOf(sessionId: string, target: DiffTarget, path: string): Promise<TurnSuppliedPatch | null> {
        const record = await this.resolve(sessionId, target)
        if (!record) return null
        gatePathForSource('workspace', path, this.cwd, null)
        const entry = record.files.find((f) => f.path === path)
        if (!entry) return null
        if (entry.oversizedPatch && entry.ref !== undefined) {
            try {
                const full = await this.fulltextStore(sessionId).readFulltext(record.turnIndex, entry.ref)
                const patch = await synthesizeContentsPatch(git, entry.path, full.before, full.after)
                if (patch !== '') return { patch, oversizedPatch: false }
            } catch (e) {
                logger.debug('[TurnAttribution] oversized on-the-fly synthesis failed', entry.path, e)
            }
        }
        return { patch: entry.patch, oversizedPatch: entry.oversizedPatch }
    }

    /** 全文对出口（hydration）：条目带 ref 时读归档全文目录（历史轮 before 也可得）；
     *  无 ref（旧归档）/ 未记录路径 / 无归档 = null（调用方维持空降级协议） */
    async contentsOf(sessionId: string, target: DiffTarget, path: string): Promise<{ before: string | null; after: string | null } | null> {
        const record = await this.resolve(sessionId, target)
        if (!record) return null
        gatePathForSource('workspace', path, this.cwd, null)
        const entry = record.files.find((f) => f.path === path)
        if (!entry || entry.ref === undefined) return null
        return this.fulltextStore(sessionId).readFulltext(record.turnIndex, entry.ref)
    }

    /** 封口归档装载（唯一供数源）：无归档/损坏 = null */
    private async loadTurnArchive(sessionId: string): Promise<TurnArchiveRecord | null> {
        try {
            return await new FileTurnArchiveStore(getTurnArchivePath(this.cwd, sessionId)).loadLatest()
        } catch {
            return null
        }
    }

    /** 全文目录存储（hydration ref 消费，随请求装配，cwd 装配语义同归档） */
    private fulltextStore(sessionId: string): FileTurnFulltextStore {
        return new FileTurnFulltextStore(getTurnFulltextRoot(this.cwd, sessionId), this.cwd)
    }
}
