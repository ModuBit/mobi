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

import { hubLogger } from '../logger'

/** 传输段：CLI→hub（socket session-message）与 hub→web（SSE 下发） */
export type SnapshotStatsLeg = 'cli-to-hub' | 'hub-to-web'

export type SnapshotStatsCounters = {
    fullFrames: number
    fullBytes: number
    deltaFrames: number
    deltaBytes: number
}

const emptyCounters = (): SnapshotStatsCounters => ({ fullFrames: 0, fullBytes: 0, deltaFrames: 0, deltaBytes: 0 })

/**
 * snapshot delta 两段流量观测（.scratch/snapshot-delta 票 03）：
 * 按「段 × 全量/增量」累计帧数与序列化字节数，量化 delta 化收益、确认增量帧真实在传输。
 * 默认关闭（record 直接返回，不做任何序列化——观测本身不引入热路径开销），
 * MOBI_SNAPSHOT_STATS=1 开启后按间隔输出单行汇总日志。
 */
export class SnapshotDeltaStats {
    private readonly legs: Record<SnapshotStatsLeg, SnapshotStatsCounters> = {
        'cli-to-hub': emptyCounters(),
        'hub-to-web': emptyCounters(),
    }
    // -Infinity 起步：首次记录即输出基线（外部注入的时钟起点未知，不能假设从 0 计时）
    private lastLogAt = Number.NEGATIVE_INFINITY

    constructor(
        private readonly enabled: boolean,
        private readonly logIntervalMs = 30_000,
        private readonly log: (message: string) => void = (m) => { hubLogger.info(m) },
        private readonly now: () => number = Date.now,
    ) {}

    /** 记录一帧。字节数取 JSON 序列化长度（与实际传输 payload 一致的近似口径） */
    record(leg: SnapshotStatsLeg, kind: 'full' | 'delta', payload: unknown): void {
        if (!this.enabled) return
        const bytes = JSON.stringify(payload)?.length ?? 0
        const counters = this.legs[leg]
        if (kind === 'full') {
            counters.fullFrames += 1
            counters.fullBytes += bytes
        } else {
            counters.deltaFrames += 1
            counters.deltaBytes += bytes
        }
        const t = this.now()
        if (t - this.lastLogAt >= this.logIntervalMs) {
            this.lastLogAt = t
            this.log(this.summary())
        }
    }

    /** 程序化读取（测试 / 后续观测面板） */
    snapshot(): Record<SnapshotStatsLeg, SnapshotStatsCounters> {
        return {
            'cli-to-hub': { ...this.legs['cli-to-hub'] },
            'hub-to-web': { ...this.legs['hub-to-web'] },
        }
    }

    /** 单行汇总（hub 日志可读） */
    summary(): string {
        const fmt = (leg: SnapshotStatsLeg, label: string) => {
            const c = this.legs[leg]
            const avg = c.deltaFrames > 0 ? ` (均 ${Math.round(c.deltaBytes / c.deltaFrames)}B/帧)` : ''
            return `${label}: full ${c.fullFrames} 帧 / ${fmtBytes(c.fullBytes)}, delta ${c.deltaFrames} 帧 / ${fmtBytes(c.deltaBytes)}${avg}`
        }
        return `[snapshot-stats] ${fmt('cli-to-hub', 'cli→hub')}; ${fmt('hub-to-web', 'hub→web')}`
    }
}

function fmtBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${bytes}B`
}

/** 进程级实例：MOBI_SNAPSHOT_STATS=1 开启（E2E / 生产观测用） */
export const snapshotDeltaStats = new SnapshotDeltaStats(process.env.MOBI_SNAPSHOT_STATS === '1')
