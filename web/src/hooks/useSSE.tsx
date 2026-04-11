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

import { useEffect, useRef, useCallback, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { SSEClient } from '@/realtime/sseClient'
import { useAuthStore } from '@/stores/authStore'
import { useNavigate } from '@tanstack/react-router'
import { queryKeys } from '@/lib/query-keys'
import type { Session, SyncEvent } from '@mobi/shared'

/**
 * 使用 setQueryData 直接更新 session 缓存
 * 避免因 session-updated 心跳事件触发不必要的 API 请求
 */
function patchSessionCache(
    queryClient: ReturnType<typeof useQueryClient>,
    sessionId: string,
    data: unknown,
) {
    if (!data || typeof data !== 'object') return

    const delta = data as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    let runtimeStatePatch: Record<string, unknown> | null = null

    if ('id' in delta && delta.id === sessionId) {
        // 完整 session 对象（如 applySessionConfig 场景）
        Object.assign(patch, delta)
    } else {
        // 增量数据（心跳、状态变化等）
        for (const key of ['active', 'activeAt', 'thinking', 'thinkingAt', 'permissionMode']) {
            if (key in delta) patch[key] = delta[key]
        }
        // model 在心跳数据中是顶层字段，但属于 session.runtimeState
        if ('model' in delta) {
            runtimeStatePatch = { model: delta.model }
        }
    }

    if (Object.keys(patch).length === 0 && !runtimeStatePatch) return

    // 更新单个会话详情缓存
    queryClient.setQueryData<Session>(queryKeys.session(sessionId), (old) => {
        if (!old) return old
        return {
            ...old,
            ...patch,
            ...(runtimeStatePatch
                ? { runtimeState: { ...old.runtimeState, ...runtimeStatePatch } }
                : {}),
        }
    })

    // 更新会话列表缓存中对应的 session
    queryClient.setQueryData<Session[]>(queryKeys.sessions, (old) => {
        if (!old) return old
        const idx = old.findIndex(s => s.id === sessionId)
        if (idx === -1) return old
        const updated = [...old]
        updated[idx] = {
            ...updated[idx],
            ...patch,
            ...(runtimeStatePatch
                ? { runtimeState: { ...updated[idx].runtimeState, ...runtimeStatePatch } }
                : {}),
        }
        return updated
    })
}

// 查询失效批处理间隔（毫秒）
const INVALIDATION_BATCH_MS = 16

type PendingInvalidations = {
    sessions: boolean
    sessionGroups: boolean
    machines: boolean
    sessionIds: Set<string>
}

/**
 * SSE Provider：全局管理唯一的 SSE 连接
 * 负责连接生命周期、事件处理和缓存更新
 */
export function SSEProvider({ children }: { children: ReactNode }) {
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
                // 新会话加入，刷新列表（不需要刷新消息）
                queueSessionListInvalidation()
                break
            case 'session-updated':
                // 使用 setQueryData 直接更新缓存，避免心跳触发 API 请求
                patchSessionCache(queryClient, event.sessionId, event.data)
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

    return <>{children}</>
}
