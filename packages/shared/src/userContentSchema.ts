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

import { z } from 'zod'
import { isObject } from './utils'

/** quote excerpt 存储截断上限 */
export const QUOTE_EXCERPT_MAX = 200

/**
 * AG-UI InputContentSource 对齐：
 * mobi 落库恒用 url source（value=.mobi/uploads 路径）；data 形态仅留骨架占位。
 */
const UserContentSourceSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('url'), value: z.string(), mimeType: z.string().optional() }),
    z.object({ type: z.literal('data'), value: z.string(), mimeType: z.string() }),
])

/** image/document 共用的文件引用字段 */
const FileRefFields = {
    id: z.string(),
    filename: z.string(),
    size: z.number(),
    previewUrl: z.string().optional(),
}

const TextBlockSchema = z.object({ type: z.literal('text'), text: z.string() })
const ImageBlockSchema = z.object({ type: z.literal('image'), source: UserContentSourceSchema, ...FileRefFields })
const DocumentBlockSchema = z.object({ type: z.literal('document'), source: UserContentSourceSchema, ...FileRefFields })
const QuoteBlockSchema = z.object({
    type: z.literal('quote'),
    messageId: z.string(),
    // 被引用消息的作者。quote 由 composer 产出、只引用 user/agent 消息；对 custom 消息的
    // 引用由 mobi URI 动作链接（ADR 0003）承担，此处刻意不扩 'custom'——避免迫使消费方窄化类型同步放宽
    role: z.enum(['user', 'agent']),
    excerpt: z.string().max(QUOTE_EXCERPT_MAX),
})

/**
 * 统一 content block 词汇表（ADR 0002/0003）：text / image / document / quote 四种，
 * 跨来源（user / custom 消息）共享。新渲染需求先问「现有 block 能否组合」，
 * 不能才在此加 block 类型——加的是词汇，不是业务类型分支。
 * 内部动作（跳转/打开/发送）不走 block，由 mobi URI 动作链接承担（ADR 0003，actionUri.ts）。
 */
export const ContentBlockSchema = z.discriminatedUnion('type', [
    TextBlockSchema, ImageBlockSchema, DocumentBlockSchema, QuoteBlockSchema,
])

/** 用户消息通道词汇别名：ref 退场（ADR 0003）后与统一词汇表重合，名称保留给写入侧（hub/CLI）语义 */
export const UserContentBlockSchema = ContentBlockSchema

/** 用户消息 content 三形态：裸 string / 单 block / block 数组 */
export const UserMessageContentSchema = z.union([
    z.string(),
    UserContentBlockSchema,
    z.array(UserContentBlockSchema),
])

/** 消息 content 三形态（custom 通道等全词汇来源）：裸 string / 单 block / block 数组 */
export const MessageContentSchema = z.union([
    z.string(),
    ContentBlockSchema,
    z.array(ContentBlockSchema),
])

export type UserContentSource = z.infer<typeof UserContentSourceSchema>
/** 用户消息 content 三形态：裸 string / 单 block / block 数组（发送 wire 形态） */
export type UserMessageContent = z.infer<typeof UserMessageContentSchema>
export type UserTextBlock = z.infer<typeof TextBlockSchema>
export type UserImageBlock = z.infer<typeof ImageBlockSchema>
export type UserDocumentBlock = z.infer<typeof DocumentBlockSchema>
export type UserQuoteBlock = z.infer<typeof QuoteBlockSchema>
export type UserContentBlock = z.infer<typeof UserContentBlockSchema>
/** 统一词汇表类型（= UserContentBlock，ref 退场后两通道重合） */
export type ContentBlock = UserContentBlock
/** 全词汇消息 content 三形态（custom 通道 wire 形态） */
export type MessageContent = z.infer<typeof MessageContentSchema>

/**
 * 读取侧归一的输入：允许旧平铺对象带任意多余键（attachments 等），按宽松对象校验。
 * 生产库存量 user 消息全部是 {type:'text',text} 平铺形态，靠此通道消化。
 * 导出供消费方门口分流复用（如 cli api/types.ts 的 union 前置分支）——避免双源漂移。
 */
export const LegacyFlatObjectSchema = z.looseObject({
    type: z.string(),
    text: z.string().optional(),
    attachments: z.array(z.unknown()).optional(),
})

/** 旧平铺 attachments 元素的宽松校验：五字段类型齐全才可转换 */
const LegacyAttachmentSchema = z.object({
    id: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    size: z.number(),
    path: z.string(),
    previewUrl: z.string().optional(),
})

/**
 * 旧平铺 attachment → document block。
 * 老格式的 image/* 附件也归 document——历史数据不做重分类。
 * 字段不齐全返回 undefined。
 */
function parseLegacyAttachment(raw: unknown): UserDocumentBlock | undefined {
    const parsed = LegacyAttachmentSchema.safeParse(raw)
    if (!parsed.success) return undefined
    const a = parsed.data
    return {
        type: 'document',
        source: { type: 'url', value: a.path, mimeType: a.mimeType },
        id: a.id,
        filename: a.filename,
        size: a.size,
        ...(typeof a.previewUrl === 'string' ? { previewUrl: a.previewUrl } : {}),
    }
}

/**
 * 读取侧跨来源归一（三形态 + legacy 平铺兼容）：string / 单 block / block 数组 / 旧平铺对象 → ContentBlock[]。
 *
 * - ref 退场（ADR 0003）后单通道：所有来源接受同一词汇，历史 ref block 输入按 unknown 剔除
 *   （存量 ref 消息由 hub 迁移为 mobi URI 动作链接，见 hub 侧迁移）
 * - unknown block 剔除并打 debug 日志
 * - 全部无法识别 / 空字符串 / 空数组 / 畸形输入返回 null
 */
export function normalizeContentBlocks(raw: unknown): ContentBlock[] | null {
    if (typeof raw === 'string') {
        return raw.length > 0 ? [{ type: 'text', text: raw }] : null
    }
    if (Array.isArray(raw)) {
        return normalizeBlockList(raw)
    }
    if (isObject(raw)) {
        // 旧平铺对象携带 attachments 时必须先走 legacy 通道——
        // 新格式 block schema 会把 attachments 当未知键静默剥掉，先 parse 会丢附件
        if (Array.isArray(raw.attachments)) {
            const legacy = LegacyFlatObjectSchema.safeParse(raw)
            if (legacy.success) {
                const text = typeof legacy.data.text === 'string' ? legacy.data.text : ''
                return normalizeBlockList([text, ...(legacy.data.attachments ?? [])])
            }
        }

        // 新格式合法块（含恰好同形的 {type:'text',text} 平铺 —— 两格式此处结果一致）
        const asBlock = ContentBlockSchema.safeParse(raw)
        if (asBlock.success) {
            // 空 text block 无渲染/提交意义，与空串 string 收敛一致
            if (asBlock.data.type === 'text' && asBlock.data.text === '') return null
            return [asBlock.data]
        }
    }
    return null
}

/**
 * 用户消息通道归一入口。ref 退场后与 {@link normalizeContentBlocks} 等价，
 * 名称保留给存量调用方（hub/CLI/web）语义清晰：返回类型收窄为 UserContentBlock[]。
 */
export function normalizeUserContent(raw: unknown): UserContentBlock[] | null {
    return normalizeContentBlocks(raw) as UserContentBlock[] | null
}

function normalizeBlockList(items: readonly unknown[]): ContentBlock[] | null {
    const out: ContentBlock[] = []
    for (const item of items) {
        if (typeof item === 'string') {
            if (item.length > 0) out.push({ type: 'text', text: item })
            continue
        }
        const parsedDoc = parseLegacyAttachment(item)
        if (parsedDoc) { out.push(parsedDoc); continue }
        const parsedBlock = ContentBlockSchema.safeParse(item)
        if (parsedBlock.success) {
            // 空 text block 同样跳过（混合数组里冗余的空段）
            if (parsedBlock.data.type === 'text' && parsedBlock.data.text === '') continue
            out.push(parsedBlock.data)
            continue
        }
        logDroppedBlock(item)
    }
    return out.length > 0 ? out : null
}

/** 只打类型元信息，不打内容——用户消息可能含敏感文本，避免落入服务端日志 */
function logDroppedBlock(item: unknown): void {
    console.debug('[normalizeContentBlocks] 丢弃无法识别的 block:', isObject(item) ? String(item['type'] ?? '<no-type>') : typeof item)
}
