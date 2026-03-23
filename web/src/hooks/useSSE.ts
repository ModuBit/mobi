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

import { useEffect, useRef, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SSEClient } from '@/realtime/sseClient'
import { useAuthStore } from '@/stores/authStore'
import { useNavigate } from '@tanstack/react-router'
import { queryKeys } from '@/lib/query-keys'
import type { SyncEvent } from '@mobi/shared'

// 查询失效批处理间隔（毫秒）
const INVALIDATION_BATCH_MS = 16

type PendingInvalidations = {
    sessions: boolean
    sessionGroups: boolean
    machines: boolean
    sessionIds: Set<string>
}

/**
 * SSE 连接 Hook
 * 自动管理 SSE 连接生命周期，并在收到事件时更新 React Query 缓存
 * 支持查询失效批处理以优化性能
 */
export function useSSE() {
    const { token, logout } = useAuthStore()
    const queryClient = useQueryClient()
    const clientRef = useRef<SSEClient | null>(null)
    const navigate = useNavigate()

    // 批处理失效相关 refs
    const invalidationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const pendingInvalidationsRef = useRef<PendingInvalidations>({
        sessions: false,
        sessionGroups: false,
        machines: false,
        sessionIds: new Set(),
    })

    // 执行批处理失效
    const flushInvalidations = useCallback(() => {
        const pending = pendingInvalidationsRef.current
        if (!pending.sessions && !pending.sessionGroups && !pending.machines && pending.sessionIds.size === 0) {
            return
        }

        const shouldInvalidateSessions = pending.sessions
        const shouldInvalidateSessionGroups = pending.sessionGroups
        const shouldInvalidateMachines = pending.machines
        const sessionIds = Array.from(pending.sessionIds)

        // 重置待处理状态
        pending.sessions = false
        pending.sessionGroups = false
        pending.machines = false
        pending.sessionIds.clear()

        // 执行失效操作
        const tasks: Array<Promise<unknown>> = []
        if (shouldInvalidateSessions) {
            tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.sessions }))
        }
        if (shouldInvalidateSessionGroups) {
            tasks.push(queryClient.invalidateQueries({ queryKey: ['sessionGroups'] }))
            tasks.push(queryClient.invalidateQueries({ queryKey: ['groupSessions'] }))
        }
        if (shouldInvalidateMachines) {
            tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.machines }))
        }
        for (const sessionId of sessionIds) {
            tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) }))
            tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.messages(sessionId) }))
        }

        if (tasks.length > 0) {
            void Promise.all(tasks).catch(() => { })
        }
    }, [queryClient])

    // 调度批处理失效
    const scheduleInvalidationFlush = useCallback(() => {
        if (invalidationTimerRef.current) {
            return
        }
        invalidationTimerRef.current = setTimeout(() => {
            invalidationTimerRef.current = null
            flushInvalidations()
        }, INVALIDATION_BATCH_MS)
    }, [flushInvalidations])

    // 添加会话列表到待失效队列
    const queueSessionListInvalidation = useCallback(() => {
        pendingInvalidationsRef.current.sessions = true
        pendingInvalidationsRef.current.sessionGroups = true
        scheduleInvalidationFlush()
    }, [scheduleInvalidationFlush])

    // 添加单个会话到待失效队列
    const queueSessionDetailInvalidation = useCallback((sessionId: string) => {
        pendingInvalidationsRef.current.sessionIds.add(sessionId)
        scheduleInvalidationFlush()
    }, [scheduleInvalidationFlush])

    // 添加机器列表到待失效队列
    const queueMachinesInvalidation = useCallback(() => {
        pendingInvalidationsRef.current.machines = true
        scheduleInvalidationFlush()
    }, [scheduleInvalidationFlush])

    // 处理同步事件
    const handleSyncEvent = useCallback((event: SyncEvent) => {
        switch (event.type) {
            case 'session-added':
            case 'session-updated':
                // 刷新会话列表和单个会话详情
                queueSessionListInvalidation()
                queueSessionDetailInvalidation(event.sessionId)
                break
            case 'session-removed':
                // 删除时移除缓存
                queryClient.removeQueries({ queryKey: queryKeys.session(event.sessionId) })
                queryClient.removeQueries({ queryKey: queryKeys.messages(event.sessionId) })
                queueSessionListInvalidation()
                break
            case 'message-received':
                // 只刷新消息，不刷新会话列表
                queueSessionDetailInvalidation(event.sessionId)
                break
            case 'machine-updated':
                queueMachinesInvalidation()
                break
            case 'heartbeat':
                // 心跳事件，无需处理
                break
            case 'connection-changed':
                // 连接状态变化，无需处理
                break
            case 'toast':
                // Toast 通知，由外部处理
                break
        }
    }, [queryClient, queueSessionListInvalidation, queueSessionDetailInvalidation, queueMachinesInvalidation])

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
            handleSyncEvent(event)
        })

        client.connect()

        return () => {
            unsubscribe()
            client.disconnect()
            // 清理批处理定时器
            if (invalidationTimerRef.current) {
                clearTimeout(invalidationTimerRef.current)
                invalidationTimerRef.current = null
            }
            // 重置待处理状态
            pendingInvalidationsRef.current = {
                sessions: false,
                sessionGroups: false,
                machines: false,
                sessionIds: new Set(),
            }
        }
    }, [token, logout, navigate, handleSyncEvent])

    return clientRef.current
}
