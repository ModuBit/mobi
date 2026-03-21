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

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SSEClient } from '@/realtime/sseClient'
import { useAuthStore } from '@/stores/authStore'
import { useNavigate } from '@tanstack/react-router'
import type { SyncEvent } from '@mobi/shared'

/**
 * SSE 连接 Hook
 * 自动管理 SSE 连接生命周期，并在收到事件时更新 React Query 缓存
 */
export function useSSE() {
    const { token, logout } = useAuthStore()
    const queryClient = useQueryClient()
    const clientRef = useRef<SSEClient | null>(null)
    const navigate = useNavigate()

    useEffect(() => {
        if (!token) return

        const handleUnauthorized = () => {
            // 清除认证状态
            logout()
            // 跳转到登录页
            navigate({ to: '/login' })
        }

        const client = new SSEClient(
            () => {
                if (!token) return null
                // all=true 用于接收所有 session 相关事件（如 session-updated）
                return `${window.location.origin}/api/events?token=${token}&all=true`
            },
            handleUnauthorized
        )

        clientRef.current = client

        const unsubscribe = client.subscribe((event: SyncEvent) => {
            handleSyncEvent(event, queryClient)
        })

        client.connect()

        return () => {
            unsubscribe()
            client.disconnect()
        }
    }, [token, queryClient, logout, navigate])

    return clientRef.current
}

/**
 * 处理同步事件，更新 React Query 缓存
 */
function handleSyncEvent(event: SyncEvent, queryClient: ReturnType<typeof useQueryClient>) {
    switch (event.type) {
        case 'session-added':
        case 'session-updated':
        case 'session-removed':
            // 刷新会话列表（旧的）
            queryClient.invalidateQueries({ queryKey: ['sessions'] })
            // 刷新分组列表（activeCount 可能变化）
            queryClient.invalidateQueries({ queryKey: ['sessionGroups'] })
            // 刷新所有分组内的 sessions（使用通配符匹配）
            queryClient.invalidateQueries({ queryKey: ['groupSessions'] })
            // 刷新单个 session 详情
            if (event.type !== 'session-removed') {
                queryClient.invalidateQueries({ queryKey: ['session', event.sessionId] })
            }
            break
        case 'message-received':
            queryClient.invalidateQueries({ queryKey: ['messages', event.sessionId] })
            break
    }
}
