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
 * 会话治理登记簿（session-lifecycle-rewrite 票 1.2）：session-alive 心跳搭车的
 * 治理水位快照的 daemon 侧登记处。迭代二 SessionGovernor 据此做预算决策
 * （LRU 排序选逐出受害者、内存分级降 cap）。
 *
 * 设计边界：
 * - 纯内存、不落库——daemon 重启即丢，以进程存活探测兜底（心跳 2s 一拍，stale
 *   窗口 30s：错过 15 拍才视为离场）
 * - **不参与 dormancy gate 判定**（dormancy spec 裁决）：gate 只在会话进程本地求值，
 *   Registry 的 blockers 只是「此刻快照」供预算参考
 * - 消费方（Governor）尚未落地；本类只登记与查询，不做任何决策
 */

import type { SessionGovernanceSnapshot } from '@mobi/shared/types'
import { daemonLogger } from '../logger'

/** 心跳停止多久后视为离场（2s 一拍 × 15 拍容错） */
const STALE_AFTER_MS = 30_000

type RegistryEntry = SessionGovernanceSnapshot & {
    /** 本拍到达时刻（daemon 时钟；区别于快照内的 lastActivityAt——那是 session 侧活动时钟） */
    receivedAt: number
}

export class SessionRegistry {
    private readonly entries = new Map<string, RegistryEntry>()

    constructor(private readonly now: () => number = Date.now) {}

    /** 心跳快照登记（upsert）；顺带清扫 stale 条目 */
    upsert(sessionId: string, snapshot: SessionGovernanceSnapshot): void {
        this.evictStale()
        this.entries.set(sessionId, { ...snapshot, receivedAt: this.now() })
    }

    /** 会话终结时移除登记（session-end 到达即离场，不等 stale 窗口） */
    remove(sessionId: string): void {
        this.entries.delete(sessionId)
    }

    get(sessionId: string): SessionGovernanceSnapshot | null {
        const entry = this.entries.get(sessionId)
        if (!entry) return null
        if (this.now() - entry.receivedAt > STALE_AFTER_MS) {
            this.entries.delete(sessionId)
            return null
        }
        return entry
    }

    /** 全部存活条目（已剔除 stale）——Governor 的 LRU 排序数据面 */
    live(): Array<{ sessionId: string } & SessionGovernanceSnapshot> {
        this.evictStale()
        return Array.from(this.entries.entries()).map(([sessionId, entry]) => ({
            sessionId,
            state: entry.state,
            lastActivityAt: entry.lastActivityAt,
            gateBlockers: entry.gateBlockers,
            ...(entry.mode !== undefined && { mode: entry.mode }),
            ...(entry.rss !== undefined && { rss: entry.rss }),
        }))
    }

    private evictStale(): void {
        const now = this.now()
        for (const [sessionId, entry] of this.entries) {
            if (now - entry.receivedAt > STALE_AFTER_MS) {
                daemonLogger.debug(`[sessionRegistry] stale entry evicted: ${sessionId}`)
                this.entries.delete(sessionId)
            }
        }
    }
}
