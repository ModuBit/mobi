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
import { logger } from '@/ui/logger'

/** 单个 Anthropic content 元素（mobi prompt 场景子集） */
export type PromptContentBlock =
    | { type: 'text'; text: string }
    | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }

/** prompt 产物：全程无成功图片退化 string（现状形态），否则 content 数组 */
export type PromptPayload = string | PromptContentBlock[]

/** Anthropic API 支持的图片 MIME（svg 等不受支持 → @path 降级） */
const SUPPORTED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

/**
 * 用户 blocks → SDK prompt 的位置性转换（spec：docs/superpowers/specs/2026-08-27-user-message-content-blocks-design.md）。
 * 顺序 = composer 序列化顺序 files(document) → images → quote → text，
 * 每个 block 原位映射为 0..n 个 content 元素。
 *
 * 缓冲规则：
 * - @path 引用（document / 图片降级）同批单行空格合并；文本段以 \n\n 合并；两者间以 \n\n 分隔
 * - quote 视为独立引用边界：先冲刷缓冲，再单独成段（与后续正文成为相邻 text 元素，Anthropic 拼接语义下等价换段）
 * - 成功读取的图片冲刷缓冲后原位插入 base64 image 元素
 *
 * 全程无成功图片时退化为 string（与现状 prompt 形态零差异），否则返回 content 数组。
 */
export function buildPromptFromBlocks(blocks: UserContentBlock[]): PromptPayload {
    const out: PromptContentBlock[] = []
    let refs: string[] = []
    let texts: string[] = []

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
                const data = tryReadImageBase64(block.source)
                if (data) {
                    flush()
                    out.push({
                        type: 'image',
                        source: { type: 'base64', media_type: block.source.mimeType ?? 'image/png', data },
                    })
                } else {
                    refs.push(`@${block.source.value}`)
                }
                break
            }
            case 'quote': {
                flush()
                out.push({
                    type: 'text',
                    text: `[引用 ${block.role}]：${block.excerpt.replace(/\s*\n\s*/g, ' ')}`,
                })
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
 */
function tryReadImageBase64(source: UserImageBlock['source']): string | null {
    if (source.type !== 'url') return null
    const mime = source.mimeType ?? 'image/png'
    if (!SUPPORTED_IMAGE_MIME.has(mime)) return null
    try {
        return readFileSync(source.value, { encoding: 'base64' })
    } catch (e) {
        logger.warn(`[promptBuilder] 图片读取失败，降级 @path 引用: ${source.value}`, e)
        return null
    }
}
