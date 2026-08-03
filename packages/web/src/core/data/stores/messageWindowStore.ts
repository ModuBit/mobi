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

import type { DecryptedMessage } from '@mobi/shared'
import type { MobiApi } from '@/core/data/api/client'
import { resolveMessageCache } from '@/core/data/cache/messageCache'
import { mergeMessages } from '@/core/lib/messages'

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
}

export const EMPTY_STATE: MessageWindowState = {
    sessionId: 'unknown',
    messages: [],
    hasMore: false,
    oldestSeq: null,
    isLoading: false,
    isLoadingMore: false,
    messagesVersion: 0,
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

/** 派生字段重算（seq 边界 + messagesVersion 递增） */
function buildState(prev: InternalState, updates: Partial<MessageWindowState>): InternalState {
    const messages = updates.messages ?? prev.messages
    const messagesChanged = messages !== prev.messages
    let oldestSeq: number | null = null
    for (const m of messages) {
        if (typeof m.seq === 'number' && (oldestSeq === null || m.seq < oldestSeq)) oldestSeq = m.seq
    }
    return {
        ...prev,
        ...updates,
        messages,
        oldestSeq,
        messagesVersion: messagesChanged ? prev.messagesVersion + 1 : prev.messagesVersion,
    }
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
        return setGeneration(_internal.buildState(prev, updates) as InternalState, kind, gen)
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
    if (_internal.getState(sessionId).isLoading) return
    const gen = beginAsyncGeneration(sessionId, 'latest', { isLoading: true })
    try {
        const res = await api.messages.list(sessionId, { beforeSeq: undefined })
        if (!isCurrentGeneration(sessionId, 'latest', gen)) return
        updateStateForGeneration(sessionId, 'latest', gen, prev => {
            const merged = mergeMessages(prev.messages, res.data.messages)
            return _internal.buildState(prev, { messages: merged, hasMore: res.data.page.hasMore, isLoading: false }) as InternalState
        })
    } catch {
        if (!isCurrentGeneration(sessionId, 'latest', gen)) return
        updateStateForGeneration(sessionId, 'latest', gen, prev => _internal.buildState(prev, { isLoading: false }) as InternalState)
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
            return _internal.buildState(p, { messages: merged, hasMore: res.data.page.hasMore, isLoadingMore: false }) as InternalState
        })
    } catch {
        if (!isCurrentGeneration(sessionId, 'older', gen)) return
        updateStateForGeneration(sessionId, 'older', gen, p => _internal.buildState(p, { isLoadingMore: false }) as InternalState)
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
        return _internal.buildState(prev, { messages }) as InternalState
    })
}
