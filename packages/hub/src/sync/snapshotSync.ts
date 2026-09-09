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
    resync(sessionId: string, namespace?: string): Array<Extract<SnapshotPublication, { type: 'message-snapshot' }>>
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
    private readonly cursors = new Map<string, Map<string, CursorEntry>>()
    private readonly cliOwners = new Map<string, symbol>()
    private readonly stats: SnapshotDeltaStats
    private readonly ttlMs: number
    private readonly cursorTtlMs: number
    private readonly now: () => number

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
        if (!entries || !entry) {
            return { status: 'ignored', reason: 'missing-baseline' }
        }
        if (entry.rev !== frame.baseRev) {
            entries.delete(frame.localId)
            return { status: 'ignored', reason: 'revision-gap' }
        }
        const blocks = locateSnapshotBlocks(entry.content)
        if (blocks === null || !applySnapshotBlockDeltas(blocks, frame.deltas)) {
            entries.delete(frame.localId)
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

    attachCli(sessionId: string, _socketId: string): SnapshotCliLease {
        const lease = Symbol(sessionId)
        this.cliOwners.set(sessionId, lease)
        return {
            disconnect: () => {
                if (this.cliOwners.get(sessionId) !== lease) return
                this.cliOwners.delete(sessionId)
                this.cache.delete(sessionId)
                const prefix = `${sessionId}\u0000`
                for (const cursorMap of this.cursors.values()) {
                    for (const key of cursorMap.keys()) {
                        if (key.startsWith(prefix)) cursorMap.delete(key)
                    }
                }
            },
        }
    }

    /** 普通终态消息落库后的兼容清理；其 localId 可能不同于流式 snapshot 的 localId。 */
    messagePersisted(sessionId: string, localId: string | null): void {
        if (localId === null) return
        this.deleteCachedStream(sessionId, localId)
    }

    /** snapshot-stream-end 是流式生命周期的权威终态，同时清缓存和全部订阅游标。 */
    endStream(sessionId: string, localId: string): void {
        this.deleteCachedStream(sessionId, localId)
        const key = this.streamKey(sessionId, localId)
        for (const cursorMap of this.cursors.values()) {
            cursorMap.delete(key)
        }
    }

    attachSubscription(options: { id: string; wantsDelta: boolean }): SnapshotSubscription {
        const cursorMap = new Map<string, CursorEntry>()
        this.cursors.set(options.id, cursorMap)
        const isActive = () => this.cursors.get(options.id) === cursorMap
        return {
            resolve: (publication) => isActive()
                ? this.resolveForSubscription(publication, options.wantsDelta, cursorMap)
                : null,
            resync: (sessionId, namespace) => {
                if (!isActive()) return []
                this.sweepExpiredCache()
                cursorMap.clear()
                const entries = this.cache.get(sessionId)
                if (!entries) return []
                const baselines: Array<Extract<SnapshotPublication, { type: 'message-snapshot' }>> = []
                for (const [localId, entry] of entries) {
                    if (options.wantsDelta) {
                        cursorMap.set(this.streamKey(sessionId, localId), { rev: entry.rev, touchedAt: this.now() })
                    }
                    const publication: Extract<SnapshotPublication, { type: 'message-snapshot' }> = {
                        type: 'message-snapshot',
                        sessionId,
                        namespace,
                        message: buildSnapshotMessage(localId, entry.content, entry.rev),
                    }
                    this.stats.record('hub-to-web', 'full', publication)
                    baselines.push(publication)
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
        cursorMap: Map<string, CursorEntry>,
    ): SnapshotPublication | null {
        this.sweepExpiredCache()
        if (publication.type === 'message-snapshot') {
            const localId = publication.message.localId
            const rev = publication.message.snapshotRev
            if (wantsDelta && localId !== null && rev !== undefined) {
                cursorMap.set(this.streamKey(publication.sessionId, localId), { rev, touchedAt: this.now() })
            }
            this.stats.record('hub-to-web', 'full', publication)
            return publication
        }

        const key = this.streamKey(publication.sessionId, publication.localId)
        const cursor = cursorMap.get(key)
        const cursorCurrent = cursor && this.now() - cursor.touchedAt <= this.cursorTtlMs
            ? cursor.rev
            : undefined
        if (cursor && cursorCurrent === undefined) cursorMap.delete(key)
        if (wantsDelta && cursorCurrent === publication.baseRev) {
            cursorMap.set(key, { rev: publication.rev, touchedAt: this.now() })
            this.stats.record('hub-to-web', 'delta', publication)
            return publication
        }

        const cached = this.cache.get(publication.sessionId)?.get(publication.localId)
        if (!cached) return null
        if (wantsDelta) {
            cursorMap.set(key, { rev: cached.rev, touchedAt: this.now() })
        }
        const full: SnapshotPublication = {
            type: 'message-snapshot',
            sessionId: publication.sessionId,
            namespace: publication.namespace,
            message: buildSnapshotMessage(publication.localId, cached.content, cached.rev),
        }
        this.stats.record('hub-to-web', 'full', full)
        return full
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

    private sweepExpiredCache(): void {
        const now = this.now()
        for (const [sessionId, entries] of this.cache) {
            for (const [localId, entry] of entries) {
                if (now - entry.touchedAt > this.ttlMs) {
                    entries.delete(localId)
                    const key = this.streamKey(sessionId, localId)
                    for (const cursorMap of this.cursors.values()) cursorMap.delete(key)
                }
            }
            if (entries.size === 0) this.cache.delete(sessionId)
        }
    }

    private streamKey(sessionId: string, localId: string): string {
        return `${sessionId}\u0000${localId}`
    }
}
