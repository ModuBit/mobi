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

/**
 * 待展示的审批通知（SSE → 通知卡片的信箱）。
 *
 * 为什么经 store 中转而不是 SSEProvider 直接弹通知：
 * 通知里要渲染可操作的审批卡片（权限审批 / AskUserQuestion），而卡片由 `features/chat`
 * 的工具面板组件承载——core 层不许向上引 features。SSEProvider 只负责投递「哪条请求到了」，
 * 由 app 层挂载的 `ApprovalNotificationHost` 消费并渲染，装配权留在组装层。
 */
export type ApprovalNotificationItem = {
    /** antd notification key（每条独立，避免同类通知互相吞） */
    key: string
    sessionId: string
    /** 触发本次通知的审批请求 id；老 daemon / 非审批链路缺省时为 null，卡片回退到首条待审批 */
    requestId: string | null
    title: string
    body: string
    url: string
}

interface ApprovalNotificationState {
    items: ApprovalNotificationItem[]
    push: (item: ApprovalNotificationItem) => void
    remove: (key: string) => void
    clearAll: () => void
}

export const useApprovalNotificationStore = create<ApprovalNotificationState>((set) => ({
    items: [],

    push: (item) =>
        set((state) => (state.items.some((i) => i.key === item.key) ? state : { items: [...state.items, item] })),

    remove: (key) => set((state) => ({ items: state.items.filter((i) => i.key !== key) })),

    clearAll: () => set({ items: [] }),
}))
