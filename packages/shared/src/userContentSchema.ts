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
    role: z.enum(['user', 'agent']),
    excerpt: z.string().max(QUOTE_EXCERPT_MAX),
})

/** 用户消息 content block：text / image / document / quote 四种 */
export const UserContentBlockSchema = z.discriminatedUnion('type', [
    TextBlockSchema, ImageBlockSchema, DocumentBlockSchema, QuoteBlockSchema,
])

/** 用户消息 content 三形态：裸 string / 单 block / block 数组 */
export const UserMessageContentSchema = z.union([
    z.string(),
    UserContentBlockSchema,
    z.array(UserContentBlockSchema),
])

export type UserContentSource = z.infer<typeof UserContentSourceSchema>
/** 用户消息 content 三形态：裸 string / 单 block / block 数组（发送 wire 形态） */
export type UserMessageContent = z.infer<typeof UserMessageContentSchema>
export type UserTextBlock = z.infer<typeof TextBlockSchema>
export type UserImageBlock = z.infer<typeof ImageBlockSchema>
export type UserDocumentBlock = z.infer<typeof DocumentBlockSchema>
export type UserQuoteBlock = z.infer<typeof QuoteBlockSchema>
export type UserContentBlock = z.infer<typeof UserContentBlockSchema>

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
 * 读取侧四形态归一：string / 单 block / block 数组 / 旧平铺对象 → UserContentBlock[]。
 *
 * - 未知 block 被剔除并打 debug 日志；全部无法识别时返回 null
 * - 空字符串 / 空数组 / 畸形输入返回 null
 */
export function normalizeUserContent(raw: unknown): UserContentBlock[] | null {
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
        const asBlock = UserContentBlockSchema.safeParse(raw)
        if (asBlock.success) {
            // 空 text block 无渲染/提交意义，与空串 string 收敛一致
            if (asBlock.data.type === 'text' && asBlock.data.text === '') return null
            return [asBlock.data]
        }
    }
    return null
}

function normalizeBlockList(items: readonly unknown[]): UserContentBlock[] | null {
    const out: UserContentBlock[] = []
    for (const item of items) {
        if (typeof item === 'string') {
            if (item.length > 0) out.push({ type: 'text', text: item })
            continue
        }
        const parsedDoc = parseLegacyAttachment(item)
        if (parsedDoc) { out.push(parsedDoc); continue }
        const parsedBlock = UserContentBlockSchema.safeParse(item)
        if (parsedBlock.success) {
            // 空 text block 同样跳过（混合数组里冗余的空段）
            if (parsedBlock.data.type === 'text' && parsedBlock.data.text === '') continue
            out.push(parsedBlock.data)
            continue
        }
        // 只打类型元信息，不打内容——用户消息可能含敏感文本，避免落入服务端日志
        console.debug('[normalizeUserContent] 丢弃无法识别的 block:', isObject(item) ? String(item['type'] ?? '<no-type>') : typeof item)
    }
    return out.length > 0 ? out : null
}
