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
 * 会话追踪补登（ticket-18，Q8）：daemon 同进程后，会话进程的生命周期事实不再
 * 只经 runner 的子进程 exit 事件到达——daemon 重启会清空追踪表，而活着的会话
 * 进程重连时没有任何事件把表补回来（唤醒去重因此漏判，盲 spawn 出第二个进程）。
 *
 * 本模块是补登/刷新决策的纯函数单源，数据面仍是 runner 的 `pidToTrackedSession`
 * Map（键 = pid）：
 * - **刷新**：表里已有该 sessionId 的表项 → 把查重键 `resumeSessionId` 对齐会话
 *   **当前** `metadata.nativeSessionId`（/clear、fork 换链后旧键失效，07 M 缺口）
 * - **补登**：表里没有 → 用 `hostPid` 建表项（非子进程，pid 死活靠
 *   {@link pruneDeadTrackedSessions} 轮询清理——与 webhook 外部会话同款机制）
 * - **pid 复用防护**：pid 已死或已被其他会话占用时不登（skip + 理由）
 */

import type { TrackedSession } from './types'

/** 补登信号来源 = 会话 socket 重连（session-alive）时的会话行 metadata 摘要 */
export interface SessionTrackingSignal {
    sessionId: string
    /** 会话宿主进程 pid（非 runner 子进程视角） */
    hostPid?: number | null
    /** 会话当前 native session id（查重键） */
    nativeSessionId?: string | null
    startedBy?: string | null
}

export type TrackingUpsert =
    | { op: 'refresh'; pid: number; resumeSessionId?: string }
    | { op: 'backfill'; entry: TrackedSession }
    | { op: 'skip'; reason: 'no-pid' | 'pid-dead' | 'pid-collision' }

/**
 * 把一条会话存活信号并入追踪表（就地修改）。刷新优先于补登：sessionId 命中
 * 既有表项时只对齐查重键，不重建（表项可能带 childProcess 等现场状态）。
 */
export function applySessionTrackingSignal(
    tracked: Map<number, TrackedSession>,
    signal: SessionTrackingSignal,
    isAlive: (pid: number) => boolean,
): TrackingUpsert {
    // 查重键归一：空串与 null 都视为「未提供」（退出查重）
    const resumeSessionId = signal.nativeSessionId || undefined

    for (const [pid, entry] of tracked.entries()) {
        if (entry.MobiSessionId === signal.sessionId) {
            entry.resumeSessionId = resumeSessionId
            return { op: 'refresh', pid, resumeSessionId }
        }
    }

    const pid = signal.hostPid
    if (typeof pid !== 'number' || !Number.isFinite(pid) || pid <= 0) {
        return { op: 'skip', reason: 'no-pid' }
    }
    if (!isAlive(pid)) {
        return { op: 'skip', reason: 'pid-dead' }
    }
    if (tracked.has(pid)) {
        return { op: 'skip', reason: 'pid-collision' }
    }

    const entry: TrackedSession = {
        // 补登表项不是 runner 子进程：stopSession 按外部会话分支 kill by pid，
        // 语义与 webhook 注册的外部会话一致
        startedBy: `backfill (${signal.startedBy ?? 'unknown'})`,
        MobiSessionId: signal.sessionId,
        pid,
        resumeSessionId,
    }
    tracked.set(pid, entry)
    return { op: 'backfill', entry }
}

/**
 * 清理死 pid 表项（就地修改）。子进程表项另有 exit 事件即时清理；本函数兜底
 * 非子进程（webhook 外部会话 / 补登）表项——runner 心跳周期调用（照用既有机制）。
 *
 * @returns 被清除的 pid 列表（供日志）
 */
export function pruneDeadTrackedSessions(
    tracked: Map<number, TrackedSession>,
    isAlive: (pid: number) => boolean,
): number[] {
    const pruned: number[] = []
    for (const [pid] of tracked.entries()) {
        if (!isAlive(pid)) {
            tracked.delete(pid)
            pruned.push(pid)
        }
    }
    return pruned
}

/**
 * 补登 glue（单源）：从会话行 metadata 摘取追踪信号交给 bridge。hubServer 注入
 * runner bridge 时与测试共用——两侧的「读哪几个字段、怎么归一」不会分叉。
 */
export function createSessionTrackingSync(
    getSession: (sid: string) => { metadata?: { hostPid?: number; nativeSessionId?: string | null; startedBy?: string | null } | null | undefined } | null | undefined,
    registerSessionTracking: (signal: SessionTrackingSignal) => void,
): (sid: string) => void {
    return (sid) => {
        const metadata = getSession(sid)?.metadata
        if (!metadata) return
        registerSessionTracking({
            sessionId: sid,
            hostPid: metadata.hostPid ?? null,
            nativeSessionId: metadata.nativeSessionId ?? null,
            startedBy: metadata.startedBy ?? null,
        })
    }
}
