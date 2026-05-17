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
import { isObject } from '@mobi/shared'
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
    replace: boolean = false,
): { runtimeState: Record<string, unknown> } | Record<string, never> {
    if (!patch) return {}
    if (replace) return { runtimeState: patch }
    const merged: Record<string, unknown> = { ...oldRuntime }
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) {
            delete merged[key]
        } else {
            merged[key] = value
        }
    }
    return { runtimeState: merged }
}

function hasSessionChanges(
    oldSession: Session | undefined,
    patch: Record<string, unknown>,
    runtimeStatePatch: Record<string, unknown> | null,
    runtimeStateReplace = false,
): boolean {
    if (!oldSession) return true
    for (const [key, value] of Object.entries(patch)) {
        if (oldSession[key as keyof Session] !== value) return true
    }
    if (runtimeStatePatch) {
        if (runtimeStateReplace) {
            // replace 模式：新旧 key 集合不同即为变化
            const oldRuntime = oldSession.runtimeState as Record<string, unknown> | null | undefined
            const oldKeys = oldRuntime ? Object.keys(oldRuntime) : []
            const newKeys = Object.keys(runtimeStatePatch)
            if (oldKeys.length !== newKeys.length) return true
            for (const key of oldKeys) {
                if (!(key in runtimeStatePatch)) return true
            }
        }
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
    let runtimeStateReplace = false

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
        // Hub runtimeState 完整更新（todos/tasks/teamState 等），直接替换
        if ('runtimeState' in delta && isObject(delta.runtimeState)) {
            runtimeStatePatch = delta.runtimeState as Record<string, unknown>
            runtimeStateReplace = true
        }
    }

    if (Object.keys(patch).length === 0 && !runtimeStatePatch) return

    // 更新单个会话详情缓存（仅当值实际变化时）
    queryClient.setQueryData<Session>(queryKeys.session(sessionId), (old) => {
        if (!old || !hasSessionChanges(old, patch, runtimeStatePatch, runtimeStateReplace)) return old
        return {
            ...old,
            ...patch,
            ...buildRuntimeStateUpdate(old.runtimeState, runtimeStatePatch, runtimeStateReplace),
        }
    })

    // 更新会话列表缓存中对应的 session（仅当值实际变化时）
    // groupSessions 缓存只存 sessionId，无需更新
    queryClient.setQueryData<Session[]>(queryKeys.sessions, (old) => {
        if (!old) return old
        const idx = old.findIndex(s => s.id === sessionId)
        if (idx === -1) return old
        const target = old[idx]
        if (!hasSessionChanges(target, patch, runtimeStatePatch, runtimeStateReplace)) return old
        const updated = [...old]
        updated[idx] = {
            ...target,
            ...patch,
            ...buildRuntimeStateUpdate(target.runtimeState, runtimeStatePatch, runtimeStateReplace),
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
    const navigateRef = useRef(navigate)
    navigateRef.current = navigate
    const notify = useNotify()
    const notifyRef = useRef(notify)
    notifyRef.current = notify
    const api = useMobiApi(token)
    const apiRef = useRef(api)
    apiRef.current = api
    const queryClientRef = useRef(queryClient)
    queryClientRef.current = queryClient
    const { notification } = App.useApp()
    const { t } = useTranslation()
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

    // 批处理失效：将失效请求合并到同一微任务中，减少重复 API 调用
    function scheduleInvalidation(scope: 'sessions' | 'machines', sessionId?: string) {
        const pending = pendingInvalidationsRef.current
        if (scope === 'sessions') {
            pending.sessions = true
            pending.sessionGroups = true
        } else {
            pending.machines = true
        }
        if (sessionId) {
            pending.sessionIds.add(sessionId)
        }

        if (invalidationTimerRef.current) return
        invalidationTimerRef.current = setTimeout(() => {
            invalidationTimerRef.current = null
            const p = pendingInvalidationsRef.current
            const qc = queryClientRef.current
            if (!p.sessions && !p.sessionGroups && !p.machines && p.sessionIds.size === 0) return

            const tasks: Array<Promise<unknown>> = []
            if (p.sessions) tasks.push(qc.invalidateQueries({ queryKey: queryKeys.sessions }))
            if (p.sessionGroups) {
                tasks.push(qc.invalidateQueries({ queryKey: queryKeys.sessionGroups }))
                tasks.push(qc.invalidateQueries({ queryKey: ['groupSessions'] }))
            }
            if (p.machines) tasks.push(qc.invalidateQueries({ queryKey: queryKeys.machines }))
            for (const sid of Array.from(p.sessionIds)) {
                tasks.push(qc.invalidateQueries({ queryKey: queryKeys.session(sid) }))
                tasks.push(qc.invalidateQueries({ queryKey: queryKeys.messages(sid) }))
            }

            p.sessions = false
            p.sessionGroups = false
            p.machines = false
            p.sessionIds.clear()
            if (tasks.length > 0) void Promise.all(tasks).catch(() => {})
        }, INVALIDATION_BATCH_MS)
    }

    // 所有依赖通过 ref 访问，确保回调引用稳定
    const handleSyncEvent = useCallback((event: SyncEvent) => {
        const qc = queryClientRef.current
        const nt = notifyRef.current

        switch (event.type) {
            case 'session-added':
                scheduleInvalidation('sessions')
                break
            case 'session-updated':
                patchSessionCache(qc, event.sessionId, event.data)
                break
            case 'session-removed':
                qc.removeQueries({ queryKey: queryKeys.session(event.sessionId) })
                qc.removeQueries({ queryKey: queryKeys.messages(event.sessionId) })
                scheduleInvalidation('sessions')
                break
            case 'message-received':
                if (event.message) {
                    upsertMessageCache(qc, event.sessionId, event.message as DecryptedMessage, { skipIfNotSnapshot: true })
                }
                break
            case 'message-snapshot':
                if (event.message && event.sessionId) {
                    upsertMessageCache(qc, event.sessionId, event.message as DecryptedMessage)
                }
                break
            case 'machine-updated':
                scheduleInvalidation('machines')
                break
            case 'heartbeat':
                break
            case 'connection-changed':
                if (event.data?.subscriptionId) {
                    subscriptionIdRef.current = event.data.subscriptionId
                    apiRef.current.visibility.report(
                        event.data.subscriptionId,
                        document.hidden ? 'hidden' : 'visible'
                    ).catch(() => {})
                }
                if (event.connected === false) {
                    subscriptionIdRef.current = null
                    nt.warning({
                        key: 'sse-disconnected',
                        message: tRef.current('notification.sseDisconnected'),
                        description: tRef.current('notification.sseDisconnectedDesc'),
                        duration: 0,
                    })
                }
                if (event.reconnected) {
                    nt.destroy('sse-disconnected')
                    nt.success({
                        message: tRef.current('notification.sseReconnected'),
                        description: tRef.current('notification.sseReconnectedDesc'),
                        duration: 5,
                    })
                    qc.invalidateQueries({ queryKey: queryKeys.sessions }).catch(() => {})
                    qc.invalidateQueries({ queryKey: ['messages'] }).catch(() => {})
                }
                break
            case 'toast':
                break
            case 'idle-timeout-warning':
                if (event.data?.remainingMs) {
                    const remainingMinutes = Math.ceil(event.data.remainingMs / 60000)
                    nt.warning({
                        key: `idle-timeout-${event.sessionId}`,
                        message: tRef.current('notification.idleTimeoutWarning'),
                        description: tRef.current('notification.idleTimeoutWarningDesc', { minutes: remainingMinutes }),
                        duration: 0,
                    })
                }
                break
        }
    }, [])

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
