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

import type { FileAttachment } from './fileAttachments'

const STORAGE_KEY = 'mobi:composer-drafts'
const MAX_DRAFTS = 50

/** 持久化的附件子集（File 不可序列化，只存展示与发送所需字段） */
export type PersistedAttachment = {
    id: string
    name: string
    path: string
    size: number
}

export type SessionDraft = {
    text: string
    attachments: PersistedAttachment[]
}

type DraftsMap = Record<string, SessionDraft>

// 内存缓存：避免每次读写都解析 sessionStorage，同 hapi 实现
let cache: DraftsMap | null = null

function safeParseJson(value: string): unknown {
    try {
        return JSON.parse(value) as unknown
    } catch {
        return null
    }
}

/** 校验单个 draft 结构，非法返回 null */
function coerceDraft(value: unknown): SessionDraft | null {
    if (!value || typeof value !== 'object') return null
    const obj = value as Record<string, unknown>
    if (typeof obj.text !== 'string') return null
    if (!Array.isArray(obj.attachments)) return null
    const attachments: PersistedAttachment[] = []
    for (const item of obj.attachments) {
        if (!item || typeof item !== 'object') return null
        const a = item as Record<string, unknown>
        if (
            typeof a.id !== 'string' ||
            typeof a.name !== 'string' ||
            typeof a.path !== 'string' ||
            typeof a.size !== 'number'
        ) {
            return null
        }
        attachments.push({ id: a.id, name: a.name, path: a.path, size: a.size })
    }
    return { text: obj.text, attachments }
}

function hydrate(): DraftsMap {
    if (cache) return cache
    if (typeof window === 'undefined') {
        cache = {}
        return cache
    }
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY)
        if (!raw) {
            cache = {}
            return cache
        }
        const parsed = safeParseJson(raw)
        if (!parsed || typeof parsed !== 'object') {
            cache = {}
            return cache
        }
        const result: DraftsMap = {}
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (!key) continue
            const draft = coerceDraft(value)
            if (draft) result[key] = draft
        }
        cache = result
        return result
    } catch {
        cache = {}
        return cache
    }
}

/** 超过上限时按插入顺序删除最早的 */
function evict(drafts: DraftsMap): void {
    const keys = Object.keys(drafts)
    if (keys.length <= MAX_DRAFTS) return
    const excess = keys.length - MAX_DRAFTS
    for (let i = 0; i < excess; i++) {
        delete drafts[keys[i]!]
    }
}

function persist(next: DraftsMap): void {
    if (typeof window === 'undefined') {
        cache = next
        return
    }
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        // 仅在持久化成功后提交内存 cache，避免 cache 被 evict/修改而 sessionStorage 未跟上的不一致
        cache = next
    } catch {
        // sessionStorage 写入失败（quota 等）：cache 保持上一次成功的状态，
        // 与当前 sessionStorage 一致；本次更新不持久化（降级，不崩溃）
    }
}

/** 仅保留可持久化的附件（complete 且有 path） */
function toPersisted(attachments: FileAttachment[]): PersistedAttachment[] {
    return attachments
        .filter(a => a.status === 'complete' && !!a.path)
        .map(a => ({
            id: a.id,
            // 顶层 name/size 优先（恢复态），回退 file（见 fileAttachments.ts 扩展）
            name: a.name ?? a.file.name,
            path: a.path!,
            size: a.size ?? a.file.size,
        }))
}

export function getDraft(sessionId: string): SessionDraft | null {
    const drafts = hydrate()
    const draft = drafts[sessionId]
    if (draft) {
        // 读刷新 LRU 顺序（仅内存）：高频访问的老 session 不被优先淘汰
        delete drafts[sessionId]
        drafts[sessionId] = draft
    }
    return draft ?? null
}

export function saveDraft(sessionId: string, text: string, attachments: FileAttachment[]): void {
    if (!sessionId) return
    const trimmed = text.trim()
    const persisted = toPersisted(attachments)
    const next: DraftsMap = { ...hydrate() }
    if (!trimmed && persisted.length === 0) {
        delete next[sessionId]
    } else {
        // 先删再写，刷新 Object.keys() 顺序用于 LRU 淘汰
        delete next[sessionId]
        next[sessionId] = { text, attachments: persisted }
    }
    evict(next)
    persist(next)
}

/**
 * 仅更新草稿文本，保留该 session 既有的附件草稿。
 * 供跨页草稿落入既有 session 时使用，避免用空附件覆盖。
 */
export function mergeDraftText(sessionId: string, text: string): void {
    if (!sessionId) return
    const trimmed = text.trim()
    const existing = hydrate()[sessionId]
    const keptAttachments = existing?.attachments ?? []
    const next: DraftsMap = { ...hydrate() }
    if (!trimmed && keptAttachments.length === 0) {
        delete next[sessionId]
    } else {
        delete next[sessionId]
        next[sessionId] = { text, attachments: keptAttachments }
    }
    evict(next)
    persist(next)
}

export function clearDraft(sessionId: string): void {
    if (!sessionId) return
    const next: DraftsMap = { ...hydrate() }
    delete next[sessionId]
    persist(next)
}

/**
 * 重置内存 cache（仅供测试）
 *
 * cache 是模块级单例，跨用例累积；测试需要从干净的 cache 开始时调用。
 */
export function __resetDraftCacheForTesting(): void {
    cache = null
}
