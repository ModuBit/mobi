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

import { create } from 'zustand'
import { rewindFrom } from '@/core/data/stores/messageWindowStore'

/**
 * rewind 生命周期 store（per-session keyed，SSEProvider 写入、ChatContainer 消费）。
 *
 * 职责：承载两段回报（rewound-truncated → rewind-completed）的会话内状态机，
 * 供 ChatContainer 追加本地合成块（起点/终点）、驱动 isRewindInProgress 禁用 sender、
 * 30s 超时兜底解锁。对齐 backgroundTasksStore 的「SSE 层写、组件层读」模式。
 */

/** rewound-truncated SSE 载荷（hub 广播形状；shared SyncEventSchema 由 hub 线并行扩展，web 侧独立声明先行） */
export type RewoundTruncatedEvent = {
    type: 'rewound-truncated'
    sessionId: string
    deleteFromSeq: number
}

/** rewind-completed SSE 载荷（终态；filesRestored false 时 error 携带原因） */
export type RewindCompletedEvent = {
    type: 'rewind-completed'
    sessionId: string
    filesRestored: boolean
    error?: string
}

export type RewindSseEvent = RewoundTruncatedEvent | RewindCompletedEvent

/** rewind 进行中状态（beginRewind 创建，completeRewind 清除） */
export type RewindProgress = {
    /** rewind 目标锚点（用户消息 nativeId） */
    nativeId: string
    /** Web 确认 rewind 的时刻（POST 受理成功后） */
    startedAt: number
    /** rewound-truncated 到达时刻（null = 截断未回报）；30s 超时兜底自此起算 */
    truncatedAt: number | null
    /** 截断起始 seq（消息窗口清除范围，Task 14 消费） */
    deleteFromSeq: number | null
}

/** rewind 终态快照（保留供「已回退至此」分隔线与会话视图存续期渲染） */
export type RewindCompletion = {
    nativeId: string
    filesRestored: boolean
    error?: string
    completedAt: number
}

interface RewindState {
    progressBySession: Map<string, RewindProgress>
    completionBySession: Map<string, RewindCompletion>
    /** Web 确认 rewind（POST 受理成功）→ 进入进行中态（清掉旧终态） */
    beginRewind: (sessionId: string, nativeId: string) => void
    /** SSE rewound-truncated → 记录截断回报（30s 超时兜底自此起算） */
    markTruncated: (sessionId: string, deleteFromSeq: number) => void
    /** SSE rewind-completed / 超时兜底 → 终态（清除进行中态） */
    completeRewind: (sessionId: string, filesRestored: boolean, error?: string) => void
    /** 会话视图卸载清理 */
    clearSession: (sessionId: string) => void
}

export const useRewindStore = create<RewindState>((set) => ({
    progressBySession: new Map(),
    completionBySession: new Map(),

    beginRewind: (sessionId, nativeId) =>
        set((state) => ({
            progressBySession: new Map(state.progressBySession).set(sessionId, {
                nativeId,
                startedAt: Date.now(),
                truncatedAt: null,
                deleteFromSeq: null,
            }),
            // 新一轮 rewind 开始：旧终态分隔线让位
            completionBySession: (() => {
                const next = new Map(state.completionBySession)
                next.delete(sessionId)
                return next
            })(),
        })),

    markTruncated: (sessionId, deleteFromSeq) =>
        set((state) => {
            const prev = state.progressBySession.get(sessionId)
            if (!prev) return state
            const next = new Map(state.progressBySession)
            next.set(sessionId, { ...prev, truncatedAt: Date.now(), deleteFromSeq })
            return { progressBySession: next }
        }),

    completeRewind: (sessionId, filesRestored, error) =>
        set((state) => {
            const prev = state.progressBySession.get(sessionId)
            const nextProgress = new Map(state.progressBySession)
            nextProgress.delete(sessionId)
            const nextCompletion = new Map(state.completionBySession)
            nextCompletion.set(sessionId, {
                nativeId: prev?.nativeId ?? '',
                filesRestored,
                error,
                completedAt: Date.now(),
            })
            return { progressBySession: nextProgress, completionBySession: nextCompletion }
        }),

    clearSession: (sessionId) =>
        set((state) => {
            if (!state.progressBySession.has(sessionId) && !state.completionBySession.has(sessionId)) return state
            const nextProgress = new Map(state.progressBySession)
            nextProgress.delete(sessionId)
            const nextCompletion = new Map(state.completionBySession)
            nextCompletion.delete(sessionId)
            return { progressBySession: nextProgress, completionBySession: nextCompletion }
        }),
}))

/** 指定会话的 rewind 进行中状态（无则 undefined——zustand Object.is 稳定） */
export function useRewindProgress(sessionId: string): RewindProgress | undefined {
    return useRewindStore((state) => state.progressBySession.get(sessionId))
}

/** 指定会话的最近一次 rewind 终态（无则 undefined） */
export function useRewindCompletion(sessionId: string): RewindCompletion | undefined {
    return useRewindStore((state) => state.completionBySession.get(sessionId))
}

/**
 * 从未知 SSE 事件中解析 rewind 两段回报（SSEClient 只 JSON.parse 不做 zod 校验，
 * shared SyncEvent union 尚未收录这两个事件类型——按 type 字段判别，形状不符返回 null）。
 */
export function parseRewindSseEvent(event: unknown): RewindSseEvent | null {
    if (!event || typeof event !== 'object') return null
    const e = event as Record<string, unknown>
    if (e.type === 'rewound-truncated') {
        if (typeof e.sessionId === 'string' && e.sessionId.length > 0 && typeof e.deleteFromSeq === 'number') {
            return { type: 'rewound-truncated', sessionId: e.sessionId, deleteFromSeq: e.deleteFromSeq }
        }
        return null
    }
    if (e.type === 'rewind-completed') {
        if (typeof e.sessionId === 'string' && e.sessionId.length > 0 && typeof e.filesRestored === 'boolean') {
            return {
                type: 'rewind-completed',
                sessionId: e.sessionId,
                filesRestored: e.filesRestored,
                error: typeof e.error === 'string' && e.error.length > 0 ? e.error : undefined,
            }
        }
    }
    return null
}

/**
 * SSE rewind 两段回报接入（SSEProvider 在 handleSyncEvent 分发前调用）：
 * 识别并消费事件，返回 true 表示已消费（调用方跳过后续 switch）。
 * truncated 到达即清消息窗口（seq >= deleteFromSeq 的已加载行，与 Hub 软删除同范围）——
 * 无论会话视图是否挂载，窗口数据保持正确，切回时无需补拉。
 */
export function ingestRewindSseEvent(event: unknown): boolean {
    const parsed = parseRewindSseEvent(event)
    if (!parsed) return false
    const store = useRewindStore.getState()
    if (parsed.type === 'rewound-truncated') {
        store.markTruncated(parsed.sessionId, parsed.deleteFromSeq)
        rewindFrom(parsed.sessionId, parsed.deleteFromSeq)
    } else {
        store.completeRewind(parsed.sessionId, parsed.filesRestored, parsed.error)
    }
    return true
}
