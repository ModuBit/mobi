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

import { useCallback, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useMobiApi } from '@/core/data/api/client'
import { invalidateProjectViews } from '@/core/lib/invalidateProjectViews'

/**
 * fork 会话创建 Hook（fork-session spec §4.3 / §5.1）：
 * POST /api/sessions/:id/fork → 成功后失效项目维度视图缓存（新会话进侧栏各分组）
 * 并跳转新会话（导航与 useSessionActions 的 deleteSession 同层收口，容器组件只做编排）。
 * 失败 reject 原始错误（hub 响应体 code 供 forkRejectReasonKey 归因），由调用方 toast。
 */
export function useForkSession(sessionId: string): {
    /** 创建分叉会话；resolve 新会话 id（已跳转） */
    forkSession: (anchorNativeId: string) => Promise<string>
    isPending: boolean
} {
    const api = useMobiApi()
    const queryClient = useQueryClient()
    const navigate = useNavigate()

    const forkMutation = useMutation({
        mutationFn: async (anchorNativeId: string) => {
            const res = await api.sessions.fork(sessionId, anchorNativeId)
            return res.data.sessionId
        },
        onSuccess: async (newSessionId) => {
            // 会话增删改变侧栏各分组（projects/recent/pinned/projectSessions）成员，四键连带刷新
            await invalidateProjectViews(queryClient)
            await navigate({ to: '/sessions/$sessionId', params: { sessionId: newSessionId } })
        },
    })

    // 稳定引用（latest-ref）：调用方（ChatContainer.confirmFork）以其作 useMemo 依赖，
    // mutateAsync 每帧换引用会击穿消息列表的结构化共享 memo
    const mutateAsyncRef = useRef(forkMutation.mutateAsync)
    mutateAsyncRef.current = forkMutation.mutateAsync
    const forkSession = useCallback(
        (anchorNativeId: string) => mutateAsyncRef.current(anchorNativeId),
        [],
    )

    return {
        forkSession,
        isPending: forkMutation.isPending,
    }
}
