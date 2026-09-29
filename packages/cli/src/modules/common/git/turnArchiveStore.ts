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
 * turn 封口归档（审查 v3 票01）——turn 档的权威历史事实源。
 *
 * turnDiffReporter 在每个 turn 结束时把 turn 内累积的文件内容对封口写入归档；
 * 审查 turn 档（gitReview 六方法）与 turn 卡的 baseTurnIndex 都从这里读。
 * 与 ToolChangeJournal 的分工：journal 是「会话累计」（after 取末次的活文档），
 * 归档是「per-turn 冻结」（历史轮回看看到的是该轮当时的内容对，不受后续编辑影响）。
 *
 * 落盘：`.mobi/turn-diffs/<sessionId>/turn-archive.json`，`{ turns: [...] }` 数组按
 * turnIndex 升序，同 turnIndex 再封口 = 覆盖（重放/重试语义）；tmp + rename 原子写
 * （与 tool-changes.json 同纪律）；损坏文件按空归档起步（事实源宁可缺失不阻塞主流程）。
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sanitizeSessionId } from './gitTurnSnapshotStore'
import { writeFileAtomic } from './atomicWrite'

/** 封口的单文件内容对（journal 归并规则的同款形状：before 取首次、after 取末次） */
export type TurnArchiveFile = {
    path: string
    beforeContent: string | null
    afterContent: string | null
    writeCount: number
    toolNames: string[]
    /** 行数（封口时定稿：文本对任一非空 = 行多重集差，双空 = structuredPatch hunk 累加——
     *  消费端只读不算，保证「该轮当时」的统计不受消费端算法演进影响） */
    additions: number
    deletions: number
}

/** 一轮的封口记录 */
export type TurnArchiveRecord = {
    /** 会话内递增的轮次序号（journal 模式 = reporter 计数） */
    turnIndex: number
    /** 基线轮序号（无 = 首轮） */
    baseTurnIndex: number | null
    /** 封口时间戳（ms） */
    sealedAt: number
    files: TurnArchiveFile[]
}

/** 归档存储接口——调用方唯一可见的面 */
export interface TurnArchiveStore {
    /** 封口一轮（同 turnIndex 覆盖） */
    seal(record: TurnArchiveRecord): Promise<void>
    /** 全部归档，按 turnIndex 升序；无归档返回空数组 */
    listTurns(): Promise<TurnArchiveRecord[]>
    /** 按轮次序号读单轮；无该轮返回 null */
    loadTurn(turnIndex: number): Promise<TurnArchiveRecord | null>
}

/** 落盘路径：工作区 `.mobi/turn-diffs/<sessionId>/turn-archive.json`（与 tool-changes.json 同目录约定） */
export function getTurnArchivePath(workspaceRoot: string, sessionId: string): string {
    // 字符面单源 sanitizeSessionId（与快照 ref 子树/journal 目录同清洗）
    return join(workspaceRoot, '.mobi', 'turn-diffs', sanitizeSessionId(sessionId), 'turn-archive.json')
}

/** 落盘 wire 形状 */
type ArchiveFileShape = { turns: TurnArchiveRecord[] }

/** 逐条形状过滤（坏条目跳过不抛），与 ToolChangeJournal.restore 同容错纪律 */
function restoreRecords(raw: unknown): TurnArchiveRecord[] {
    const turns = (raw as ArchiveFileShape | null | undefined)?.turns
    if (!Array.isArray(turns)) return []
    const records: TurnArchiveRecord[] = []
    for (const t of turns) {
        if (!t || typeof t !== 'object') continue
        const r = t as Partial<TurnArchiveRecord>
        if (typeof r.turnIndex !== 'number' || !Number.isFinite(r.turnIndex) || !Array.isArray(r.files)) continue
        const files: TurnArchiveFile[] = []
        for (const f of r.files) {
            if (!f || typeof f !== 'object') continue
            const e = f as Partial<TurnArchiveFile>
            if (typeof e.path !== 'string' || e.path.length === 0) continue
            files.push({
                path: e.path,
                beforeContent: typeof e.beforeContent === 'string' ? e.beforeContent : null,
                afterContent: typeof e.afterContent === 'string' ? e.afterContent : null,
                writeCount: typeof e.writeCount === 'number' && Number.isFinite(e.writeCount) ? e.writeCount : 1,
                toolNames: Array.isArray(e.toolNames) ? e.toolNames.filter((n): n is string => typeof n === 'string') : [],
                additions: typeof e.additions === 'number' && Number.isFinite(e.additions) ? e.additions : 0,
                deletions: typeof e.deletions === 'number' && Number.isFinite(e.deletions) ? e.deletions : 0,
            })
        }
        records.push({
            turnIndex: r.turnIndex,
            baseTurnIndex: typeof r.baseTurnIndex === 'number' ? r.baseTurnIndex : null,
            sealedAt: typeof r.sealedAt === 'number' ? r.sealedAt : 0,
            files,
        })
    }
    return records.sort((a, b) => a.turnIndex - b.turnIndex)
}

/** 文件实现：seal 即读改写（归档频率 = 每 turn 一次，无需去抖） */
export class FileTurnArchiveStore implements TurnArchiveStore {
    constructor(private readonly filePath: string) {}

    private async readAll(): Promise<TurnArchiveRecord[]> {
        try {
            return restoreRecords(JSON.parse(await readFile(this.filePath, 'utf8')))
        } catch {
            return []
        }
    }

    async seal(record: TurnArchiveRecord): Promise<void> {
        const turns = (await this.readAll()).filter((t) => t.turnIndex !== record.turnIndex)
        turns.push(record)
        turns.sort((a, b) => a.turnIndex - b.turnIndex)
        await writeFileAtomic(this.filePath, JSON.stringify({ turns } satisfies ArchiveFileShape))
    }

    async listTurns(): Promise<TurnArchiveRecord[]> {
        return this.readAll()
    }

    async loadTurn(turnIndex: number): Promise<TurnArchiveRecord | null> {
        return (await this.readAll()).find((t) => t.turnIndex === turnIndex) ?? null
    }
}

/**
 * 内存 fake：reporter / handler 测试桩（turnSnapshotStore fake 同款定位）。
 * diff/统计逻辑不在这里——归档只存取，消费端自行计算。
 */
export function createInMemoryTurnArchiveStore(initial: TurnArchiveRecord[] = []): TurnArchiveStore & {
    /** 测试辅助：直接读当前全部记录 */
    records(): TurnArchiveRecord[]
} {
    const turns = initial.map((r) => ({ ...r, files: r.files.map((f) => ({ ...f })) }))
    return {
        async seal(record) {
            const idx = turns.findIndex((t) => t.turnIndex === record.turnIndex)
            const copy = { ...record, files: record.files.map((f) => ({ ...f })) }
            if (idx >= 0) turns[idx] = copy
            else turns.push(copy)
            turns.sort((a, b) => a.turnIndex - b.turnIndex)
        },
        async listTurns() {
            return turns.map((t) => ({ ...t, files: t.files.map((f) => ({ ...f })) }))
        },
        async loadTurn(turnIndex) {
            const found = turns.find((t) => t.turnIndex === turnIndex)
            return found ? { ...found, files: found.files.map((f) => ({ ...f })) } : null
        },
        records() {
            return turns
        },
    }
}
