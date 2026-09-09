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

import type { SnapshotBlock, SnapshotDeltaFrame } from '@mobi/shared'

/**
 * Snapshot delta 拼接器（.scratch/snapshot-delta spec 票 01）。
 *
 * 职责：接收 CLI 发来的 snapshot 帧（全量或增量），维护 per (sessionId, localId)
 * 全量快照缓存，apply 增量 op 后返回当前全量内容供 hub 下发 web。
 * hub→web 在票 01 仍下发全量（本模块即「重建后发全量」的重建端）；票 02 在此之上
 * 加 per 订阅游标转发 delta。
 *
 * 正确性模型（丢弃优于错乱）：
 * - 全量帧是绝对真相：整体替换缓存 + rev 重置
 * - 增量帧要求 baseRev 与缓存 rev 严格衔接；任何不衔接/违规 op → 删缓存返回 null，
 *   等待下一个全量基线（流首帧全量 / socket 重连重发全量保证全量必达）
 * - 链路无 diff：op 由 CLI 从流式 buffer 产出，本模块只 apply
 */

/** 缓存条目：全量 content 信封 + 当前 rev（null = legacy 无链全量） */
type CacheEntry = {
    content: unknown
    rev: number | null
    touchedAt: number
}

export class SnapshotDeltaAssembler {
    /** sessionId → localId → 条目。仅流式期间存在，full 落库/断开/TTL 清理 */
    private readonly cache = new Map<string, Map<string, CacheEntry>>()
    private readonly ttlMs: number
    private readonly now: () => number

    constructor(options?: { ttlMs?: number; now?: () => number }) {
        this.ttlMs = options?.ttlMs ?? 10 * 60_000
        this.now = options?.now ?? (() => Date.now())
    }

    /**
     * 全量帧入缓存。rev=null 为 legacy 全量（老 CLI 无链）：透传内容但缓存无链，
     * 后续 delta 因无链被拒（老 CLI 也不会发 delta，此为防御语义）。
     * 信封形状不可导航（防御）：不建缓存，原样透传返回（回退 legacy 直通路径）。
     * @returns 下发 web 的全量内容
     */
    applyFull(sessionId: string, localId: string | null, content: unknown, rev: number | null): unknown {
        this.sweep()

        if (localId === null || this.locateBlocks(content) === null) {
            return content
        }

        this.entryMap(sessionId).set(localId, { content, rev, touchedAt: this.now() })
        return content
    }

    /**
     * 增量帧 apply。baseRev 与缓存 rev 严格衔接且全部 op 合法 → 变异缓存并返回全量内容；
     * 否则删缓存返回 null（断档/无缓存/无链/违规，丢弃优于错乱）。
     * @returns 下发 web 的全量内容；null = 丢弃（不下发，等全量基线）
     */
    applyDelta(sessionId: string, frame: SnapshotDeltaFrame): unknown | null {
        this.sweep()

        const entryMap = this.cache.get(sessionId)
        const entry = frame.localId === null ? undefined : entryMap?.get(frame.localId)
        if (!entryMap || !entry || entry.rev === null || entry.rev !== frame.baseRev) {
            if (entryMap && frame.localId !== null) {
                entryMap.delete(frame.localId)
            }
            return null
        }

        const blocks = this.locateBlocks(entry.content)
        if (blocks === null || !this.applyOps(blocks, frame.deltas ?? [])) {
            if (frame.localId !== null) {
                entryMap.delete(frame.localId)
            }
            return null
        }

        entry.rev = frame.rev
        entry.touchedAt = this.now()
        return entry.content
    }

    /** full message 落库后按 localId 清理（终态已持久化，缓存无存在意义） */
    cleanupMessage(sessionId: string, localId: string | null): void {
        if (localId === null) return
        this.cache.get(sessionId)?.delete(localId)
    }

    /** CLI socket 断开时清整个会话的缓存（流已断，缓存必过期） */
    cleanupSession(sessionId: string): void {
        this.cache.delete(sessionId)
    }

    /**
     * 定位信封内的 blocks 数组：content.content.data.message.content。
     * CLI 发送的 snapshot 信封固定此形状（wrapAsDecryptedMessage → convertSnapshot）；
     * 任何环节形状漂移 → null（调用方按防御路径处理）。
     */
    private locateBlocks(content: unknown): SnapshotBlock[] | null {
        if (typeof content !== 'object' || content === null) return null
        const c = content as { content?: unknown }
        if (typeof c.content !== 'object' || c.content === null) return null
        const data = (c.content as { data?: unknown }).data
        if (typeof data !== 'object' || data === null) return null
        const message = (data as { message?: unknown }).message
        if (typeof message !== 'object' || message === null) return null
        const blocks = (message as { content?: unknown }).content
        return Array.isArray(blocks) ? (blocks as SnapshotBlock[]) : null
    }

    /**
     * 逐 op 应用。任何违规（index 越界、类型错配）整体失败（调用方删缓存）。
     * 直接在缓存 blocks 上变异：失败路径缓存即被删，变异无害；成功路径返回引用。
     */
    private applyOps(blocks: SnapshotBlock[], deltas: NonNullable<SnapshotDeltaFrame['deltas']>): boolean {
        for (const op of deltas) {
            if (op.op === 'append') {
                const block = blocks[op.index]
                if (!block || block.type === 'tool_use') return false
                if (block.type === 'text') {
                    block.text += op.text
                } else {
                    block.thinking += op.text
                }
                continue
            }
            if (op.op === 'new-block') {
                // 新块只能追加到末位（发送方按插入序对齐 index）
                if (op.index !== blocks.length) return false
                blocks.push(op.block)
                continue
            }
            // replace-block：仅替换已存在位置
            if (op.index >= blocks.length) return false
            blocks[op.index] = op.block
        }
        return true
    }

    /** 惰性清理超 TTL 条目（流式缓存生命周期兜底：full 丢失/断线残留） */
    private sweep(): void {
        const now = this.now()
        for (const [sid, entryMap] of this.cache) {
            for (const [localId, entry] of entryMap) {
                if (now - entry.touchedAt > this.ttlMs) {
                    entryMap.delete(localId)
                }
            }
            if (entryMap.size === 0) {
                this.cache.delete(sid)
            }
        }
    }

    private entryMap(sessionId: string): Map<string, CacheEntry> {
        let entryMap = this.cache.get(sessionId)
        if (!entryMap) {
            entryMap = new Map()
            this.cache.set(sessionId, entryMap)
        }
        return entryMap
    }
}
