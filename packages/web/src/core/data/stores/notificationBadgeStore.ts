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

/** 通知种类 */
export type NotificationKind = 'ready' | 'permission'

/** 单个 session 的未读状态 */
export interface SessionBadge {
    ready: boolean
    permission: boolean
}

interface NotificationBadgeState {
    badges: Map<string, SessionBadge>
    /** 标记某 session 的某类未读 */
    markUnread: (sessionId: string, kind: NotificationKind) => void
    /** 清零指定 session 的角标 */
    clearBadge: (sessionId: string) => void
    /** 清空全部（登出时） */
    clearAll: () => void
    /** 查询某 session 是否有未读 */
    hasUnread: (sessionId: string) => boolean
    /** 获取某 session 的角标对象（无则返回全 false） */
    getBadge: (sessionId: string) => SessionBadge
}

// 空对象常量，避免每次 getBadge 返回新引用导致 React 无谓渲染
const EMPTY_BADGE: SessionBadge = { ready: false, permission: false }

export const useNotificationBadgeStore = create<NotificationBadgeState>((set, get) => ({
    badges: new Map(),

    markUnread: (sessionId, kind) =>
        set((state) => {
            const next = new Map(state.badges)
            const prev = next.get(sessionId) ?? { ...EMPTY_BADGE }
            next.set(sessionId, { ...prev, [kind]: true })
            return { badges: next }
        }),

    clearBadge: (sessionId) =>
        set((state) => {
            const next = new Map(state.badges)
            next.delete(sessionId)
            return { badges: next }
        }),

    clearAll: () => set({ badges: new Map() }),

    hasUnread: (sessionId) => {
        const b = get().badges.get(sessionId)
        return Boolean(b && (b.ready || b.permission))
    },

    getBadge: (sessionId) => get().badges.get(sessionId) ?? EMPTY_BADGE,
}))
