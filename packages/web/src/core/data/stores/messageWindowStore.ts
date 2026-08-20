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

/**
 * Per-session 消息窗口 store（仿 hapi message-window-store）。
 *
 * 与其他 store 不同，这里不用 zustand——其他 store 是全局 singleton（一个连接、一个 auth 状态），
 * 而消息窗口是 per-session keyed 的：用户可能同时打开多个 session，各自维护独立的消息列表、
 * 滚动位置、分页游标。因此用模块级 Map<sessionId, State> + Set<sessionId, listeners> pub/sub
 * 手写 external store，配合 React useSyncExternalStore 消费。generation 字段用于异步竞态防护
 *（fetch in flight 时若窗口被 clear，旧响应自动失效）。
 */

import type { DecryptedMessage, MessageStatus } from '@/core/data/api/types'
import type { MobiApi } from '@/core/data/api/client'
import { resolveMessageCache } from '@/core/data/cache/messageCache'
import { mergeMessages } from '@/core/lib/messages'
import { markMessagesSubmitted as applyMarkSubmitted } from '@/core/lib/markMessagesSubmitted'

/** 贴底稳定大小（用户在底部看最新） */
export const VISIBLE_WINDOW = 400
/** 上滚看历史的容忍上限（2× VISIBLE_WINDOW，对齐 hapi 双阈值语义） */
export const EXPAND_WINDOW = 800

export interface MessageWindowState {
    sessionId: string
    messages: DecryptedMessage[]
    hasMore: boolean
    oldestSeq: number | null
    isLoading: boolean
    isLoadingMore: boolean
    messagesVersion: number
    /** 首页是否已成功拉取过一次（防多消费方 useMessages effect 重复触发 fetchLatest 致空会话循环） */
    hasFetchedLatest: boolean
}

export const EMPTY_STATE: MessageWindowState = {
    sessionId: 'unknown',
    messages: [],
    hasMore: false,
    oldestSeq: null,
    isLoading: false,
    isLoadingMore: false,
    messagesVersion: 0,
    hasFetchedLatest: false,
}

interface InternalState extends MessageWindowState {
    latestGeneration: number
    olderGeneration: number
}

function createState(sessionId: string): InternalState {
    return { ...EMPTY_STATE, sessionId, latestGeneration: 0, olderGeneration: 0 }
}

const states = new Map<string, InternalState>()
const listeners = new Map<string, Set<() => void>>()

/** 测试用：清空所有 store 状态（vitest 隔离） */
export function _resetForTest(): void {
    states.clear()
    listeners.clear()
}

function getState(sessionId: string): InternalState {
    const existing = states.get(sessionId)
    if (existing) return existing
    const created = createState(sessionId)
    states.set(sessionId, created)
    return created
}

function notify(sessionId: string): void {
    const subs = listeners.get(sessionId)
    if (!subs) return
    for (const l of subs) l()
}

function setState(sessionId: string, next: InternalState): void {
    states.set(sessionId, next)
    notify(sessionId)
}

function updateState(sessionId: string, updater: (prev: InternalState) => InternalState): void {
    const prev = getState(sessionId)
    const next = updater(prev)
    if (next !== prev) setState(sessionId, next)
}

/** 派生字段重算（messagesVersion 递增）。oldestSeq 由调用方按需传入——只在 fetchLatest/fetchOlder merge 后算，流式期不扫 */
function buildState(prev: InternalState, updates: Partial<MessageWindowState>): InternalState {
    const messages = updates.messages ?? prev.messages
    const messagesChanged = messages !== prev.messages
    // oldestSeq 不在每次 buildState 全扫（流式期每条 chunk O(n) 浪费）；
    // 仅 fetchLatest/fetchOlder merge 后显式传入 updates.oldestSeq，其余用 prev.oldestSeq
    const oldestSeq = updates.oldestSeq !== undefined ? updates.oldestSeq : prev.oldestSeq
    const next: InternalState = {
        ...prev,
        ...updates,
        messages,
        oldestSeq,
        messagesVersion: messagesChanged ? prev.messagesVersion + 1 : prev.messagesVersion,
    }
    // 无实质变化（messages + 派生字段均未变）→ 返回 prev 引用，让 updateState 的 no-op 守卫生效，避免无意义 notify
    if (next.messages === prev.messages
        && next.hasMore === prev.hasMore
        && next.isLoading === prev.isLoading
        && next.isLoadingMore === prev.isLoadingMore
        && next.oldestSeq === prev.oldestSeq
        && next.messagesVersion === prev.messagesVersion
        && next.hasFetchedLatest === prev.hasFetchedLatest) {
        return prev
    }
    return next
}

/** 求 messages 中最小 seq（仅 fetchLatest/fetchOlder 调用，流式期不触发） */
function computeOldestSeq(messages: DecryptedMessage[]): number | null {
    let oldest: number | null = null
    for (const m of messages) {
        if (typeof m.seq === 'number' && (oldest === null || m.seq < oldest)) oldest = m.seq
    }
    return oldest
}

export function getMessageWindowState(sessionId: string): MessageWindowState {
    return getState(sessionId)
}

export function subscribeMessageWindow(sessionId: string, listener: () => void): () => void {
    const subs = listeners.get(sessionId) ?? new Set()
    subs.add(listener)
    listeners.set(sessionId, subs)
    return () => {
        const cur = listeners.get(sessionId)
        if (!cur) return
        cur.delete(listener)
        if (cur.size === 0) listeners.delete(sessionId)
    }
}

export function clearMessageWindow(sessionId: string): void {
    const prev = getState(sessionId)
    setState(sessionId, {
        ...createState(sessionId),
        latestGeneration: prev.latestGeneration + 1,
        olderGeneration: prev.olderGeneration + 1,
    })
}

// 内部 helper（后续 task 用）
export const _internal = { getState, updateState, buildState }

// ──────────────────────────────────────────────────────────────
// 异步竞态防护 + 数据流入 action
// ──────────────────────────────────────────────────────────────

type AsyncKind = 'latest' | 'older'

function getGeneration(s: InternalState, kind: AsyncKind): number {
    return kind === 'latest' ? s.latestGeneration : s.olderGeneration
}
function setGeneration(s: InternalState, kind: AsyncKind, g: number): InternalState {
    return kind === 'latest' ? { ...s, latestGeneration: g } : { ...s, olderGeneration: g }
}
function beginAsyncGeneration(sessionId: string, kind: AsyncKind, updates: Partial<MessageWindowState>): number {
    let gen = 0
    _internal.updateState(sessionId, prev => {
        gen = getGeneration(prev, kind) + 1
        return setGeneration(_internal.buildState(prev, updates), kind, gen)
    })
    return gen
}
function isCurrentGeneration(sessionId: string, kind: AsyncKind, gen: number): boolean {
    return getGeneration(_internal.getState(sessionId), kind) === gen
}
function updateStateForGeneration(sessionId: string, kind: AsyncKind, gen: number, updater: (prev: InternalState) => InternalState): void {
    _internal.updateState(sessionId, prev => getGeneration(prev, kind) !== gen ? prev : updater(prev))
}

/**
 * 拉取首页消息（首次进入 / 重连补拉）。
 * generation 防竞态：await 前后校验当前 generation，过期请求丢弃。
 * merge 不覆盖——SSE 已到的消息不会被首页响应冲掉。
 */
export async function fetchLatestMessages(api: MobiApi, sessionId: string): Promise<void> {
    const prev = _internal.getState(sessionId)
    if (prev.isLoading) return
    // isLoading 语义 = 「首次加载且 store 无数据」。
    // 重连补拉（store 已有数据）静默 merge，不翻 isLoading —— 否则 ChatContainer 的
    // `if (messagesLoading) return <Spin>` 早返回会翻转，致 ComposerInfoPanel 反复 mount/unmount，
    // 其 useMessages 每次 mount 都触发 useEffect → fetchLatest → isLoading=true → 早返回 → 循环。
    const isEmpty = prev.messages.length === 0
    const gen = beginAsyncGeneration(sessionId, 'latest', { isLoading: isEmpty })
    try {
        const res = await api.messages.list(sessionId, { beforeSeq: undefined })
        if (!isCurrentGeneration(sessionId, 'latest', gen)) return
        updateStateForGeneration(sessionId, 'latest', gen, prev => {
            const merged = mergeMessages(prev.messages, res.data.messages)
            return _internal.buildState(prev, { messages: merged, hasMore: res.data.page.hasMore, isLoading: false, oldestSeq: computeOldestSeq(merged), hasFetchedLatest: true })
        })
    } catch (err) {
        // 静默吞错会让首次加载失败时用户看到空会话（ChatWelcome）无反馈——至少留日志便于诊断
        console.error('[messageWindowStore] fetchLatest failed', sessionId, err)
        if (!isCurrentGeneration(sessionId, 'latest', gen)) return
        // 失败也置 hasFetchedLatest=true 避免空会话循环（用户切走再切回 clear 重置后会重试）
        updateStateForGeneration(sessionId, 'latest', gen, prev => _internal.buildState(prev, { isLoading: false, hasFetchedLatest: true }))
    }
}

/**
 * 上滚加载历史。游标用 oldestSeq；merge 到 messages 头部。
 * generation 防竞态同 fetchLatest。
 */
export async function fetchOlderMessages(api: MobiApi, sessionId: string): Promise<void> {
    const prev = _internal.getState(sessionId)
    if (prev.isLoadingMore || !prev.hasMore || prev.oldestSeq === null) return
    const gen = beginAsyncGeneration(sessionId, 'older', { isLoadingMore: true })
    try {
        const res = await api.messages.list(sessionId, { beforeSeq: prev.oldestSeq })
        if (!isCurrentGeneration(sessionId, 'older', gen)) return
        updateStateForGeneration(sessionId, 'older', gen, p => {
            const merged = mergeMessages(res.data.messages, p.messages)
            return _internal.buildState(p, { messages: merged, hasMore: res.data.page.hasMore, isLoadingMore: false, oldestSeq: computeOldestSeq(merged) })
        })
    } catch (err) {
        console.error('[messageWindowStore] fetchOlder failed', sessionId, err)
        if (!isCurrentGeneration(sessionId, 'older', gen)) return
        updateStateForGeneration(sessionId, 'older', gen, p => _internal.buildState(p, { isLoadingMore: false }))
    }
}

/**
 * SSE 增量入库（message-received / message-snapshot）。
 * 用 resolveMessageCache 逐条 reduce，保留 snapshot→full 替换清理语义。
 * 不分路径、不 trim——窗口裁剪由上层 effect 负责。
 */
export function ingestIncomingMessages(sessionId: string, incoming: DecryptedMessage[], options?: { skipIfNotSnapshot?: boolean }): void {
    if (incoming.length === 0) return
    _internal.updateState(sessionId, prev => {
        let messages = prev.messages
        for (const m of incoming) {
            messages = resolveMessageCache(messages, m, options)
        }
        if (messages === prev.messages) return prev
        // oldestSeq：prev 无值（空 store 首次 SSE 早到）则算一次建立游标；
        // 流式期 prev.oldestSeq 已有，新消息 seq 递增不改变 min，沿用 prev.oldestSeq 避免每条 chunk O(n)
        const oldestSeq = prev.oldestSeq === null ? computeOldestSeq(messages) : prev.oldestSeq
        return _internal.buildState(prev, { messages, oldestSeq })
    })
}

/**
 * rewind 超时对账（M4）：重拉首页并以服务端为准**替换**窗口内容——
 * 与 fetchLatest 的 merge 语义不同，服务端已软删除的行（SSE 事件丢失时本地残留）
 * 会被移除；仅保留本地未提交的乐观行（sending/failed，服务端无对应行）。
 * 供超时兜底在解锁 sender 前收敛「界面 ↔ Hub DB」的失同步。
 */
export async function reconcileLatestMessages(api: MobiApi, sessionId: string): Promise<void> {
    const prev = _internal.getState(sessionId)
    if (prev.isLoading) return
    const gen = beginAsyncGeneration(sessionId, 'latest', {})
    try {
        const res = await api.messages.list(sessionId, { beforeSeq: undefined })
        if (!isCurrentGeneration(sessionId, 'latest', gen)) return
        updateStateForGeneration(sessionId, 'latest', gen, p => {
            // 服务端真相为主体；本地乐观行（未提交，服务端必然无行）merge 回来防丢输入
            const localPending = p.messages.filter(m => m.status === 'sending' || m.status === 'failed')
            const messages = mergeMessages(res.data.messages, localPending)
            return _internal.buildState(p, { messages, oldestSeq: computeOldestSeq(messages), isLoading: false, hasFetchedLatest: true })
        })
    } catch (err) {
        // 对账失败保持现状（超时兜底按原路径收尾），留日志诊断
        console.error('[messageWindowStore] reconcileLatest failed', sessionId, err)
        if (!isCurrentGeneration(sessionId, 'latest', gen)) return
        updateStateForGeneration(sessionId, 'latest', gen, p => _internal.buildState(p, { isLoading: false, hasFetchedLatest: true }))
    }
}

// ──────────────────────────────────────────────────────────────
// queued/optimistic actions
// ──────────────────────────────────────────────────────────────

/** 乐观发送（useSendMessage onMutate） */
export function appendOptimisticMessage(sessionId: string, message: DecryptedMessage): void {
    _internal.updateState(sessionId, prev => _internal.buildState(prev, { messages: [...prev.messages, message] }))
}

/** 取消排队（useCancelQueuedMessage onMutate）—— 按 localId 或 id 移除 */
export function removeOptimisticMessage(sessionId: string, localId: string): void {
    _internal.updateState(sessionId, prev => {
        const next = prev.messages.filter(m => m.localId !== localId && m.id !== localId)
        if (next.length === prev.messages.length) return prev
        return _internal.buildState(prev, { messages: next })
    })
}

/** SSE messages-submitted：queued 被 agent 消费，翻 submittedAt + queueState */
export function markMessagesSubmitted(sessionId: string, localIds: string[], submittedAt: number): void {
    if (localIds.length === 0) return
    _internal.updateState(sessionId, prev => {
        const next = applyMarkSubmitted(prev.messages, localIds, submittedAt)
        if (next === prev.messages) return prev
        return _internal.buildState(prev, { messages: next })
    })
}

/**
 * rewind 截断：清除窗口内 seq >= deleteFromSeq 的已加载行（与 Hub 软删除范围一致，spec §4.4）。
 * 无 seq 行（乐观/快照）保留——rewind 期间会话必为 idle，正常无在途行；
 * 清除后剩余不足视口时由 BubbleListChat 的 fill 级联自动 prepend 补足。
 * oldestSeq 不变（只删尾部，最小 seq 不动）。
 */
export function rewindFrom(sessionId: string, deleteFromSeq: number): void {
    _internal.updateState(sessionId, prev => {
        const next = prev.messages.filter(m => m.seq == null || m.seq < deleteFromSeq)
        if (next.length === prev.messages.length) return prev
        return _internal.buildState(prev, { messages: next })
    })
}

/** 发送状态机（sending/sent/failed） */
export function updateMessageStatus(sessionId: string, localId: string, status: MessageStatus): void {
    if (!localId) return
    _internal.updateState(sessionId, prev => {
        let changed = false
        const next = prev.messages.map(m => {
            if (m.localId !== localId || m.status === status) return m
            changed = true
            return { ...m, status }
        })
        if (!changed) return prev
        return _internal.buildState(prev, { messages: next })
    })
}
