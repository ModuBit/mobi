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
    // 引用由 ref 词汇承担（ADR 0002），此处刻意不扩 'custom'——避免迫使消费方窄化类型同步放宽
    role: z.enum(['user', 'agent']),
    excerpt: z.string().max(QUOTE_EXCERPT_MAX),
})

/** ref block 基础结构：实体引用，可跳转（如「fork 自会话 xxx」的会话引用）。
 * 结构层宽松接受任意 targetType（字符串）——注册校验在归一层做跳过处理而非 schema 硬拒，
 * 老消费端遇到未来新注册的 targetType 不会因 schema 拒绝而丢整条消息（向前兼容）。 */
const RefBlockSchema = z.object({
    type: z.literal('ref'),
    targetType: z.string(),
    id: z.string(),
})

/**
 * ref.targetType 受控开放注册表（ADR 0002）：targetType → 该类型引用的载荷 schema。
 * 首期仅 'session'；未来 file / message / project 等只在此注册新键 + web 侧注册渲染器，
 * schema 结构永不动。注册表 schema 对 ref block 的公共字段（type/targetType/id）之外
 * 做逐类型追加约束，归一层用其复核已注册 ref 的载荷完整性。
 */
export const REF_TARGET_SCHEMAS = {
    session: z.object({ id: z.string() }),
} as const

/** 已注册的 ref 目标类型 */
export type RefTargetType = keyof typeof REF_TARGET_SCHEMAS

/** targetType 是否已注册（归一层跳过未注册值的判据；新增注册键后自动放行） */
export function isRegisteredRefTargetType(targetType: string): targetType is RefTargetType {
    return targetType in REF_TARGET_SCHEMAS
}

/**
 * 统一 content block 词汇表（ADR 0002）：text / image / document / quote / ref 五种，
 * 跨来源（user / custom 消息）共享。新渲染需求先问「现有 block 能否组合」，
 * 不能才在此加 block 类型——加的是词汇，不是业务类型分支。
 */
export const ContentBlockSchema = z.discriminatedUnion('type', [
    TextBlockSchema, ImageBlockSchema, DocumentBlockSchema, QuoteBlockSchema, RefBlockSchema,
])

/** 用户消息通道词汇 = 统一词汇去掉 ref（用户输入不接受实体引用，防伪造跳转）。
 * 独立成 schema 而非 ContentBlockSchema 的运行时过滤子集：写入侧（hub/CLI）可直接用于校验。 */
export const UserContentBlockSchema = z.discriminatedUnion('type', [
    TextBlockSchema, ImageBlockSchema, DocumentBlockSchema, QuoteBlockSchema,
])

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
/** 统一词汇表类型（含 ref），custom 通道消费 */
export type ContentBlock = z.infer<typeof ContentBlockSchema>
export type RefBlock = z.infer<typeof RefBlockSchema>
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

/** 归一化的通道词汇子集（ADR 0002：消费方按 role 决定接受子集） */
export interface NormalizeContentOptions {
    /** 是否接受 ref block：user 输入通道 false（拒绝，遇 ref 剔除，防伪造跳转）；custom 通道 true（全词汇） */
    allowRef?: boolean
}

/** 已注册 ref 的载荷完整性复核（注册表 schema 对公共字段之外的追加约束） */
function isAcceptableRef(block: RefBlock): boolean {
    if (!isRegisteredRefTargetType(block.targetType)) return false
    return REF_TARGET_SCHEMAS[block.targetType].safeParse(block).success
}

/**
 * 读取侧跨来源归一（三形态 + legacy 平铺兼容）：string / 单 block / block 数组 / 旧平铺对象 → ContentBlock[]。
 *
 * - 通道子集由 {@link NormalizeContentOptions} 决定：user 通道（默认）拒绝 ref，custom 通道全词汇
 * - 未注册 targetType 的 ref 与 unknown block 同处理：剔除并打 debug 日志
 * - 全部无法识别 / 空字符串 / 空数组 / 畸形输入返回 null
 */
export function normalizeContentBlocks(raw: unknown, options: NormalizeContentOptions = {}): ContentBlock[] | null {
    const { allowRef = false } = options
    if (typeof raw === 'string') {
        return raw.length > 0 ? [{ type: 'text', text: raw }] : null
    }
    if (Array.isArray(raw)) {
        return normalizeBlockList(raw, allowRef)
    }
    if (isObject(raw)) {
        // 旧平铺对象携带 attachments 时必须先走 legacy 通道——
        // 新格式 block schema 会把 attachments 当未知键静默剥掉，先 parse 会丢附件
        if (Array.isArray(raw.attachments)) {
            const legacy = LegacyFlatObjectSchema.safeParse(raw)
            if (legacy.success) {
                const text = typeof legacy.data.text === 'string' ? legacy.data.text : ''
                return normalizeBlockList([text, ...(legacy.data.attachments ?? [])], allowRef)
            }
        }

        // 新格式合法块（含恰好同形的 {type:'text',text} 平铺 —— 两格式此处结果一致）
        const asBlock = ContentBlockSchema.safeParse(raw)
        if (asBlock.success) {
            // 空 text block 无渲染/提交意义，与空串 string 收敛一致
            if (asBlock.data.type === 'text' && asBlock.data.text === '') return null
            if (asBlock.data.type === 'ref' && !(allowRef && isAcceptableRef(asBlock.data))) return null
            return [asBlock.data]
        }
    }
    return null
}

/**
 * 用户消息通道归一入口（user 词汇 = 统一词汇去掉 ref）。
 * 泛化前的既有签名与行为：存量调用方（hub/CLI/web）零改动。
 * 返回类型收窄为 UserContentBlock[] 安全——ref 在此通道不可能出现在结果里。
 */
export function normalizeUserContent(raw: unknown): UserContentBlock[] | null {
    return normalizeContentBlocks(raw, { allowRef: false }) as UserContentBlock[] | null
}

function normalizeBlockList(items: readonly unknown[], allowRef: boolean): ContentBlock[] | null {
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
            // 通道子集拒绝（user 通道遇 ref 剔除）与未注册 targetType 跳过同收此处
            if (parsedBlock.data.type === 'ref' && !(allowRef && isAcceptableRef(parsedBlock.data))) {
                logDroppedBlock(item)
                continue
            }
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
