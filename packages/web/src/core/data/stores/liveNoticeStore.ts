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
import { getField, unwrapOutputMessage } from '@mobi/shared'

/**
 * 实时系统提示 store（per-session keyed，messageWindowStore 闸门单生产方、
 * LiveSystemNoticeBar 单消费方）。
 *
 * 02 票定稿（.scratch/system-informational-banner/issues/02）：informational warning
 * 是「实时事件通知」而非「会话内容」——只在 SSE 实时到达时经此 store 提示一次，
 * 纯内存单 slot（覆盖制），不落任何持久状态：刷新 = 消失（无论点没点 ✕），
 * ✕ = 清除 slot。历史回放路径（fetchLatest/fetchOlder/backfill 重播）不经过发布点，
 * 天然满足「刷新不再见」。
 */

/** 实时系统提示：横幅展示所需的最小投影 */
export interface LiveSystemNotice {
    /** 来源消息 id（追溯查库用） */
    id: string
    /** CC 原文（原样显示不翻译） */
    content: string
    /** 发布时刻（store 盖章） */
    createdAt: number
}

interface LiveNoticeState {
    noticeBySession: Map<string, LiveSystemNotice>
    /** 发布（同会话旧提示被覆盖——单 slot，最新一条胜出；createdAt 由 store 盖章） */
    publishLiveNotice: (sessionId: string, notice: { id: string; content: string }) => void
    /** ✕ 关闭：清除该会话 slot */
    dismissLiveNotice: (sessionId: string) => void
    /** 清除会话 slot（会话关闭清理） */
    clearSession: (sessionId: string) => void
}

export const useLiveNoticeStore = create<LiveNoticeState>((set) => ({
    noticeBySession: new Map(),

    publishLiveNotice: (sessionId, notice) =>
        set((state) => ({
            noticeBySession: new Map(state.noticeBySession).set(sessionId, { ...notice, createdAt: Date.now() }),
        })),

    dismissLiveNotice: (sessionId) =>
        set((state) => {
            if (!state.noticeBySession.has(sessionId)) return state
            const next = new Map(state.noticeBySession)
            next.delete(sessionId)
            return { noticeBySession: next }
        }),

    clearSession: (sessionId) =>
        set((state) => {
            if (!state.noticeBySession.has(sessionId)) return state
            const next = new Map(state.noticeBySession)
            next.delete(sessionId)
            return { noticeBySession: next }
        }),
}))

/** 指定会话的当前实时提示（无则 undefined——zustand Object.is 稳定） */
export function useLiveNotice(sessionId: string): LiveSystemNotice | undefined {
    return useLiveNoticeStore((state) => state.noticeBySession.get(sessionId))
}

// 非组件侧（messageWindowStore 闸门 / 测试）使用的命令式入口：走 getState 转发 store action

/** 发布实时提示（同会话旧提示被覆盖，createdAt 由 store 盖章） */
export function publishLiveNotice(sessionId: string, notice: { id: string; content: string }): void {
    useLiveNoticeStore.getState().publishLiveNotice(sessionId, notice)
}

/**
 * informational → 实时横幅的发布判据（02 票单点收口）：只放行「warning 且非阻断继续」
 * 的实时到达——info/notice/suggestion 完全静默，阻断继续型走流内回放渲染
 * （reducerTimeline.shouldRenderSystemNotice），都不经此通道。
 * 输入是 DecryptedMessage 层的 raw 形状（content: z.unknown()），经 unwrapOutputMessage
 * 收窄；与 normalizeAgent 的 informational 解析保持字段口径一致（level 原值比较、
 * prevent_continuation 下划线/驼峰经 getField）。
 * 调用点：messageWindowStore.ingestIncomingMessages（SSE 实时闸门；backfill 重播不调）。
 */
export function maybePublishLiveNotice(sessionId: string, message: { id: string; content: unknown }): void {
    const unwrapped = unwrapOutputMessage(message.content)
    if (!unwrapped || unwrapped.role !== 'agent') return
    const data = unwrapped.data
    if (data.type !== 'system' || data.subtype !== 'informational') return
    if (data.level !== 'warning') return
    if (getField(data, 'prevent_continuation') === true) return
    if (typeof data.content !== 'string' || data.content.length === 0) return
    publishLiveNotice(sessionId, { id: message.id, content: data.content })
}

/** 测试用：清空所有状态（vitest 隔离） */
export function _resetForTest(): void {
    useLiveNoticeStore.setState({ noticeBySession: new Map() })
}
