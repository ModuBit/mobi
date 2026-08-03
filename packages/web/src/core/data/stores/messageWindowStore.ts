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

import type { DecryptedMessage } from '@mobi/shared'

/** 贴底稳定大小（用户在底部看最新） */
export const VISIBLE_WINDOW = 400
/** 上滚看历史的容忍上限（对齐 hapi OLDER_LOAD_WINDOW_SIZE） */
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
function buildState(prev: InternalState, updates: Partial<InternalState>): InternalState {
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
    setState(sessionId, { ...createState(sessionId), latestGeneration: prev.latestGeneration + 1, olderGeneration: prev.olderGeneration + 1 })
}

// 内部 helper（后续 task 用）
export const _internal = { getState, updateState, buildState }
