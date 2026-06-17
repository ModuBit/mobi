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
import { App } from 'antd'
import { NotificationPermissionGate } from '@/components/NotificationPermissionGate'
import type { Session, SyncEvent, DecryptedMessage } from '@mobi/shared'
import { isObject } from '@mobi/shared'
import type { MessagesResponse } from '@/core/data/api/types'
import { resolveMessageCache } from '@/core/data/cache/messageCache'
import { decideToastAction, parseActiveSessionId, showSystemNotification } from '@/core/notifications'
import { useNotificationBadgeStore } from '@/core/data/stores/notificationBadgeStore'
import type { NotificationKind } from '@/core/data/stores/notificationBadgeStore'

// ── SSE 早到消息暂存缓冲区 ──────────────────────────────────
// 页面刷新时 SSE 事件可能先于 API 响应到达，此时缓存为空，事件会被丢弃。
// 暂存这些消息，等 API 响应填充缓存后自动合并，消除竞态丢消息的风险。

/** 暂存消息条目 */
type PendingMessage = {
    msg: DecryptedMessage
    options?: { skipIfNotSnapshot?: boolean }
}

/**
 * 消息暂存缓冲区
 * key: sessionId, value: 该 session 的暂存消息数组
 */
const pendingMessages = new Map<string, PendingMessage[]>()
const MAX_PENDING_PER_SESSION = 50

/** 暂存消息到缓冲区（缓存为空时调用） */
function stashPendingMessage(
    sessionId: string,
    msg: DecryptedMessage,
    options?: { skipIfNotSnapshot?: boolean },
) {
    let pending = pendingMessages.get(sessionId)
    if (!pending) {
        pending = []
        pendingMessages.set(sessionId, pending)
    }
    // 去重：同 id 消息原地更新
    const existingIdx = pending.findIndex(p => p.msg.id === msg.id)
    if (existingIdx !== -1) {
        if (options?.skipIfNotSnapshot && !pending[existingIdx].msg.snapshot) return
        pending[existingIdx] = { msg, options }
    } else {
        pending.push({ msg, options })
    }
    // 容量保护
    if (pending.length > MAX_PENDING_PER_SESSION) {
        pending.splice(0, pending.length - MAX_PENDING_PER_SESSION)
    }
}

/** 将暂存消息合并到已存在的缓存中 */
function flushPendingIntoCache(
    queryClient: ReturnType<typeof useQueryClient>,
    sessionId: string,
) {
    const pending = pendingMessages.get(sessionId)
    if (!pending || pending.length === 0) return

    // 先删除 Map 条目，避免 setQueryData 同步触发 queryCache subscribe 时
    // 检测到 pendingMessages.has(sid) 仍为 true 而排入冗余微任务
    pendingMessages.delete(sessionId)

    queryClient.setQueryData<InfiniteData<MessagesResponse>>(
        queryKeys.messages(sessionId),
        (old) => {
            if (!old || old.pages.length === 0) return old
            const pages = old.pages.slice()
            const firstPage = pages[0]
            let currentMessages = firstPage.messages
            for (const p of pending) {
                currentMessages = resolveMessageCache(currentMessages, p.msg, p.options)
            }
            pages[0] = { ...firstPage, messages: currentMessages }
            return { ...old, pages }
        },
    )
}
// ── 暂存缓冲区结束 ──────────────────────────────────────────

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
                // 缓存为空：暂存消息，等 API 响应后合并，而非直接丢弃
                stashPendingMessage(sessionId, msg, options)
                return undefined
            }

            const pages = old.pages.slice()
            const firstPage = pages[0]

            // 兜底：合并该 session 的暂存消息
            // 正常情况下由 queryCache subscribe 触发 flush，此处是防御性合并
            const pending = pendingMessages.get(sessionId)
            let currentMessages = firstPage.messages
            if (pending && pending.length > 0) {
                for (const p of pending) {
                    currentMessages = resolveMessageCache(currentMessages, p.msg, p.options)
                }
                pendingMessages.delete(sessionId)
            }

            // 使用 resolveMessageCache 处理 snapshot 清理和消息合并
            const mergedMessages = resolveMessageCache(currentMessages, msg, options)

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
    const notificationRef = useRef(notification)
    notificationRef.current = notification
    const markUnread = useNotificationBadgeStore((s) => s.markUnread)
    const markUnreadRef = useRef(markUnread)
    markUnreadRef.current = markUnread
    const clearAllBadges = useNotificationBadgeStore((s) => s.clearAll)
    const clearAllBadgesRef = useRef(clearAllBadges)
    clearAllBadgesRef.current = clearAllBadges
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
                pendingMessages.delete(event.sessionId)
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
                    // 静默恢复：仅关闭断开提示 + 刷新数据，不再弹"连接已恢复" toast
                    // 移动端后台→前台频繁触发重连，success 提示打扰用户且无信息价值；
                    // 真实断网仍由上方 connected===false 的 warning 提示
                    nt.destroy('sse-disconnected')
                    qc.invalidateQueries({ queryKey: queryKeys.sessions }).catch(() => {})
                    qc.invalidateQueries({ queryKey: ['messages'] }).catch(() => {})
                }
                break
            case 'toast': {
                if (!event.data) break
                const { kind, sessionId, title, body, url } = event.data
                const action = decideToastAction(sessionId, {
                    activeSessionId: parseActiveSessionId(window.location.pathname),
                    isHidden: document.hidden,
                })
                if (action === 'ignore') break

                if (action === 'system-notification') {
                    // 场景③ 后台:SW 系统通知（移动端不支持页面层 new Notification），
                    // 点击跳转由 sw.ts notificationclick 处理（读 data.url）；SW 不可用则降级 antd
                    void showSystemNotification({
                        title,
                        body,
                        icon: '/favicon.ico',
                        tag: `${kind}-${sessionId}`,
                        data: { url },
                    }).then((ok) => {
                        if (ok) return
                        notificationRef.current.info({
                            key: `${kind}-${sessionId}`,
                            message: title,
                            description: body,
                            duration: 6,
                            onClick: () => navigateRef.current({ to: url }),
                        })
                    })
                    markUnreadRef.current(sessionId, kind as NotificationKind)
                    break
                }

                // 场景② 前台但不在该 session:antd 页面 Toast(支持 onClick 跳转)+ 角标
                // 关键:用 notificationRef(antd 原生),不用 nt(useNotify 封装 dispatch 不透传 onClick)
                notificationRef.current.info({
                    key: `${kind}-${sessionId}`,
                    message: title,
                    description: body,
                    duration: 6,
                    onClick: () => navigateRef.current({ to: url }),
                })
                markUnreadRef.current(sessionId, kind as NotificationKind)
                break
            }
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

    // 登出(token 清空)时清理角标,避免换号残留上一用户的未读状态
    useEffect(() => {
        if (!token) clearAllBadgesRef.current()
    }, [token])

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

        // 订阅 queryCache 变化：API 响应填充缓存后，自动 flush 暂存的早到消息
        const unsubscribeCache = queryClient.getQueryCache().subscribe((event) => {
            if (event?.type !== 'updated') return
            const key = event.query.queryKey
            if (!Array.isArray(key) || key[0] !== 'messages') return
            const sid = key[1] as string
            if (!pendingMessages.has(sid)) return
            const data = event.query.state.data as InfiniteData<MessagesResponse> | undefined
            if (!data?.pages?.length) return
            // 延迟到微任务，确保 setQueryData 完成
            queueMicrotask(() => flushPendingIntoCache(queryClient, sid))
        })

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
            unsubscribeCache()
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
            // 清理暂存缓冲区
            pendingMessages.clear()
        }
    }, [token, logout, handleSyncEvent])

    return (
        <>
            {children}
            {token && <NotificationPermissionGate />}
        </>
    )
}
