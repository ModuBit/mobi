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

import type { SketchMark, UserContentBlock } from '@mobi/shared'
import { QUOTE_EXCERPT_MAX } from '@mobi/shared'
import { uuid } from '@/core/lib/uuid'

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
    /** 草图标记（仅 image）：该 PNG 内嵌可编辑场景，画板重编辑入口的判据 */
    sketch?: SketchMark
}

/**
 * 待发送的引用分段：指向已落库历史消息的选中文本片段。
 *
 * 按引用目标演进（本期仅 message；未来 block/external），不按内容形态（文本/图片）分——
 * 内容形态是目标的派生属性，按目标判别不产生「引用一张图的消息算什么类型」的歧义。
 * 演进时在判别字段上扩 union（向后兼容 optional），改动收口于本文件 + wire QuoteBlockSchema。
 */
export interface PendingQuoteRef {
    messageId: string
    role: 'user' | 'agent'
    excerpt: string
    /** 用户对引用内容的疑问/澄清（可选，进 prompt 的 <user-comment>）；引用的价值主体 */
    comment?: string
}

/**
 * Composer 引用列表条目：PendingQuoteRef + 条目级身份 {@link uid}。
 *
 * uid 是必要的——同一条消息可以挂多个不同片段的引用（QUOTE_MAX_COUNT 的本意），
 * messageId 不唯一；chip 列表的 key/删除/评论编辑都以 uid 寻址，按 messageId 会
 * 撞 key、删一条删全部。uid 只活在 composer 状态内，不落 wire（QuoteBlockSchema
 * 无此字段，serializeSegments 按字段挑选）。
 */
export interface ComposerQuoteRef extends PendingQuoteRef {
    uid: string
}

/** 判定器/回填产出的 PendingQuoteRef → composer 列表条目（补条目级 uid）。
 *  uid 用 core/lib 的 uuid()（secure-context 兜底）——裸 crypto.randomUUID 在
 *  远程 http 访问（非安全上下文）下不存在，会直接抛错中断添加流程 */
export function withQuoteUids(quotes: readonly PendingQuoteRef[]): ComposerQuoteRef[] {
    return quotes.map(q => ({ ...q, uid: uuid() }))
}

/** Composer 当前完整分段状态 */
export interface ComposerSegments {
    text: string
    files: BlockFileRef[]
    images: BlockFileRef[]
    quotes: PendingQuoteRef[]
}

/** 单条消息可携带的引用上限：注释工作流允许多条片段引用堆叠，3 条防刷屏 */
export const QUOTE_MAX_COUNT = 3

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
 * - 固定顺序 image → document → quote → text：图片在前（视觉卡片更易扫读，用户预期），
 *   正文恒收尾；CLI 侧按 block 顺序遍历、两类间无顺序依赖
 * - quote 取前 QUOTE_MAX_COUNT 条（多条连续成 wire 段，引用组编号按此顺序）+ excerpt/
 *   comment 截断至 QUOTE_EXCERPT_MAX（与 schema 约束对齐）
 * - text trim 后非空才入列；纯文本退化为单 text block，全空返回 []（调用方据此拦截）
 */
export function serializeSegments(segments: ComposerSegments): UserContentBlock[] {
    const out: UserContentBlock[] = []

    for (const img of segments.images) {
        out.push({
            type: 'image',
            source: { type: 'url', value: img.path, mimeType: img.mimeType },
            id: img.id,
            filename: img.filename,
            size: img.size,
            ...(img.previewUrl !== undefined ? { previewUrl: img.previewUrl } : {}),
            ...(img.sketch !== undefined ? { sketch: img.sketch } : {}),
        })
    }

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

    for (const q of segments.quotes.slice(0, QUOTE_MAX_COUNT)) {
        out.push({
            type: 'quote',
            messageId: q.messageId,
            role: q.role,
            excerpt: q.excerpt.slice(0, QUOTE_EXCERPT_MAX),
            ...(q.comment !== undefined ? { comment: q.comment.slice(0, QUOTE_EXCERPT_MAX) } : {}),
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
 * - 无 MIME 的 block 回退空串；quote 取前 QUOTE_MAX_COUNT 条（与序列化上限对称）
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
                    ...(b.sketch !== undefined ? { sketch: b.sketch } : {}),
                })
                break
            case 'quote':
                if (seg.quotes.length < QUOTE_MAX_COUNT) {
                    seg.quotes.push({
                        messageId: b.messageId,
                        role: b.role,
                        excerpt: b.excerpt,
                        ...(b.comment !== undefined ? { comment: b.comment } : {}),
                    })
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
