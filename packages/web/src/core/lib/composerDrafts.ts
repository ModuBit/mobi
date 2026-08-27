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

import type { BlockFileRef, ComposerSegments, PendingQuoteRef } from '@/domain/chat/composerSegments'
import { QUOTE_MAX_COUNT } from '@/domain/chat/composerSegments'

const STORAGE_KEY = 'mobi:composer-drafts'
const MAX_DRAFTS = 50

/** 持久化的文件引用（files/images 双桶共用）：上传完成后从 FileAttachment 投影而来 */
export interface PersistedFileRef {
    id: string
    filename: string
    path: string
    mimeType: string
    size: number
}

/**
 * 草稿的持久化分段形态（P5）：与 ComposerSegments 同构，仅去掉 volatile 的 previewUrl。
 * 读写双侧 shape 校验；files/images/quotes 缺省按 [] 容错。
 */
export interface PersistedSegments {
    text: string
    files: PersistedFileRef[]
    images: PersistedFileRef[]
    quotes: PendingQuoteRef[]
}

type DraftsMap = Record<string, PersistedSegments>

// 内存缓存：避免每次读写都解析 sessionStorage，同 hapi 实现
let cache: DraftsMap | null = null

function safeParseJson(value: string): unknown {
    try {
        return JSON.parse(value) as unknown
    } catch {
        return null
    }
}

/** 校验单个文件引用项（新格式）；非法返回 null 由上层逐条剔除 */
function coerceFileRef(value: unknown): PersistedFileRef | null {
    if (!value || typeof value !== 'object') return null
    const o = value as Record<string, unknown>
    if (
        typeof o.id !== 'string' ||
        typeof o.filename !== 'string' ||
        typeof o.path !== 'string' ||
        typeof o.mimeType !== 'string' ||
        typeof o.size !== 'number'
    ) {
        return null
    }
    return { id: o.id, filename: o.filename, path: o.path, mimeType: o.mimeType, size: o.size }
}

/** 校验单条引用分段；非法返回 null 由上层逐条剔除 */
function coerceQuote(value: unknown): PendingQuoteRef | null {
    if (!value || typeof value !== 'object') return null
    const o = value as Record<string, unknown>
    if (typeof o.messageId !== 'string' || typeof o.excerpt !== 'string') return null
    if (o.role !== 'user' && o.role !== 'agent') return null
    return { messageId: o.messageId, role: o.role, excerpt: o.excerpt }
}

/** 旧版附件项（{id,name,path,size}）→ 文件引用投影：MIME 未持久化，容错空串（恢复侧由扩展名兜底重 derive） */
function legacyAttachmentToFileRef(value: unknown): PersistedFileRef | null {
    if (!value || typeof value !== 'object') return null
    const o = value as Record<string, unknown>
    if (
        typeof o.id !== 'string' ||
        typeof o.name !== 'string' ||
        typeof o.path !== 'string' ||
        typeof o.size !== 'number'
    ) {
        return null
    }
    return { id: o.id, filename: o.name, path: o.path, mimeType: '', size: o.size }
}

/**
 * 数组字段读取：缺省 / 非数组按 [] 容错；单项校验失败逐条剔除而非整单拒绝——
 * 草稿是可丢弃缓存，宁可降级保留正文，不因个别坏项丢掉用户输入。
 */
function coerceArray<T>(value: unknown, item: (v: unknown) => T | null): T[] {
    if (!Array.isArray(value)) return []
    return value.map(item).filter((v): v is T => v !== null)
}

/** 校验单个 draft 结构，非法返回 null。兼容两种存量格式：见下方分支注释 */
function coerceDraft(value: unknown): PersistedSegments | null {
    if (!value || typeof value !== 'object') return null
    const obj = value as Record<string, unknown>
    if (typeof obj.text !== 'string') return null

    // P5 分段格式（当前写入的唯一格式）：files/images/quotes 三桶齐备
    if (
        Array.isArray(obj.files) ||
        Array.isArray(obj.images) ||
        Array.isArray(obj.quotes)
    ) {
        return {
            text: obj.text,
            files: coerceArray(obj.files, coerceFileRef),
            images: coerceArray(obj.images, coerceFileRef),
            quotes: coerceArray(obj.quotes, coerceQuote),
        }
    }

    // 旧版草稿（P4 前）：{text, attachments: [{id,name,path,size}]} 单桶——视为全部文件，
    // images/quotes 补空数组；mimeType 缺失存空串，恢复侧经扩展名兜底还原分桶与 MIME
    if (Array.isArray(obj.attachments)) {
        return {
            text: obj.text,
            files: coerceArray(obj.attachments, legacyAttachmentToFileRef),
            images: [],
            quotes: [],
        }
    }

    return null
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

/**
 * ComposerSegments → 可持久化形态：
 * 剥离 volatile 的 previewUrl（blob URL 跨会话失效）、quote 截至上限（serialize 时同样截断，双保险）。
 */
function toPersisted(segments: ComposerSegments): PersistedSegments {
    const project = (f: BlockFileRef): PersistedFileRef =>
        ({ id: f.id, filename: f.filename, path: f.path, mimeType: f.mimeType, size: f.size })
    return {
        text: segments.text,
        files: segments.files.map(project),
        images: segments.images.map(project),
        quotes: segments.quotes.slice(0, QUOTE_MAX_COUNT),
    }
}

/** 分段空判定（删除草稿的条件）：text(trim 后) 与三个非文本桶全空 */
function isPersistedEmpty(persisted: PersistedSegments): boolean {
    return persisted.text.trim().length === 0
        && persisted.files.length === 0
        && persisted.images.length === 0
        && persisted.quotes.length === 0
}

/**
 * 读草稿：返回 ComposerSegments（PersistedSegments 结构子集，天然可赋值）；
 * 不存在的 session 返回 null。
 */
export function getDraft(sessionId: string): ComposerSegments | null {
    const drafts = hydrate()
    const draft = drafts[sessionId]
    if (draft) {
        // 读刷新 LRU 顺序（仅内存）：高频访问的老 session 不被优先淘汰
        delete drafts[sessionId]
        drafts[sessionId] = draft
    }
    return draft ?? null
}

export function saveDraft(sessionId: string, segments: ComposerSegments): void {
    if (!sessionId) return
    const persisted = toPersisted(segments)
    const next: DraftsMap = { ...hydrate() }
    if (isPersistedEmpty(persisted)) {
        delete next[sessionId]
    } else {
        // 先删再写，刷新 Object.keys() 顺序用于 LRU 淘汰
        delete next[sessionId]
        next[sessionId] = persisted
    }
    evict(next)
    persist(next)
}

/**
 * 仅更新草稿文本，保留该 session 既有的文件/图片/引用分段。
 * 供跨页草稿落入既有 session 时使用，避免用空分段覆盖既有内容。
 */
export function mergeDraftText(sessionId: string, text: string): void {
    if (!sessionId) return
    const existing = hydrate()[sessionId]
    const keptFiles = existing?.files ?? []
    const keptImages = existing?.images ?? []
    const keptQuotes = existing?.quotes ?? []
    const next: DraftsMap = { ...hydrate() }
    if (text.trim().length === 0 && keptFiles.length === 0 && keptImages.length === 0 && keptQuotes.length === 0) {
        delete next[sessionId]
    } else {
        delete next[sessionId]
        next[sessionId] = { text, files: keptFiles, images: keptImages, quotes: keptQuotes }
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
