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
 * turn 封口归档（turn-archive B 方案：滚动单条极简化）——turn 档的权威历史事实源。
 *
 * turnDiffReporter 在每个 turn 结束时（全文在内存时）逐文件算统计、合成 patch 封口
 * 写入；审查 turn 档（gitReview 六方法）与 turn 卡的 baseTurnIndex 都从这里读。
 *
 * 全文一个字节不进盘：每文件记录 = `{统计 + patch}`，patch 是封口当场合成的 unified
 * diff（> OVERSIZE_DIFF_LINES 降级为空 + oversizedPatch 打标，统计永远保留）。
 * 与 ToolChangeJournal 的分工：journal（内存归并器）是 turn 内累积原料（before 取
 * 首次 / after 取末次），归档是封口定稿（消费端只读不算）。
 *
 * 落盘：`.mobi/turn-diffs/<sessionId>/turn-archive.json`，**滚动单条**——文件内容
 * 就是最新一轮的记录，每次 seal 整体覆盖写（tmp + rename 原子写）；旧多轮格式
 * `{turns: [...]}` 只读兼容：取 turns.at(-1)，下次 seal 自然覆盖成新格式，不写迁移器。
 * 损坏文件按空归档起步（事实源宁可缺失不阻塞主流程）。
 *
 * hydration（2026-09-29）：归档条目加全文 ref（`{ref: {before?, after?}}`，相对
 * turnId 目录）——全文正文在 `turn-diffs/<sid>/<turnId>/{a,b}/`（turnFulltextStore
 * 封口落盘），patch 改由目录模式单次 diff 合成；ref 缺省（旧格式/跳过文件）读侧走
 * 单文件兜底合成，行为同 B 方案。
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TurnDiffFileKind } from '@mobi/shared'
import { contentsChangeOf } from './reviewEntry'
import { sanitizeSessionId } from './gitExec'
import { writeFileAtomic } from './atomicWrite'
import type { TurnFulltextRef } from './turnFulltextStore'

/** 封口的单文件记录（hydration：统计 + patch + 全文 ref） */
export type TurnArchiveFile = {
    path: string
    kind: TurnDiffFileKind
    writeCount: number
    toolNames: string[]
    /** 封口时合成的 unified patch（目录模式单次 diff；超行数闸降级为空串） */
    patch: string
    /** patch 超行数闸被清空的事实标记（统计仍有效，web 据此出降级文案） */
    oversizedPatch: boolean
    /** 行数（封口时定稿：消费端只读不算，保证「该轮当时」的统计不受消费端算法演进影响） */
    additions: number
    deletions: number
    /** 全文目录指针（相对 turnId 目录；缺省 = 旧格式/跳过文件无全文，读侧走现状兜底） */
    ref?: TurnFulltextRef
}

/** 一轮的封口记录（即落盘 wire 形状：单条顶层对象） */
export type TurnArchiveRecord = {
    /** 会话内递增的轮次序号 */
    turnIndex: number
    /** 基线轮序号（无 = 首轮） */
    baseTurnIndex: number | null
    /** 封口时间戳（ms） */
    sealedAt: number
    files: TurnArchiveFile[]
}

/** 归档存储接口——调用方唯一可见的面 */
export interface TurnArchiveStore {
    /** 封口一轮（整体覆盖写，永远只保最新） */
    seal(record: TurnArchiveRecord): Promise<void>
    /** 兼容面（票02 收口后随调用点清理）：至多返回最新一条 */
    listTurns(): Promise<TurnArchiveRecord[]>
    /** 按轮次序号读单轮：滚动单条下只有最新轮可命中，其余返回 null */
    loadTurn(turnIndex: number): Promise<TurnArchiveRecord | null>
    /** 最新轮；无归档返回 null */
    loadLatest(): Promise<TurnArchiveRecord | null>
}

/** 落盘路径：工作区 `.mobi/turn-diffs/<sessionId>/turn-archive.json` */
export function getTurnArchivePath(workspaceRoot: string, sessionId: string): string {
    // 字符面单源 sanitizeSessionId（与快照 ref 子树/归档目录同清洗）
    return join(workspaceRoot, '.mobi', 'turn-diffs', sanitizeSessionId(sessionId), 'turn-archive.json')
}

/** 旧多轮格式形状（只读兼容） */
type LegacyArchiveFileShape = { turns: unknown[] }

/** 单条形状还原（坏条目给 null 跳过不抛）——事实源宁可缺失不阻塞读侧 */
function restoreRecord(raw: unknown): TurnArchiveRecord | null {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Partial<TurnArchiveRecord>
    if (typeof r.turnIndex !== 'number' || !Number.isFinite(r.turnIndex) || !Array.isArray(r.files)) return null
    const files: TurnArchiveFile[] = []
    for (const f of r.files) {
        if (!f || typeof f !== 'object') continue
        const e = f as Partial<TurnArchiveFile> & { beforeContent?: unknown; afterContent?: unknown; ref?: unknown }
        if (typeof e.path !== 'string' || e.path.length === 0) continue
        // 旧格式遗留全文字段（hydration 前过渡形状）：只用于 kind 兜底判定，不再保留进条目
        const beforeContent = typeof e.beforeContent === 'string' ? e.beforeContent : null
        const afterContent = typeof e.afterContent === 'string' ? e.afterContent : null
        const file: TurnArchiveFile = {
            path: e.path,
            // 旧格式无 kind：按遗留全文字段判定（contentsChangeOf 单源）；新格式直读
            kind: e.kind ?? contentsChangeOf(beforeContent, afterContent).kind,
            writeCount: typeof e.writeCount === 'number' && Number.isFinite(e.writeCount) ? e.writeCount : 1,
            toolNames: Array.isArray(e.toolNames) ? e.toolNames.filter((n): n is string => typeof n === 'string') : [],
            patch: typeof e.patch === 'string' ? e.patch : '',
            oversizedPatch: e.oversizedPatch === true,
            additions: typeof e.additions === 'number' && Number.isFinite(e.additions) ? e.additions : 0,
            deletions: typeof e.deletions === 'number' && Number.isFinite(e.deletions) ? e.deletions : 0,
        }
        const ref = parseFulltextRef(e.ref)
        if (ref) file.ref = ref
        files.push(file)
    }
    return {
        turnIndex: r.turnIndex,
        baseTurnIndex: typeof r.baseTurnIndex === 'number' ? r.baseTurnIndex : null,
        sealedAt: typeof r.sealedAt === 'number' ? r.sealedAt : 0,
        files,
    }
}

/** ref 形状还原：两侧字段须为非空字符串，双侧皆缺 = 无 ref（旧格式/跳过文件） */
function parseFulltextRef(raw: unknown): TurnFulltextRef | undefined {
    if (!raw || typeof raw !== 'object') return undefined
    const e = raw as { before?: unknown; after?: unknown }
    const ref: TurnFulltextRef = {}
    if (typeof e.before === 'string' && e.before.length > 0) ref.before = e.before
    if (typeof e.after === 'string' && e.after.length > 0) ref.after = e.after
    return ref.before || ref.after ? ref : undefined
}

/** 文件实现：seal 即整体覆盖写（归档频率 = 每 turn 一次，无需去抖） */
export class FileTurnArchiveStore implements TurnArchiveStore {
    constructor(private readonly filePath: string) {}

    private async readLatest(): Promise<TurnArchiveRecord | null> {
        let raw: unknown
        try {
            raw = JSON.parse(await readFile(this.filePath, 'utf8'))
        } catch {
            return null
        }
        // 旧多轮格式兼容：只认最新轮（历史轮「not found」，下次 seal 自然覆盖成新格式）
        const legacy = (raw as Partial<LegacyArchiveFileShape> | null)?.turns
        if (Array.isArray(legacy)) return restoreRecord(legacy.at(-1))
        return restoreRecord(raw)
    }

    async seal(record: TurnArchiveRecord): Promise<void> {
        await writeFileAtomic(this.filePath, JSON.stringify(record))
    }

    async listTurns(): Promise<TurnArchiveRecord[]> {
        const latest = await this.readLatest()
        return latest ? [latest] : []
    }

    async loadTurn(turnIndex: number): Promise<TurnArchiveRecord | null> {
        const latest = await this.readLatest()
        return latest?.turnIndex === turnIndex ? latest : null
    }

    async loadLatest(): Promise<TurnArchiveRecord | null> {
        return this.readLatest()
    }
}

/**
 * 内存 fake：reporter / handler 测试桩（turnSnapshotStore fake 同款定位）。
 * diff/统计逻辑不在这里——归档只存取，消费端自行计算。
 */
export function createInMemoryTurnArchiveStore(initial: TurnArchiveRecord[] = []): TurnArchiveStore & {
    /** 测试辅助：直接读当前记录（滚动单条下至多一条） */
    records(): TurnArchiveRecord[]
} {
    let latest: TurnArchiveRecord | null = initial.at(-1) ?? null
    if (latest) latest = structuredClone(latest)
    const copy = (r: TurnArchiveRecord): TurnArchiveRecord => structuredClone(r)
    return {
        async seal(record) {
            latest = copy(record)
        },
        async listTurns() {
            return latest ? [copy(latest)] : []
        },
        async loadTurn(turnIndex) {
            return latest?.turnIndex === turnIndex ? copy(latest) : null
        },
        async loadLatest() {
            return latest ? copy(latest) : null
        },
        records() {
            return latest ? [copy(latest)] : []
        },
    }
}
