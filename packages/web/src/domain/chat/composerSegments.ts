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

import type { UserContentBlock } from '@mobi/shared'
import { QUOTE_EXCERPT_MAX } from '@mobi/shared'

/**
 * Composer 分段模型：输入框 text + 附件双桶 + 引用，用户消息的 UI 侧权威形态。
 *
 * ChatComposer 持有此形态，发送前经 serializeSegments 转为 UserContentBlock[]
 * 直传 hub（{content: blocks} 新格式），删除旧的「@path 文本拼接」通道；
 * 编辑/回填方向经 deserializeSegments 反向还原。
 */

/** 分段中的文件引用（document / image 通用）：上传完成后从 FileAttachment 投影而来 */
export interface BlockFileRef {
    id: string
    filename: string
    /** 项目相对路径（hub url source 的 value） */
    path: string
    mimeType: string
    size: number
    previewUrl?: string
}

/** 待发送的引用分段：指向已落库的历史消息 */
export interface PendingQuoteRef {
    messageId: string
    role: 'user' | 'agent'
    excerpt: string
}

/** Composer 当前完整分段状态 */
export interface ComposerSegments {
    text: string
    files: BlockFileRef[]
    images: BlockFileRef[]
    quotes: PendingQuoteRef[]
}

/** 单条引用上限：本期引用即整段引用一条消息，不允许多条堆叠 */
export const QUOTE_MAX_COUNT = 1

/** 空分段工厂：初始态与清空后的统一空值 */
export const emptySegments = (): ComposerSegments => ({ text: '', files: [], images: [], quotes: [] })

/** 发送语义判定：text(trim 后) / 文件 / 图片 / 引用 任一非空即可发送 */
export function isSegmentEmpty(segments: ComposerSegments): boolean {
    return segments.text.trim().length === 0
        && segments.files.length === 0
        && segments.images.length === 0
        && segments.quotes.length === 0
}

/**
 * 分段 → UserContentBlock[]（wire 形态）。
 *
 * - 固定顺序 document → image → quote → text：与 CLI 侧 blocks 化约定一致，正文恒收尾
 * - quote 仅取首条 + excerpt 截断至 QUOTE_EXCERPT_MAX（与 schema 约束对齐）
 * - text trim 后非空才入列；纯文本退化为单 text block，全空返回 []（调用方据此拦截）
 */
export function serializeSegments(segments: ComposerSegments): UserContentBlock[] {
    const out: UserContentBlock[] = []

    for (const f of segments.files) {
        out.push({
            type: 'document',
            source: { type: 'url', value: f.path, mimeType: f.mimeType },
            id: f.id,
            filename: f.filename,
            size: f.size,
            ...(f.previewUrl !== undefined ? { previewUrl: f.previewUrl } : {}),
        })
    }

    for (const img of segments.images) {
        out.push({
            type: 'image',
            source: { type: 'url', value: img.path, mimeType: img.mimeType },
            id: img.id,
            filename: img.filename,
            size: img.size,
            ...(img.previewUrl !== undefined ? { previewUrl: img.previewUrl } : {}),
        })
    }

    for (const q of segments.quotes.slice(0, QUOTE_MAX_COUNT)) {
        out.push({
            type: 'quote',
            messageId: q.messageId,
            role: q.role,
            excerpt: q.excerpt.slice(0, QUOTE_EXCERPT_MAX),
        })
    }

    const text = segments.text.trim()
    if (text.length > 0) out.push({ type: 'text', text })

    return out
}

/**
 * UserContentBlock[] → 分段（编辑回填方向的还原）。
 *
 * - 多个 text block 以 '\n' 连接为单段——行内连接语义由此统一收口
 *   （review 记账确认点：结构化发送落地后，多正文段的合并规则只在本函数定义）
 * - 无 MIME 的 block 回退空串；quote 仅取首条
 */
export function deserializeSegments(blocks: readonly UserContentBlock[]): ComposerSegments {
    const seg = emptySegments()
    const texts: string[] = []

    for (const b of blocks) {
        switch (b.type) {
            case 'document':
                seg.files.push({
                    id: b.id,
                    filename: b.filename,
                    path: b.source.value,
                    mimeType: b.source.mimeType ?? '',
                    size: b.size,
                    ...(b.previewUrl !== undefined ? { previewUrl: b.previewUrl } : {}),
                })
                break
            case 'image':
                seg.images.push({
                    id: b.id,
                    filename: b.filename,
                    path: b.source.value,
                    mimeType: b.source.mimeType ?? '',
                    size: b.size,
                    ...(b.previewUrl !== undefined ? { previewUrl: b.previewUrl } : {}),
                })
                break
            case 'quote':
                if (seg.quotes.length === 0) {
                    seg.quotes.push({ messageId: b.messageId, role: b.role, excerpt: b.excerpt })
                }
                break
            case 'text':
                texts.push(b.text)
                break
        }
    }

    seg.text = texts.join('\n')
    return seg
}
