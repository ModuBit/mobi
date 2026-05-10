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
import type { InfiniteData } from '@tanstack/react-query'
import { SSEClient } from '@/core/data/realtime/sseClient'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useNavigate } from '@tanstack/react-router'
import { queryKeys } from '@/core/lib/query-keys'
import { useTranslation } from 'react-i18next'
import { useNotify } from '@/core/data/hooks/useNotify'
import { useMobiApi } from '@/core/data/api/client'
import { App, Button } from 'antd'
import type { Session, SyncEvent, DecryptedMessage } from '@mobi/shared'
import type { MessagesResponse } from '@/core/data/api/types'
import { resolveMessageCache } from '@/core/data/cache/messageCache'

/** 更新消息缓存：upsert 模式，新消息插入最新页（pages[0]） */
function upsertMessageCache(
    queryClient: ReturnType<typeof useQueryClient>,
    sessionId: string,
    msg: DecryptedMessage,
    options?: { skipIfNotSnapshot?: boolean },
) {
    queryClient.setQueryData<InfiniteData<MessagesResponse>>(
        queryKeys.messages(sessionId),
        (old) => {
            if (!old || old.pages.length === 0) {
                // 无缓存时不创建单页结构，让 useInfiniteQuery 挂载时自己获取完整数据
                // 避免创建 hasMore: false 的缓存导致用户看不到历史消息
                return undefined
            }

            const pages = old.pages.slice()
            const firstPage = pages[0]

            // 使用 resolveMessageCache 处理 snapshot 清理和消息合并
            const mergedMessages = resolveMessageCache(firstPage.messages, msg, options)

            pages[0] = {
                ...firstPage,
                messages: mergedMessages,
            }

            return { ...old, pages }
        },
    )
}

/**
 * 使用 setQueryData 直接更新 session 缓存
 * 避免因 session-updated 心跳事件触发不必要的 API 请求
 */
function buildRuntimeStateUpdate(
    oldRuntime: Record<string, unknown> | null | undefined,
    patch: Record<string, unknown> | null,
): { runtimeState: Record<string, unknown> } | Record<string, never> {
    if (!patch) return {}
    return { runtimeState: { ...oldRuntime, ...patch } }
}

function hasSessionChanges(
    oldSession: Session | undefined,
    patch: Record<string, unknown>,
    runtimeStatePatch: Record<string, unknown> | null,
): boolean {
    if (!oldSession) return true
    for (const [key, value] of Object.entries(patch)) {
        if (oldSession[key as keyof Session] !== value) return true
    }
    if (runtimeStatePatch) {
        const oldRuntime: Record<string, unknown> = { ...oldSession.runtimeState }
        for (const [key, value] of Object.entries(runtimeStatePatch)) {
            if (oldRuntime[key] !== value) return true
        }
    }
    return false
}

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
        for (const key of ['active', 'activeAt', 'running', 'runningAt', 'permissionMode', 'mode', 'metadata', 'agentState', 'agentStateVersion']) {
            if (key in delta) patch[key] = delta[key]
        }
        // model 和 effort 在心跳数据中是顶层字段，但属于 session.runtimeState
        if ('model' in delta) {
            runtimeStatePatch = { model: delta.model }
        }
        if ('effort' in delta) {
            runtimeStatePatch = { ...runtimeStatePatch, effort: delta.effort }
        }
    }

    if (Object.keys(patch).length === 0 && !runtimeStatePatch) return

    // 更新单个会话详情缓存（仅当值实际变化时）
    queryClient.setQueryData<Session>(queryKeys.session(sessionId), (old) => {
        if (!old || !hasSessionChanges(old, patch, runtimeStatePatch)) return old
        return {
            ...old,
            ...patch,
            ...buildRuntimeStateUpdate(old.runtimeState, runtimeStatePatch),
        }
    })

    // 更新会话列表缓存中对应的 session（仅当值实际变化时）
    // groupSessions 缓存只存 sessionId，无需更新
    queryClient.setQueryData<Session[]>(queryKeys.sessions, (old) => {
        if (!old) return old
        const idx = old.findIndex(s => s.id === sessionId)
        if (idx === -1) return old
        const target = old[idx]
        if (!hasSessionChanges(target, patch, runtimeStatePatch)) return old
        const updated = [...old]
        updated[idx] = {
            ...target,
            ...patch,
            ...buildRuntimeStateUpdate(target.runtimeState, runtimeStatePatch),
        }
        return updated
    })
}

// 查询失效批处理间隔（毫秒）
const INVALIDATION_BATCH_MS = 16

// 模块级变量：页面刷新后自动重置，路由切换时保持
// 用于控制通知权限检查只在本页面生命周期内执行一次
let notificationPermissionChecked = false

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
    const subscriptionIdRef = useRef<string | null>(null)
    const navigate = useNavigate()
    // 用 ref 持有 navigate，避免路由跳转触发 SSE 重连
    const navigateRef = useRef(navigate)
    navigateRef.current = navigate
    const notify = useNotify()
    const api = useMobiApi(token)
    const apiRef = useRef(api)
    apiRef.current = api
    const { notification } = App.useApp()
    const { t } = useTranslation()
    // 用 ref 持有 t，避免语言切换触发 SSE 重连
    const tRef = useRef(t)
    tRef.current = t

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
            tasks.push(queryClient.invalidateQueries({ queryKey: queryKeys.sessionGroups }))
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
                if (event.message) {
                    const msg = event.message as DecryptedMessage
                    upsertMessageCache(queryClient, event.sessionId, msg, { skipIfNotSnapshot: true })
                }
                break
            case 'message-snapshot':
                if (event.message && event.sessionId) {
                    const msg = event.message as DecryptedMessage
                    upsertMessageCache(queryClient, event.sessionId, msg)
                }
                break
            case 'machine-updated':
                queueMachinesInvalidation()
                break
            case 'heartbeat':
                // 心跳事件，无需处理
                break
            case 'connection-changed':
                // 从服务端初始事件中提取 subscriptionId（每次连接/重连都会收到）
                if (event.data?.subscriptionId) {
                    subscriptionIdRef.current = event.data.subscriptionId
                    // 收到新 subscriptionId 后立即上报当前可见性
                    apiRef.current.visibility.report(
                        event.data.subscriptionId,
                        document.hidden ? 'hidden' : 'visible'
                    ).catch(() => {})
                }
                if (event.connected === false) {
                    // 断连时服务端已 removeConnection，清除本地 subscriptionId
                    subscriptionIdRef.current = null
                    // SSE 断开 → 显示警告通知
                    notify.warning({
                        key: 'sse-disconnected',
                        message: tRef.current('notification.sseDisconnected'),
                        description: tRef.current('notification.sseDisconnectedDesc'),
                        duration: 0,
                    })
                }
                if (event.reconnected) {
                    // 关闭断连通知
                    notify.destroy('sse-disconnected')
                    // 重连成功 → 显示成功通知
                    notify.success({
                        message: tRef.current('notification.sseReconnected'),
                        description: tRef.current('notification.sseReconnectedDesc'),
                        duration: 5,
                    })
                    // 刷新所有消息缓存，补齐断线期间遗漏的消息
                    queryClient.invalidateQueries({ queryKey: queryKeys.sessions }).catch(() => {})
                    queryClient.invalidateQueries({ queryKey: ['messages'] }).catch(() => {})
                }
                break
            case 'toast':
                // Toast 通知，由外部处理
                break
            case 'idle-timeout-warning':
                // 空闲超时预警
                if (event.data?.remainingMs) {
                    const remainingMinutes = Math.ceil(event.data.remainingMs / 60000)
                    notify.warning({
                        key: `idle-timeout-${event.sessionId}`,
                        message: tRef.current('notification.idleTimeoutWarning'),
                        description: tRef.current('notification.idleTimeoutWarningDesc', { minutes: remainingMinutes }),
                        duration: 0,
                    })
                }
                break
        }
    }, [queryClient, queueSessionListInvalidation, queueSessionDetailInvalidation, queueMachinesInvalidation, notify])

    // 浏览器通知权限管理
    // 模块级变量控制：同一页面生命周期内只检查一次，刷新后重置
    useEffect(() => {
        if (!token) return
        if (!('Notification' in window)) return
        if (notificationPermissionChecked) return
        notificationPermissionChecked = true

        // 延迟 2 秒执行，避免干扰页面加载
        const timerId = setTimeout(() => {
            if (Notification.permission === 'default') {
                // 需要用户手势才能触发浏览器授权弹窗，使用带按钮的页面通知
                notification.info({
                    key: 'notification-permission-request',
                    title: tRef.current('notification.permissionRequest'),
                    description: tRef.current('notification.permissionRequestDesc'),
                    duration: 0,
                    actions: [
                        <Button
                            key="allow"
                            type="primary"
                            size="small"
                            onClick={() => {
                                Notification.requestPermission()
                                notification.destroy('notification-permission-request')
                            }}
                        >
                            {tRef.current('notification.permissionRequestBtn')}
                        </Button>
                    ],
                })
            } else if (Notification.permission === 'denied') {
                notification.info({
                    key: 'notification-permission-guide',
                    title: tRef.current('notification.permissionGuide'),
                    description: tRef.current('notification.permissionGuideDesc'),
                    duration: 10,
                })
            }
        }, 2000)

        return () => clearTimeout(timerId)
    }, [token, notification])

    useEffect(() => {
        if (!token) return

        const handleUnauthorized = () => {
            // 清除认证状态
            logout()
            // 跳转到登录页
            navigateRef.current({ to: '/login' })
        }

        const client = new SSEClient(
            () => {
                if (!token) return null
                // all=true 用于接收所有 session 相关事件（如 session-updated）
                // visibility 传递初始可见性状态
                const initialVisibility = document.hidden ? 'hidden' : 'visible'
                return `${window.location.origin}/api/events?token=${token}&all=true&visibility=${initialVisibility}`
            },
            handleUnauthorized
        )

        clientRef.current = client

        const unsubscribe = client.subscribe((event: SyncEvent) => {
            handleSyncEvent(event)
        })

        client.connect()

        // 页面可见性变化时上报 Hub（仅在状态实际变化时发送）
        let lastHidden = document.hidden
        const handleVisibilityChange = () => {
            const id = subscriptionIdRef.current
            if (!id) return
            if (document.hidden === lastHidden) return
            lastHidden = document.hidden
            apiRef.current.visibility.report(id, document.hidden ? 'hidden' : 'visible').catch(() => {})
        }
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange)
            unsubscribe()
            client.disconnect()
            // 清理 subscriptionId
            subscriptionIdRef.current = null
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
    }, [token, logout, handleSyncEvent])

    return <>{children}</>
}
