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

import {
    applySnapshotBlockDeltas,
    buildSnapshotMessage,
    locateSnapshotBlocks,
    type SnapshotDeltaFrame,
} from '@mobi/shared'
import type { SyncEvent } from '@mobi/shared/types'

import { SnapshotDeltaStats } from './snapshotDeltaStats'

export type SnapshotPublication = Extract<
    SyncEvent,
    { type: 'message-snapshot' | 'message-snapshot-delta' }
>

export type SnapshotIngress =
    | {
        kind: 'full'
        sessionId: string
        localId: string | null
        content: unknown
        /** null 表示旧版 CLI 的无版本全量帧。 */
        rev: number | null
    }
    | {
        kind: 'delta'
        sessionId: string
        frame: SnapshotDeltaFrame
    }

export type SnapshotIngestResult =
    | { status: 'accepted'; publication: SnapshotPublication }
    | { status: 'ignored'; reason: 'stale-full' | 'missing-baseline' | 'revision-gap' | 'invalid-delta' }

export interface SnapshotSubscription {
    resolve(publication: SnapshotPublication): SnapshotPublication | null
    resync(sessionId: string): Array<Extract<SnapshotPublication, { type: 'message-snapshot' }>>
    close(): void
}

export interface SnapshotCliLease {
    disconnect(): void
}

type CacheEntry = {
    content: unknown
    rev: number
    touchedAt: number
}

type CursorEntry = {
    rev: number
    touchedAt: number
}

/**
 * Hub 内快照同步的状态 module。
 *
 * Socket adapter 在完成载荷校验和会话访问检查后调用 ingest；SSE adapter 在完成
 * namespace / session 过滤后调用订阅 handle。module 只决定快照内容，不执行网络发送。
 */
export class SnapshotSync {
    private readonly cache = new Map<string, Map<string, CacheEntry>>()
    /** 订阅 → 会话 → 流 的游标（按会话嵌套，per-session 清理一层 delete 即达） */
    private readonly cursors = new Map<string, Map<string, Map<string, CursorEntry>>>()
    private readonly cliOwners = new Map<string, symbol>()
    private readonly stats: SnapshotDeltaStats
    private readonly ttlMs: number
    private readonly cursorTtlMs: number
    private readonly now: () => number
    /** 扇出字节缓存：同一 publication 广播给 N 个订阅只测一次 */
    private readonly publicationBytes = new WeakMap<object, number>()
    /** sweep 节流时点：ingest/resolve 是流式热路径，全量扫描最多每 TTL/10 一次 */
    private lastSweepAt = Number.NEGATIVE_INFINITY

    constructor(options?: { stats?: SnapshotDeltaStats; ttlMs?: number; cursorTtlMs?: number; now?: () => number }) {
        this.stats = options?.stats ?? new SnapshotDeltaStats(false)
        this.ttlMs = options?.ttlMs ?? 10 * 60_000
        this.cursorTtlMs = options?.cursorTtlMs ?? this.ttlMs
        this.now = options?.now ?? Date.now
    }

    ingest(input: SnapshotIngress): SnapshotIngestResult {
        this.sweepExpiredCache()
        if (input.kind === 'full') {
            this.stats.record('cli-to-hub', 'full', input)
            const { sessionId, localId, content, rev } = input
            if (localId !== null && rev !== null && locateSnapshotBlocks(content) !== null) {
                const existing = this.cache.get(sessionId)?.get(localId)
                if (existing && rev < existing.rev) {
                    return { status: 'ignored', reason: 'stale-full' }
                }
                this.entryMap(sessionId).set(localId, { content, rev, touchedAt: this.now() })
            }
            return {
                status: 'accepted',
                publication: {
                    type: 'message-snapshot',
                    sessionId,
                    message: buildSnapshotMessage(localId, content, rev),
                },
            }
        }

        this.stats.record('cli-to-hub', 'delta', input.frame)
        const { sessionId, frame } = input
        const entries = this.cache.get(sessionId)
        const entry = entries?.get(frame.localId)
        if (!entry) {
            return { status: 'ignored', reason: 'missing-baseline' }
        }
        if (entry.rev !== frame.baseRev) {
            entries?.delete(frame.localId)
            return { status: 'ignored', reason: 'revision-gap' }
        }
        const blocks = locateSnapshotBlocks(entry.content)
        if (blocks === null || !applySnapshotBlockDeltas(blocks, frame.deltas)) {
            entries?.delete(frame.localId)
            return { status: 'ignored', reason: 'invalid-delta' }
        }
        entry.rev = frame.rev
        entry.touchedAt = this.now()
        return {
            status: 'accepted',
            publication: {
                type: 'message-snapshot-delta',
                sessionId,
                localId: frame.localId,
                rev: frame.rev,
                baseRev: frame.baseRev,
                deltas: frame.deltas,
            },
        }
    }

    attachCli(sessionId: string): SnapshotCliLease {
        const lease = Symbol(sessionId)
        this.cliOwners.set(sessionId, lease)
        return {
            disconnect: () => {
                if (this.cliOwners.get(sessionId) !== lease) return
                this.cliOwners.delete(sessionId)
                this.cache.delete(sessionId)
                for (const bySession of this.cursors.values()) {
                    bySession.delete(sessionId)
                }
            },
        }
    }

    /** 普通终态消息落库后的兼容清理；其 localId 可能不同于流式 snapshot 的 localId。
     *  终态即流死：与 endStream 同构清缓存和全部订阅游标——错过 stream-end 时的游标防泄漏路径。 */
    messagePersisted(sessionId: string, localId: string | null): void {
        if (localId === null) return
        this.endStream(sessionId, localId)
    }

    /** snapshot-stream-end 是流式生命周期的权威终态，同时清缓存和全部订阅游标。 */
    endStream(sessionId: string, localId: string): void {
        this.deleteCachedStream(sessionId, localId)
        for (const bySession of this.cursors.values()) {
            bySession.get(sessionId)?.delete(localId)
        }
    }

    attachSubscription(options: { id: string; wantsDelta: boolean }): SnapshotSubscription {
        const bySession = new Map<string, Map<string, CursorEntry>>()
        this.cursors.set(options.id, bySession)
        const isActive = () => this.cursors.get(options.id) === bySession
        return {
            resolve: (publication) => isActive()
                ? this.resolveForSubscription(publication, options.wantsDelta, bySession)
                : null,
            resync: (sessionId) => {
                if (!isActive()) return []
                this.sweepExpiredCache()
                // 只重建目标会话的游标：同订阅可能同时在跟其他会话的流，全清会误伤其衔接
                bySession.delete(sessionId)
                const entries = this.cache.get(sessionId)
                if (!entries) return []
                const baselines: Array<Extract<SnapshotPublication, { type: 'message-snapshot' }>> = []
                for (const [localId, entry] of entries) {
                    if (options.wantsDelta) {
                        this.sessionCursors(bySession, sessionId).set(localId, { rev: entry.rev, touchedAt: this.now() })
                    }
                    baselines.push(this.fullPublication(sessionId, localId, entry.content, entry.rev))
                }
                return baselines
            },
            close: () => {
                if (isActive()) {
                    this.cursors.delete(options.id)
                }
            },
        }
    }

    private resolveForSubscription(
        publication: SnapshotPublication,
        wantsDelta: boolean,
        bySession: Map<string, Map<string, CursorEntry>>,
    ): SnapshotPublication | null {
        this.sweepExpiredCache()
        if (publication.type === 'message-snapshot') {
            const localId = publication.message.localId
            const rev = publication.message.snapshotRev
            // 游标武装要求 hub 侧基线在场：legacy（rev 无值）与 shape-drift（信封不可导航、
            // 缓存未建）全量只透传内容，武装了也永远衔接不上，还钉死订阅等一个不存在的链
            if (wantsDelta && localId !== null && rev !== undefined
                && this.cache.get(publication.sessionId)?.get(localId) !== undefined) {
                this.sessionCursors(bySession, publication.sessionId).set(localId, { rev, touchedAt: this.now() })
            }
            this.recordToWeb('full', publication)
            return publication
        }

        const streams = bySession.get(publication.sessionId)
        const cursor = streams?.get(publication.localId)
        const cursorCurrent = cursor && this.now() - cursor.touchedAt <= this.cursorTtlMs
            ? cursor.rev
            : undefined
        if (streams && cursor && cursorCurrent === undefined) streams.delete(publication.localId)
        if (wantsDelta && cursorCurrent === publication.baseRev) {
            this.sessionCursors(bySession, publication.sessionId).set(publication.localId, { rev: publication.rev, touchedAt: this.now() })
            this.recordToWeb('delta', publication)
            return publication
        }

        const cached = this.cache.get(publication.sessionId)?.get(publication.localId)
        if (!cached) return null
        if (wantsDelta) {
            this.sessionCursors(bySession, publication.sessionId).set(publication.localId, { rev: cached.rev, touchedAt: this.now() })
        }
        return this.fullPublication(
            publication.sessionId,
            publication.localId,
            cached.content,
            cached.rev,
            publication.namespace,
        )
    }

    private entryMap(sessionId: string): Map<string, CacheEntry> {
        let entries = this.cache.get(sessionId)
        if (!entries) {
            entries = new Map()
            this.cache.set(sessionId, entries)
        }
        return entries
    }

    private deleteCachedStream(sessionId: string, localId: string): void {
        const entries = this.cache.get(sessionId)
        if (!entries) return
        entries.delete(localId)
        if (entries.size === 0) this.cache.delete(sessionId)
    }

    /** 构造全量基线事件并记 hub-to-web 全量观测（resync 与订阅兜底路径共用）。 */
    private fullPublication(
        sessionId: string,
        localId: string,
        content: unknown,
        rev: number,
        /** 订阅兜底路径透传入站 publication 的 namespace（投递元数据归投递层，module 不自行派生） */
        namespace?: string,
    ): Extract<SnapshotPublication, { type: 'message-snapshot' }> {
        const publication: Extract<SnapshotPublication, { type: 'message-snapshot' }> = {
            type: 'message-snapshot',
            sessionId,
            // 纯透传：入站未携带则连键都不出现——由测试锁定 module 不演化出「自行派生投递元数据」
            ...(namespace !== undefined && { namespace }),
            message: buildSnapshotMessage(localId, content, rev),
        }
        this.recordToWeb('full', publication)
        return publication
    }

    /** hub-to-web 观测：同一 publication 扇出给 N 个订阅时字节只测一次（对齐旧 broadcast 的 precomputedBytes 纪律）。 */
    private recordToWeb(kind: 'full' | 'delta', publication: object): void {
        let bytes = this.publicationBytes.get(publication)
        if (bytes === undefined) {
            bytes = this.stats.bytesOf(publication)
            this.publicationBytes.set(publication, bytes)
        }
        this.stats.record('hub-to-web', kind, publication, bytes)
    }

    /** 取订阅在某会话下的流游标表，缺则建。 */
    private sessionCursors(
        bySession: Map<string, Map<string, CursorEntry>>,
        sessionId: string,
    ): Map<string, CursorEntry> {
        let streams = bySession.get(sessionId)
        if (!streams) {
            streams = new Map()
            bySession.set(sessionId, streams)
        }
        return streams
    }

    private sweepExpiredCache(): void {
        const now = this.now()
        // 节流：ingest/resolve 是流式热路径，每帧 delta × N 订阅扇出都会触发，
        // 实际扫描最多每 TTL/10 一次（惰性清理语义不变，清理时点在 TTL/10 粒度内滑动）
        if (now - this.lastSweepAt < this.ttlMs / 10) return
        this.lastSweepAt = now
        for (const [sessionId, entries] of this.cache) {
            for (const [localId, entry] of entries) {
                if (now - entry.touchedAt > this.ttlMs) {
                    entries.delete(localId)
                    for (const bySession of this.cursors.values()) bySession.get(sessionId)?.delete(localId)
                }
            }
            if (entries.size === 0) this.cache.delete(sessionId)
        }
        // 游标也有 TTL 惰性清理：终态信号丢失（revision-gap 删缓存后流再无帧）时，
        // 孤儿游标不会再被 resolve 路径触达，不扫则随订阅生命周期无界滞留
        for (const bySession of this.cursors.values()) {
            for (const [sessionId, streams] of bySession) {
                for (const [localId, cursor] of streams) {
                    if (now - cursor.touchedAt > this.cursorTtlMs) streams.delete(localId)
                }
                if (streams.size === 0) bySession.delete(sessionId)
            }
        }
    }
}
