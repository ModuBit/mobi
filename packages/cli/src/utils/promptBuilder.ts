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

import { readFileSync } from 'node:fs'
import type { UserContentBlock, UserImageBlock } from '@mobi/shared'
import { QUOTE_DIRECTIVE } from '@mobi/shared'
import { logger } from '@/ui/logger'
import { escapeXmlText } from '@/utils/xmlEscape'

/** 单个 Anthropic content 元素（mobi prompt 场景子集） */
export type PromptContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: SupportedImageMime; data: string } }

/** prompt 产物：全程无成功图片退化 string（现状形态），否则 content 数组 */
export type PromptPayload = string | PromptContentBlock[]

/** Anthropic API 支持的图片 MIME（svg 等不受支持 → @path 降级）。
 *  media_type 用字面量联合对齐 Anthropic ContentBlockParam，image 元素无需 cast 即可入 SDK */
const SUPPORTED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const
type SupportedImageMime = (typeof SUPPORTED_IMAGE_MIME)[number]

/** 发 SDK 单图原始字节上限：Anthropic API 单图 base64 编码后上限 5MB（4/3 膨胀 → 原始 ~3.66MB），
 *  超限图片降级 @path 引用（上传白名单 50MB 远大于此，防线必要而非可选） */
const MAX_SDK_IMAGE_BYTES = 3.5 * 1024 * 1024

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * quote block → 结构化 XML 片段（对齐项目内 bash 注入惯例，见 buildBashInjectionText）：
 * `<quote index="1" role="agent">被选文本<user-comment>评论</user-comment></quote>`，
 * 无评论省略子标签。excerpt 与 comment 是用户可控的自由文本，经 XML 实体转义防止
 * `</quote>` 逃逸破坏结构（引用代码片段等含尖括号内容同样安全）。index 从 1 起、
 * 按 quote block 出现顺序编号，与 composer 引用编号一致。
 */
function buildQuoteText(block: Extract<UserContentBlock, { type: 'quote' }>, index: number): string {
    // excerpt 沿用既有的换行压缩（选区可能含软换行），comment 保留原样（多行评论是合法输入）
    const excerpt = escapeXmlText(block.excerpt.replace(/\s*\n\s*/g, ' '))
    const inner = block.comment !== undefined
        ? `${excerpt}<user-comment>${escapeXmlText(block.comment)}</user-comment>`
        : excerpt
    return `<quote index="${index}" role="${block.role}">${inner}</quote>`
}

/**
 * 回应批注协议指令（spec .scratch/response-annotations）：当本次消息含 agent 角色引用时，
 * 在首个 `<quote>` 前注入一段 `<system-reminder>` 指令（Claude 系模型对该标记有专门的
 * 注意力权重），要求模型在回应引用的位置输出 `:mobi-quote{index="N"}` 内联 directive。
 * directive 字面量取 shared 的 QUOTE_DIRECTIVE——与 web 渲染解析共用同一常量。
 * 全部引用统一编号（与 `<quote index>` 同源一基），user 角色引用占号但不输出 directive。
 */
function buildAnnotationProtocol(): string {
    return [
        '<system-reminder>',
        'Some `<quote>` elements in this message (role="agent") are response annotations:',
        'excerpts the user selected from your earlier replies, optionally followed by a',
        '<user-comment> with the user\'s question or clarification. Address every annotation',
        'and every user comment.',
        '',
        `When you address an annotation, emit exactly one inline directive \`${QUOTE_DIRECTIVE}{index="N"}\``,
        'at the single most relevant point in your reply, where N is that quote\'s one-based',
        '`index` in this message. Rules:',
        '- Emit directives only for quotes with role="agent"; never for role="user" quotes.',
        '- Emit each directive at most once, in your final answer; do not repeat it in',
        '  intermediate progress messages.',
        '- Never invent indices, and never replace the directive with a prose label',
        '  (such as writing "Note 1" as ordinary text).',
        '</system-reminder>',
    ].join('\n')
}

/**
 * 剥离 PNG 的 tEXt chunk（画板产物的内嵌 scene 就藏在这里，对模型无意义、白占 payload）。
 * 纯字节遍历：PNG chunk = length(4BE) + type(4) + data + crc(4)，保留非 tEXt、丢弃 tEXt，
 * 保留 chunk 的 CRC 原样有效（删除不影响其余 chunk 的 CRC 校验）。
 * 非 PNG / 截断畸形输入原样返回，不抛异常——本函数是发送链路的保洁，不是校验器。
 */
export function stripPngTextChunks(input: Buffer): Buffer {
    if (input.length < PNG_SIGNATURE.length || !input.subarray(0, 8).equals(PNG_SIGNATURE)) {
        return input
    }
    const chunks: Buffer[] = []
    let offset = 8
    while (offset + 12 <= input.length) {
        const length = input.readUInt32BE(offset)
        // 长度越界 = 截断/畸形：把剩余字节整体保留收尾，不丢弃用户数据
        if (offset + 12 + length > input.length) {
            chunks.push(input.subarray(offset))
            break
        }
        const type = input.subarray(offset + 4, offset + 8).toString('ascii')
        const end = offset + 12 + length
        if (type !== 'tEXt') {
            chunks.push(input.subarray(offset, end))
        }
        offset = end
    }
    return Buffer.concat([PNG_SIGNATURE, ...chunks])
}

/**
 * 用户 blocks → SDK prompt 的位置性转换（spec：docs/superpowers/specs/2026-08-27-user-message-content-blocks-design.md）。
 * 顺序 = composer 序列化顺序 files(document) → images → quote → text，
 * 每个 block 原位映射为 0..n 个 content 元素。
 *
 * 缓冲规则：
 * - @path 引用（document / 图片降级）同批单行空格合并；文本段以 \n\n 合并；两者间以 \n\n 分隔
 * - quote 视为独立引用边界：先冲刷缓冲，再单独成段（结构化 XML 片段，见 buildQuoteText；
 *   与后续正文成为相邻 text 元素，Anthropic 拼接语义下等价换段）
 * - 成功读取的图片冲刷缓冲后原位插入 base64 image 元素
 *
 * 全程无成功图片时退化为 string（与现状 prompt 形态零差异），否则返回 content 数组。
 */
export function buildPromptFromBlocks(blocks: UserContentBlock[]): PromptPayload {
    const out: PromptContentBlock[] = []
    let refs: string[] = []
    let texts: string[] = []
    let quoteSeq = 0
    // 批注协议注入条件：存在 agent 角色引用（引用 user 消息 / 无引用 = 零注入，prompt 与现状一致）
    const hasAgentQuote = blocks.some(b => b.type === 'quote' && b.role === 'agent')

    /** 冲刷缓冲为一个 text 元素（@path 单行 + 正文换段，空则不产出） */
    const flush = (): void => {
        const parts: string[] = []
        if (refs.length > 0) parts.push(refs.join(' '))
        if (texts.length > 0) parts.push(texts.join('\n\n'))
        if (parts.length > 0) out.push({ type: 'text', text: parts.join('\n\n') })
        refs = []
        texts = []
    }

    for (const block of blocks) {
        switch (block.type) {
            case 'text': {
                texts.push(block.text)
                break
            }
            case 'document': {
                refs.push(`@${block.source.value}`)
                break
            }
            case 'image': {
                const image = tryReadImageBase64(block.source)
                if (image) {
                    flush()
                    out.push({
                        type: 'image',
                        source: { type: 'base64', media_type: image.mediaType, data: image.data },
                    })
                } else {
                    refs.push(`@${block.source.value}`)
                }
                break
            }
            case 'quote': {
                flush()
                // 批注协议段只在首个 quote 前注入一次（全部引用共享一段指令，不逐条重复）
                if (quoteSeq === 0 && hasAgentQuote) {
                    out.push({ type: 'text', text: buildAnnotationProtocol() })
                }
                out.push({ type: 'text', text: buildQuoteText(block, ++quoteSeq) })
                break
            }
        }
    }
    flush()

    const hasImage = out.some((el) => el.type === 'image')
    if (!hasImage) {
        return out.map((el) => (el.type === 'text' ? el.text : '')).join('\n\n').trim()
    }
    return out
}

/**
 * 读取图片为 base64；不可行时返回 null 走 @path 降级：
 * - data source 暂未启用（落库恒用 url source）
 * - MIME 不在 Anthropic 支持列表（如 svg）
 * - 文件读取失败（已被移动/删除）
 * - 原始字节超单图上限（base64 后必超 API 5MB 硬限，降级由 CC 自读）
 *
 * PNG 发送前剥离 tEXt chunk（画板产物的内嵌 scene，对模型无意义）——像素零影响、payload 最小化。
 *
 * 返回校验后的 mediaType（字面量联合）与 data 一次算出——调用方 push image 元素时
 * 无需重复推断 mime，类型与 Anthropic ContentBlockParam 直接对齐。
 */
function tryReadImageBase64(source: UserImageBlock['source']): { data: string; mediaType: SupportedImageMime } | null {
    if (source.type !== 'url') return null
    const mime = source.mimeType ?? 'image/png'
    // find 而非 Set.has：命中即得字面量联合类型，无需受控 cast
    const mediaType = SUPPORTED_IMAGE_MIME.find(m => m === mime)
    if (!mediaType) return null
    try {
        const raw = readFileSync(source.value)
        if (raw.length > MAX_SDK_IMAGE_BYTES) {
            logger.warn(`[promptBuilder] 图片 ${source.value} 超过单图上限（${raw.length} 字节），降级 @path 引用`)
            return null
        }
        const bytes = mediaType === 'image/png' ? stripPngTextChunks(raw) : raw
        return { data: bytes.toString('base64'), mediaType }
    } catch (e) {
        logger.warn(`[promptBuilder] 图片读取失败，降级 @path 引用: ${source.value}`, e)
        return null
    }
}
