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

/** quote excerpt / comment 存储截断上限：覆盖「引用一段论述」的选区长度
 * （2026-09-26 调至 1000：500 截不住完整论述段） */
export const QUOTE_EXCERPT_MAX = 1000

/**
 * 评论 UI 输入上限：评论是用户的一句话注解，500 的 excerpt 量级没必要（2026-09-23 验收定稿）。
 * 仅约束输入侧（maxLength）；schema 校验保持 QUOTE_EXCERPT_MAX 宽松——收窄会让超限的
 * 存量评论在读取侧被静默丢弃。
 */
export const QUOTE_COMMENT_MAX = 300

/**
 * 回应批注 directive 字面量（spec .scratch/response-annotations）：模型在回复中回应
 * agent 引用的位置输出 `:mobi-quote{index="N"}`（index 与 `<quote index>` 同源一基）。
 * CLI 协议文案与 web 渲染解析共用此常量，字面量两处漂移会被对方解析不了。
 */
export const QUOTE_DIRECTIVE = ':mobi-quote'

/**
 * 产物声明 directive 字面量（spec .scratch/inline-artifacts）：模型在 turn 最终回复中
 * 对「本轮产出的可视产物」输出 `:mobi-artifact{path="/abs/path" mode="card|wide"}`——
 * mode 可选，缺省 auto（web 按类型定渲染形态）。类型判定权在 web（模型不写类型），
 * CLI 常驻契约文案与 web 渲染解析共用此常量防漂移（同 QUOTE_DIRECTIVE 机制）。
 */
export const ARTIFACT_DIRECTIVE = ':mobi-artifact'

/**
 * HTML inline 大小上限（MB，spec Q10）：web 渲染裁决与 skill 散文（「under N MB」）
 * 共用的数值单源——上限调整时 web 裁决与模型侧产物规范必须同帧变，漂移由 cli 侧
 * 三方一致性测试锁红（artifactContractConsistency）。
 */
export const ARTIFACT_HTML_INLINE_LIMIT_MB = 2

/**
 * 非项目交付物产物目录模板（相对 cwd）与月份段格式：CLI 常驻契约与 skill「Where files
 * go」两份文本都靠它拼出（`.mobi/artifacts/<YYYY-MM>/`），目录约定调整时改一处两份同帧。
 */
export const ARTIFACTS_DIR_REL = '.mobi/artifacts'
export const ARTIFACTS_DIR_MONTH_FORMAT = 'YYYY-MM'

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

/**
 * 草图标记（画板特性）：语义是「这张 PNG 经 tEXt chunk 内嵌可编辑场景，格式为 X」。
 * format 取画板引擎标识（如 'excalidraw'），为将来更换/新增画板 SDK 留识别空间；
 * 无标记 = 普通图片（无重编辑入口）。
 */
export const SketchMarkSchema = z.object({ format: z.string() })
export type SketchMark = z.infer<typeof SketchMarkSchema>

const TextBlockSchema = z.object({ type: z.literal('text'), text: z.string() })
const ImageBlockSchema = z.object({
    type: z.literal('image'),
    source: UserContentSourceSchema,
    ...FileRefFields,
    sketch: SketchMarkSchema.optional(),
})
const DocumentBlockSchema = z.object({ type: z.literal('document'), source: UserContentSourceSchema, ...FileRefFields })
const QuoteBlockSchema = z.object({
    type: z.literal('quote'),
    messageId: z.string(),
    // 被引用消息的作者。quote 由 composer 产出、只引用 user/agent 消息；对 custom 消息的
    // 引用由 mobi URI 动作链接（ADR 0003）承担，此处刻意不扩 'custom'——避免迫使消费方窄化类型同步放宽
    role: z.enum(['user', 'agent']),
    excerpt: z.string().max(QUOTE_EXCERPT_MAX),
    // 用户对引用内容的疑问/澄清（可选）：引用的价值主体，CLI 拼装 prompt 时以 <user-comment> 子标签紧随所属引用
    comment: z.string().max(QUOTE_EXCERPT_MAX).optional(),
    // 选区在源消息 text block 容器内的位置（UTF-16 code unit，相对 blockEl.textContent）。
    // 只记录不使用（为「精确高亮源片段」预留的事实记录）：不进 prompt、不用于定位；
    // 旧消息无字段照常解析（optional 向后兼容）
    startOffset: z.number().int().nonnegative().optional(),
    endOffset: z.number().int().nonnegative().optional(),
})

/**
 * 自定义事件（受控注册的 wire 形态，AG-UI 1.0 CUSTOM 扩展点语义对齐）：custom 消息
 * 承载**结构化应用事件**的统一形态——`name` 路由渲染器、`value` 为该事件正式定义的
 * zod 载荷（如 turn-diff → shared/turnDiff.ts）。与渲染四型的分界：text/image/document/
 * quote 是「内容组合」词汇，custom-event 是「应用事实」通道——新结构化消息一律走这里
 * （加 name 注册 + 载荷 schema），禁止另起消息形态或挤进渲染词汇表。
 */
const CustomEventBlockSchema = z.object({
    type: z.literal('custom-event'),
    name: z.string().min(1),
    value: z.unknown(),
})

/**
 * 统一 content block 词汇表（ADR 0002/0003）：渲染四型 text / image / document / quote
 * 是用户与 custom 两通道共享的**内容组合**词汇；custom-event 是 custom 通道独有的
 * **应用事实**形态（见上）。内部动作（跳转/打开/发送）不走 block，由 mobi URI 动作
 * 链接承担（ADR 0003，actionUri.ts）。
 */

/** 渲染四型 union：用户通道（UserContentBlock）与全词汇表的公共子集 */
const RenderBlockSchema = z.discriminatedUnion('type', [
    TextBlockSchema, ImageBlockSchema, DocumentBlockSchema, QuoteBlockSchema,
])

/** 全词汇表（custom 通道 wire 形态）：渲染四型 + 自定义事件 */
export const ContentBlockSchema = z.discriminatedUnion('type', [
    TextBlockSchema, ImageBlockSchema, DocumentBlockSchema, QuoteBlockSchema, CustomEventBlockSchema,
])

/** 用户消息通道词汇（渲染四型，刻意不含 custom-event）：用户输入禁伪造应用事件，
 *  hub 入参校验（UserMessageContentSchema）据此拒绝 */
export const UserContentBlockSchema = RenderBlockSchema

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

/**
 * 自足 URL 判据：blob: / data: / http(s):// 的值自带内容，**不需要从磁盘读**。
 *
 * 两个消费方都问这个问题，答案必须一致：
 * - Web 的 image 渲染据此绕过 read-file 端点（乐观回显的 blob、网络图，D23 旁路）
 * - Hub 的跨会话投递归据据此判断「这条消息是否依赖目标机器上的文件」（D22 的同机器约束）
 *
 * 判据只此一份的理由是**不一致会互相拆台**：Web 认为自足而投递认为需要本地文件，
 * 就会出现「明明渲染得出来却被拒」的怪事，反之则是渲染成破图而投递报成功。
 */
export function isSelfContainedUrl(value: string): boolean {
    // 收尾的 `)` 不是多余的：正则体以 `\/\/` 结束时，TS 扫描器会提前在第二个 `\/` 的
    // 斜杠上闭合字面量（`/…https?:\/\//i` 报 TS1005），带一层分组则正常。
    // 写法与 Web 侧原实现逐字相同——本条只是把判据搬到共享层，语义不变
    return /^(blob:|data:|https?:\/\/)/i.test(value)
}

export type UserContentSource = z.infer<typeof UserContentSourceSchema>
/** 用户消息 content 三形态：裸 string / 单 block / block 数组（发送 wire 形态） */
export type UserMessageContent = z.infer<typeof UserMessageContentSchema>
export type UserTextBlock = z.infer<typeof TextBlockSchema>
export type UserImageBlock = z.infer<typeof ImageBlockSchema>
export type UserDocumentBlock = z.infer<typeof DocumentBlockSchema>
export type UserQuoteBlock = z.infer<typeof QuoteBlockSchema>
export type UserCustomEventBlock = z.infer<typeof CustomEventBlockSchema>
export type UserContentBlock = z.infer<typeof UserContentBlockSchema>
/** 全词汇表类型（渲染四型 + custom-event；渲染四型子集见 UserContentBlock） */
export type ContentBlock = z.infer<typeof ContentBlockSchema>
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
    const blocks = normalizeContentBlocks(raw)
    if (!blocks) return null
    // 用户通道不产 custom-event（写入侧校验已拒）；读取侧过滤兜底，收窄回渲染四型
    const filtered = blocks.filter((b): b is UserContentBlock => b.type !== 'custom-event')
    return filtered.length > 0 ? filtered : null
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
