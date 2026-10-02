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

import type { Database } from 'bun:sqlite'

import { isObject } from '@mobi/shared'

import { findLatestBoundarySeq } from './messages'
import { casUpdateSessionMetadataBestEffort, getSession } from './sessions'

/**
 * 会话行 metadata 上的边界指针（fork/rewind 入口判据，fork-session spec §2）：
 * 最近一次边界消息（compact_boundary / context-cleared）的 seq。
 * 判定 `msg.seq <= contextBoundarySeq` = 边界之前（不可 fork / 不可 rewind），O(1)。
 *
 * 已知取舍：字段声明在 shared MetadataSchema（web 消费经 sessionCache 可达），但 hub 侧
 * sdkMetadata 刷新路径从缓存重建 metadata 写回时可能抹掉非 SDK 字段——因此本指针仍是
 * 「尽力而为 + 读侧自愈」：字段缺失/被抹时 resolve 惰性回填（向回扫最近一条边界行），
 * 下次消费自动补上。rewind 软删除行后指针也可能滞后，同走自愈。
 */
export const CONTEXT_BOUNDARY_SEQ_KEY = 'contextBoundarySeq'

/** 从会话 metadata 中读取边界指针；缺失或非法（非有限数）返回 null */
function readBoundarySeq(metadata: unknown): number | null {
    if (!isObject(metadata)) return null
    const value = metadata[CONTEXT_BOUNDARY_SEQ_KEY]
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 单调推进边界指针（写入时机：compact_boundary 落库、context-cleared 事件到达，
 * 两处均以「当前 MAX(seq)」调用——边界行刚落库后 MAX 恒含该行 seq，且兼容 resume
 * 重放去重路径下 msg.seq 落后于当前 MAX 的情况）。
 *
 * CAS/重试/尽力而为语义见 casUpdateSessionMetadataBestEffort。
 *
 * @returns 指针是否已 ≥ seq（含本就满足的单调幂等；会话不存在 / 放弃为 false）
 */
export function advanceContextBoundarySeq(db: Database, sessionId: string, seq: number): boolean {
    return casUpdateSessionMetadataBestEffort(db, sessionId, (stored) => {
        // 单调守卫：指针只前进不回退（重复推进 / 乱序到达天然幂等）
        const current = readBoundarySeq(stored.metadata)
        if (current !== null && current >= seq) return null
        return { [CONTEXT_BOUNDARY_SEQ_KEY]: seq }
    })
}

/**
 * 读侧访问器（fork / rewind 入口判据的消费方统一走此处）：
 * 字段已有 → 直接返回；缺失（存量会话 / 被其他写路径抹除）→ 惰性回填一次——
 * 向回扫最近一条未删边界行（findLatestBoundarySeq），无边界 = 0，并写回 metadata。
 * 写回失败（并发竞争放弃）不影响本次返回值，下次消费再回填。
 * 会话不存在返回 0（调用方按「全部消息在边界之后」处理即可）。
 */
export function resolveContextBoundarySeq(db: Database, sessionId: string): number {
    const stored = getSession(db, sessionId)
    if (!stored) return 0

    const existing = readBoundarySeq(stored.metadata)
    if (existing !== null) return existing

    const seq = findLatestBoundarySeq(db, sessionId)
    advanceContextBoundarySeq(db, sessionId, seq)
    return seq
}

/** 边界指针领域存储（Store 聚合的子 Store，见 hub 编码规范） */
export class ContextBoundaryStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    /** 单调推进边界指针（见 advanceContextBoundarySeq） */
    advance(sessionId: string, seq: number): boolean {
        return advanceContextBoundarySeq(this.db, sessionId, seq)
    }

    /** 读侧访问器：字段缺失时惰性回填（见 resolveContextBoundarySeq） */
    resolve(sessionId: string): number {
        return resolveContextBoundarySeq(this.db, sessionId)
    }
}
