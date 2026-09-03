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
import { SSEClient } from '@/core/data/realtime/sseClient'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useNavigate } from '@tanstack/react-router'
import { queryKeys } from '@/core/lib/query-keys'
import { useTranslation } from 'react-i18next'
import { useNotify } from '@/core/data/hooks/useNotify'
import { useMobiApi } from '@/core/data/api/client'
import { App } from 'antd'
import { NotificationPermissionGate, resetPermissionPrompt } from '@/components/NotificationPermissionGate'
import { useNotificationStore } from '@/core/data/stores/notificationStore'
import type { Session, SyncEvent, DecryptedMessage, UserContentBlock } from '@mobi/shared'
import { isObject } from '@mobi/shared'
import { decideToastAction, parseActiveSessionId, showSystemNotification } from '@/core/notifications'
import { useNotificationBadgeStore } from '@/core/data/stores/notificationBadgeStore'
import { usePromptSuggestionStore, extractPromptSuggestion } from '@/core/data/stores/promptSuggestionStore'
import { clearAllSessionResources } from '@/core/lib/sessionResources'
import { derivePendingRequestsCount } from '@/core/lib/pendingRequests'
import { invalidateProjectViews } from '@/core/lib/invalidateProjectViews'
import {
    ingestIncomingMessages,
    markMessagesSubmitted as markSubmittedInStore,
    clearMessageWindow,
    fetchLatestMessages,
    withdrawFrom,
} from '@/core/data/stores/messageWindowStore'
import { ingestRewindSseEvent } from '@/core/data/stores/rewindStore'
import { requestComposerBackfill } from '@/core/data/stores/composerBackfillStore'
import { deserializeSegments, type ComposerSegments } from '@/domain/chat/composerSegments'

/**
 * blocks → composer 分段还原（撤回回填，spec §7.5）。
 * 信封内层 blocks 为 UserContentBlock[]；形状异常（旧 hub / 脏数据）→ null，
 * 消费方兜底 originalText 纯文本（与排队消息「编辑回填」同构）。
 */
function safeDeserializeSegments(blocks: unknown[]): ComposerSegments | null {
    if (!Array.isArray(blocks)) return null
    try {
        return deserializeSegments(blocks as UserContentBlock[])
    } catch {
        return null
    }
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
    queryClient.setQueryData<Session[]>(queryKeys.sessions, (old) => {
        if (!old) return old
        const idx = old.findIndex(s => s.id === sessionId)
        if (idx === -1) return old
        const target = old[idx]
        if (!hasSessionChanges(target, patch, runtimeStatePatch, runtimeStateReplace)) return old
        // 列表项是 SessionSummary 形状：无 agentState 字段，只有 pendingRequestsCount 计数。
        // 把 patch 里的 agentState 折算成 count 写回（并丢弃 agentState 本身，保持列表项形状干净）。
        const summaryPatch: Record<string, unknown> = { ...patch }
        let pendingRequestsCount: number | undefined
        if ('agentState' in summaryPatch) {
            pendingRequestsCount = derivePendingRequestsCount(summaryPatch.agentState)
            delete summaryPatch.agentState
        }
        const updatedItem: Session = {
            ...target,
            ...summaryPatch,
            ...buildRuntimeStateUpdate(target.runtimeState, runtimeStatePatch, runtimeStateReplace),
        }
        if (pendingRequestsCount !== undefined) {
            ;(updatedItem as Session & { pendingRequestsCount: number }).pendingRequestsCount = pendingRequestsCount
        }
        const updated = [...old]
        updated[idx] = updatedItem
        return updated
    })
}

// 查询失效批处理间隔（毫秒）
const INVALIDATION_BATCH_MS = 16

// toast 通知 key/tag 自增序号:同 session 连发同类通知时,每条用独立 key/tag,
// 避免 SW replaceNotification / antd 同 key 更新吞掉前一条(角标 markUnread 幂等,不受影响)
let toastSeq = 0

type PendingInvalidations = {
    sessions: boolean
    projectViews: boolean
    machines: boolean
    sessionIds: Set<string>
}

/**
 * SSE Provider：全局管理唯一的 SSE 连接
 * 负责连接生命周期、事件处理和缓存更新
 */
export function SSEProvider({ children }: { children: ReactNode }) {
    const { authenticated, logout } = useAuthStore()
    const queryClient = useQueryClient()
    const clientRef = useRef<SSEClient | null>(null)
    const subscriptionIdRef = useRef<string | null>(null)
    const navigate = useNavigate()
    const navigateRef = useRef(navigate)
    navigateRef.current = navigate
    const notify = useNotify()
    const notifyRef = useRef(notify)
    notifyRef.current = notify
    const api = useMobiApi()
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
    // 后台断线标记：connected=false 时置位；回前台时若仍置位则补一次对账。
    // 覆盖「reconnected 事件已在后台（throttled-but-alive 重连）被消费」的场景——
    // 该场景下回前台不会再触发 reconnected，标记是对账的唯一依据
    const hadGapRef = useRef(false)
    const pendingInvalidationsRef = useRef<PendingInvalidations>({
        sessions: false,
        projectViews: false,
        machines: false,
        sessionIds: new Set(),
    })

    // 批处理失效：将失效请求合并到同一微任务中，减少重复 API 调用。
    // - 'sessions'：全局会话列表
    // - 'projectViews'：项目维度视图（['projects'] / ['projectSessions'] / ['recentSessions']）。
    //   session 增删改会改变项目组与「最近」的 sessionIds 成员，必须一并刷新，
    //   否则新会话不出现 / 删除会话残留
    function scheduleInvalidation(scope: 'sessions' | 'machines' | 'projectViews', sessionId?: string) {
        const pending = pendingInvalidationsRef.current
        if (scope === 'sessions') {
            pending.sessions = true
        } else if (scope === 'machines') {
            pending.machines = true
        } else {
            pending.projectViews = true
        }
        if (sessionId) {
            pending.sessionIds.add(sessionId)
        }

        if (invalidationTimerRef.current) return
        invalidationTimerRef.current = setTimeout(() => {
            invalidationTimerRef.current = null
            const p = pendingInvalidationsRef.current
            const qc = queryClientRef.current
            if (!p.sessions && !p.projectViews && !p.machines && p.sessionIds.size === 0) return

            const tasks: Array<Promise<unknown>> = []
            if (p.sessions) tasks.push(qc.invalidateQueries({ queryKey: queryKeys.sessions }))
            // 项目维度视图三键（projects/recentSessions/projectSessions 根前缀）由 helper 统一收口
            if (p.projectViews) tasks.push(invalidateProjectViews(qc))
            if (p.machines) tasks.push(qc.invalidateQueries({ queryKey: queryKeys.machines }))
            for (const sid of Array.from(p.sessionIds)) {
                tasks.push(qc.invalidateQueries({ queryKey: queryKeys.session(sid) }))
            }

            p.sessions = false
            p.projectViews = false
            p.machines = false
            p.sessionIds.clear()
            if (tasks.length > 0) void Promise.all(tasks).catch(() => {})
        }, INVALIDATION_BATCH_MS)
    }

    /**
     * 断连后的状态对账：hub broadcast 不重放断连期间的事件，漏掉的变更须由 web 端补拉。
     * 各失效对象与缺口：
     * - sessions 列表 + projectViews：侧边栏/项目分组成员与计数变化
     * - 当前会话详情（['session', sid]）：agentState（等待授权/AskUserQuestion）与
     *   runtimeState（task/后台任务列表）的唯一来源——漏了它，断连期间发生的状态变化
     *   将永久陈旧，移动 PWA 下 refetchOnWindowFocus 不可作为确定性兜底
     * - 最新消息：fetchLatestMessages 静默 merge（invalidate 全量刷新有覆盖危险）
     */
    function resyncAfterGap() {
        const sid = parseActiveSessionId(window.location.pathname)
        // sid 为 null（不在会话页）时仍失效列表与项目视图——侧边栏状态也需对账
        scheduleInvalidation('sessions', sid ?? undefined)
        scheduleInvalidation('projectViews')
        if (sid && apiRef.current) void fetchLatestMessages(apiRef.current, sid)
    }

    // 所有依赖通过 ref 访问，确保回调引用稳定
    const handleSyncEvent = useCallback((event: SyncEvent) => {
        const qc = queryClientRef.current
        const nt = notifyRef.current

        // rewind 两段回报（rewound-truncated / rewind-completed）：shared SyncEventSchema
        // 由 hub 线并行扩展中，web 侧按 type 字段先行接入（SSEClient 只 JSON.parse 不做 zod
        // 校验，未知事件天然透传）；已消费则跳过后续 switch
        if (ingestRewindSseEvent(event)) return

        switch (event.type) {
            case 'session-added':
                scheduleInvalidation('sessions')
                // 新会话（游离进「最近」或归属项目）需要出现在对应分组视图
                scheduleInvalidation('projectViews')
                break
            case 'session-updated': {
                // 详情缓存尚未建立（如 spawn 后 CLI 首次心跳的 active:true 广播早于会话页
                // 首次 GET 往返抵达）时，patchSessionCache 的 updater 会因 old=undefined
                // 丢弃信号，且 staleTime 30s 内无任何重拉 → 新会话常驻「恢复会话」浮层。
                // 此场景转为 invalidate 标记 stale：进入页面 mount 时必 refetch（hub 广播
                // 发出时内存必已是新值，refetch 结果不会回退）；已有数据走正常 patch。
                if (qc.getQueryData(queryKeys.session(event.sessionId)) === undefined) {
                    qc.invalidateQueries({ queryKey: queryKeys.session(event.sessionId) })
                }
                patchSessionCache(qc, event.sessionId, event.data)
                // 只有改变分组成员资格的载荷才失效项目视图：
                // - 完整 session 载荷（delta.id === sessionId，如 setSessionProject 归属变更）
                // - 无 data 载荷（projectCache 删除项目后逐会话解绑广播）
                // 心跳/指标/重命名等轻载荷只需上方 patchSessionCache——活跃会话流式期间
                // 这类事件高频，若每次都失效 ['projects']+全部分组会造成 refetch 风暴（V2）
                const delta = event.data as Record<string, unknown> | undefined
                if (delta === undefined || ('id' in delta && delta.id === event.sessionId)) {
                    scheduleInvalidation('projectViews')
                }
                break
            }
            case 'sdk-metadata-refreshed':
                // hub 后台刷新 sdkMetadata 完成（内容有变）→ 失效本 session 的 metadata query，触发 refetch 拿新值
                qc.invalidateQueries({ queryKey: queryKeys.sdkMetadata(event.sessionId) })
                break
            case 'session-removed':
                qc.removeQueries({ queryKey: queryKeys.session(event.sessionId) })
                clearMessageWindow(event.sessionId)
                // 清理该 session 的瞬时建议, 避免删除会话后 bySession Map 残留
                usePromptSuggestionStore.getState().clearSession(event.sessionId)
                scheduleInvalidation('sessions')
                // 删除的会话需从项目组/「最近」分组视图中移除
                scheduleInvalidation('projectViews')
                break
            case 'message-received': {
                if (event.message) {
                    // 拦截 prompt_suggestion: 写入瞬时 store, 不进 React Query 消息缓存。
                    // prompt_suggestion 是「下一轮建议」的瞬时语义(非聊天历史), 刷新即丢失;
                    // Hub DB 侧已按 ephemeral 分类存储 + 历史查询过滤, Web 端这里不重复入缓存。
                    const suggestion = extractPromptSuggestion(event.message.content)
                    if (suggestion) {
                        usePromptSuggestionStore.getState().setSuggestion(event.sessionId, suggestion)
                        break
                    }
                    ingestIncomingMessages(event.sessionId, [event.message as DecryptedMessage], { skipIfNotSnapshot: true })
                }
                break
            }
            case 'message-snapshot': {
                if (event.message && event.sessionId) {
                    // 同 message-received: 若快照通道也携带 prompt_suggestion, 写入瞬时 store 不入缓存。
                    // 当前 SDK 不走此通道, 此处为防御, 避免未来 Hub 重放/SDK 变更时污染消息缓存。
                    const suggestion = extractPromptSuggestion(event.message.content)
                    if (suggestion) {
                        usePromptSuggestionStore.getState().setSuggestion(event.sessionId, suggestion)
                        break
                    }
                    ingestIncomingMessages(event.sessionId, [event.message as DecryptedMessage])
                }
                break
            }
            case 'messages-submitted':
                // 排队消息被 agent 真正消费：把命中 localId 的消息翻为 pushed（lifecycleAt = 事件 submittedAt）
                if (event.sessionId && event.localIds?.length) {
                    markSubmittedInStore(event.sessionId, event.localIds, event.submittedAt)
                }
                break
            case 'message-withdrawn': {
                // 空 sessionId 守卫（对齐 messages-submitted 兄弟分支）：schema 虽必填，
                // SSEClient 只 JSON.parse 不校验，防御空串写 store 垃圾键
                if (!event.sessionId) break
                // 撤回刚发消息（#53 / spec §7.5）：乐观移除与 hub 软删除（softDeleteMessagesFrom
                // 无上界）对齐。目标已在本地窗口 → 移除即一致状态，refetch 恒 no-op 不发起；
                // 未移除（另一端撤回 / 窗口外历史行）→ 本地无墓碑记录可依，refetch 兜底对账
                const removed = withdrawFrom(event.sessionId, event.localId)
                if (!removed) void fetchLatestMessages(apiRef.current, event.sessionId)
                // 回填请求落 store；会话未打开时 ChatContainer 不消费，回填自然跳过
                //（spec §7.5——composer 不在场，不覆盖用户输入）
                requestComposerBackfill(event.sessionId, {
                    localId: event.localId,
                    segments: safeDeserializeSegments(event.blocks),
                    originalText: event.originalText,
                })
                break
            }
            case 'machine-updated':
                scheduleInvalidation('machines')
                break
            case 'project-added':
            case 'project-updated':
                // 项目实体变更 → 重新拉取项目列表（数据量小，直接 invalidate）
                qc.invalidateQueries({ queryKey: queryKeys.projects })
                break
            case 'project-removed':
                // 名下会话已解绑进「最近」→ 与 session-* 共用 projectViews 批处理
                // （批量失效项目 + 两个分组视图）；session 级缓存由 hub 逐会话发的
                // session-updated 走 patchSessionCache，invalidateQueries 天然去重
                scheduleInvalidation('projectViews')
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
                    hadGapRef.current = true
                    nt.warning({
                        key: 'sse-disconnected',
                        message: tRef.current('notification.sseDisconnected'),
                        description: tRef.current('notification.sseDisconnectedDesc'),
                        duration: 0,
                    })
                }
                if (event.reconnected) {
                    // 静默恢复：仅关闭断开提示 + 对账补拉，不再弹"连接已恢复" toast
                    // 移动端后台→前台频繁触发重连，success 提示打扰用户且无信息价值；
                    // 真实断网仍由上方 connected===false 的 warning 提示
                    nt.destroy('sse-disconnected')
                    hadGapRef.current = false
                    resyncAfterGap()
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

                // 前台 Toast 用递增 key(每条都显示,避免 antd 同 key 互相吞);
                // 后台系统通知用固定 tag 聚合(见 system-notification 分支),避免堆积触发 Chrome 反垃圾
                const notifyKey = `${kind}-${sessionId}-${++toastSeq}`

                if (action === 'system-notification') {
                    // 场景③ 后台:SW 系统通知（移动端不支持页面层 new Notification），
                    // 点击跳转由 sw.ts notificationclick 处理（读 data.url）；SW 不可用则降级 antd。
                    // 聚合:固定 tag(按 kind+session)让同会话新通知替换旧的,通知中心只留一条而非堆积
                    // (Chrome 见堆积+低点击 → 判定垃圾内容);renotify=true 替换时再次提醒,避免静默漏看。
                    void showSystemNotification({
                        title,
                        body,
                        icon: '/brand/favicon.ico',
                        tag: `mobi-${kind}-${sessionId}`,
                        renotify: true,
                        data: { url },
                    }).then((ok) => {
                        if (ok) return
                        notificationRef.current.info({
                            key: notifyKey,
                            message: title,
                            description: body,
                            duration: 6,
                            onClick: () => navigateRef.current({ to: url }),
                        })
                    })
                    markUnreadRef.current(sessionId, kind)
                    break
                }

                // 场景② 前台但不在该 session:antd 页面 Toast(支持 onClick 跳转)+ 角标
                // 关键:用 notificationRef(antd 原生),不用 nt(useNotify 封装 dispatch 不透传 onClick)
                notificationRef.current.info({
                    key: notifyKey,
                    message: title,
                    description: body,
                    duration: 6,
                    onClick: () => navigateRef.current({ to: url }),
                })
                markUnreadRef.current(sessionId, kind)
                break
            }
            case 'idle-timeout-warning':
                if (event.data?.remainingMs) {
                    const remainingMinutes = Math.ceil(event.data.remainingMs / 60000)
                    const idleMsg = tRef.current('notification.idleTimeoutWarning')
                    const idleDesc = tRef.current('notification.idleTimeoutWarningDesc', { minutes: remainingMinutes })
                    // 页面 Toast 常驻(duration:0),前台用户已可见
                    nt.warning({
                        key: `idle-timeout-${event.sessionId}`,
                        message: idleMsg,
                        description: idleDesc,
                        duration: 0,
                    })
                    // 仅后台时额外发系统通知拉回用户;前台有常驻页面 Toast,弹系统通知纯打扰。
                    // tag 按 session 固定去重,避免堆积;renotify=true 替换时再次提醒,对齐 ready 路径。
                    // 系统通知只用于"需用户介入"的高价值事件。
                    if (document.hidden) {
                        void showSystemNotification({
                            title: idleMsg,
                            body: idleDesc,
                            icon: '/brand/favicon.ico',
                            tag: `idle-timeout-${event.sessionId}`,
                            renotify: true,
                            data: { url: `/sessions/${event.sessionId}` },
                        })
                    }
                }
                break
        }
    }, [])

    // 监听 SW 通知点击发来的 NAVIGATE 指令,用 SPA 路由跳转到目标 session。
    // 通知点击的窗口聚焦/openWindow 由 sw.ts 处理,但"已打开窗口内定位到 session"
    // 必须靠前端 router(SW 无法驱动 SPA 路由),故 SW postMessage 过来由这里执行。
    useEffect(() => {
        if (!authenticated) return
        if (!('serviceWorker' in navigator)) return
        const onMessage = (event: MessageEvent) => {
            const data = event.data as { type?: string; url?: string } | null
            if (data?.type === 'NAVIGATE' && typeof data.url === 'string') {
                navigateRef.current({ to: data.url })
            }
        }
        navigator.serviceWorker.addEventListener('message', onMessage)
        return () => navigator.serviceWorker.removeEventListener('message', onMessage)
    }, [authenticated])

    // 登出(authenticated 转 false)时清理角标 + 重置通知子系统,避免换号残留上一用户状态
    useEffect(() => {
        if (!authenticated) {
            clearAllBadgesRef.current()
            // 重置 permission/subscribed/error + 引导 flag:SPA 内 logout→login 不刷新页面,
            // 不重置则新用户继承上一用户状态/不再获得首次引导
            useNotificationStore.getState().reset()
            resetPermissionPrompt()
            // 清空所有会话的检视面板状态 + 缓存终端（顺带关闭后端 PTY），避免换号残留
            clearAllSessionResources()
        }
    }, [authenticated])

    useEffect(() => {
        if (!authenticated) return

        const handleUnauthorized = () => {
            // 清除认证状态
            logout()
            // 跳转到登录页
            navigateRef.current({ to: '/login' })
        }

        const client = new SSEClient(
            () => {
                if (!authenticated) return null
                // all=true 用于接收所有 session 相关事件（如 session-updated）
                // visibility 传递初始可见性状态；认证走 httpOnly cookie（SSEClient credentials: 'include'）
                const initialVisibility = document.hidden ? 'hidden' : 'visible'
                return `${window.location.origin}/api/events?all=true&visibility=${initialVisibility}`
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
            if (document.hidden === lastHidden) return
            const wasHidden = lastHidden
            lastHidden = document.hidden
            // 回前台:hidden→visible 时主动检查连接健康 + 断线对账。
            // 两者都不得依赖 subscriptionId——断线时它已被清空(null)，早退会让
            // 回前台重连检查被静默跳过（只剩 10s 看门狗兜底，真机恢复明显变慢）。
            if (wasHidden && !document.hidden) {
                clientRef.current?.reconnectIfStale()
                // 后台期间若发生过断线（reconnected 可能在后台已被消费），回前台无
                // reconnected 事件，凭 hadGap 标记补一次对账；无断线则跳过，避免桌面
                // alt-tab 切换触发请求风暴
                if (hadGapRef.current) {
                    hadGapRef.current = false
                    resyncAfterGap()
                }
            }
            const id = subscriptionIdRef.current
            if (!id) return
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
                projectViews: false,
                machines: false,
                sessionIds: new Set(),
            }
        }
    }, [authenticated, logout, handleSyncEvent])

    return (
        <>
            {children}
            {authenticated && <NotificationPermissionGate />}
        </>
    )
}
