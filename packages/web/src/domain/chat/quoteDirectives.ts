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

/**
 * 回应批注 directive 解析（spec .scratch/response-annotations 票 03/04）
 *
 * 模型在回复正文输出的内联 directive `:mobi-quote{index="N"}`（字面量单源 shared
 * QUOTE_DIRECTIVE，CLI 协议文案共用）由本模块与 markdown 扩展（quoteDirectivePlugin）
 * 消费：解析命中位置供渲染插桩、剔除重复出现（handoff 记录的失败模式：同一 directive
 * 被模型输出多次）。全部纯函数、单 pass 正则；流式半截 directive（未闭合）不命中——
 * x-markdown 的不完整语法占位负责流式期间的视觉过渡，闭合后自然成钮。
 */

import { QUOTE_DIRECTIVE } from '@mobi/shared'
import type { UserQuoteBlock } from '@mobi/shared'
import type { ChatBlock } from './types'

/** 单个 directive 命中：一基索引 + 在原文中的 UTF-16 位置 */
export interface QuoteDirectiveHit {
    index: number
    start: number
    end: number
}

/** directive 完整形态：`:mobi-quote{index="N"}`（N 为非空数字串） */
const DIRECTIVE_RE = new RegExp(`${QUOTE_DIRECTIVE}\\{index="(\\d+)"\\}`, 'g')

/**
 * directive 完整形态的正则源（非全局、无锚定）：markdown 扩展（quoteDirectivePlugin）
 * 的 tokenizer 由它派生锚定版——解析剔除与 markdown 渲染对同一 directive 的判定同源，
 * 语法变更只改这一处。
 */
export const QUOTE_DIRECTIVE_SHAPE = `${QUOTE_DIRECTIVE}\\{index="(\\d+)"\\}`

/** 解析全部命中（不去重、按出现顺序；index 超出引用数量的越界由渲染层兜底为纯展示） */
export function parseQuoteDirectives(text: string): QuoteDirectiveHit[] {
    const hits: QuoteDirectiveHit[] = []
    DIRECTIVE_RE.lastIndex = 0
    for (let m = DIRECTIVE_RE.exec(text); m; m = DIRECTIVE_RE.exec(text)) {
        hits.push({ index: Number(m[1]), start: m.index, end: m.index + m[0].length })
    }
    return hits
}

/**
 * 剔除重复 directive：同 index 只保留首次出现，其余从文本移除（替换为空串）。
 * 输入变化时输出保持前缀稳定（后来的重复只会让尾部更短）——与流式渲染的
 * append-only 假设兼容，不会引发已揭示内容的重淡入。
 */
export function dedupeQuoteDirectiveText(text: string): string {
    if (!text.includes(QUOTE_DIRECTIVE)) return text
    const seen = new Set<number>()
    let out = ''
    let cursor = 0
    let removedAny = false
    for (const hit of parseQuoteDirectives(text)) {
        if (seen.has(hit.index)) {
            out += text.slice(cursor, hit.start)
            cursor = hit.end
            removedAny = true
        } else {
            seen.add(hit.index)
        }
    }
    // 无重复则原样返回（避免无谓的字符串重建，历史消息每帧渲染都走这里）
    if (!removedAny) return text
    return out + text.slice(cursor)
}

/**
 * 回应批注↔回复的 turn 配对（spec .scratch/response-annotations，领域规则单源）：
 * user-text 更新「最近一轮的引用集」，其后同轮的 agent-text 共享该引用（一轮可有多条
 * agent 消息），直到下一条 user 消息换血。会话完全无引用时返回共享空 Map（零分配
 * 早退——渲染热路径每帧调用，无批注会话不付全量构建成本）。
 */
const EMPTY_ANNOTATIONS: ReadonlyMap<string, UserQuoteBlock[]> = new Map()

export function collectQuoteAnnotationsByAgentId(
    chatBlocks: readonly ChatBlock[],
): ReadonlyMap<string, UserQuoteBlock[]> {
    const hasAnyQuote = chatBlocks.some(
        b => b.kind === 'user-text' && b.blocks.some(x => x.type === 'quote'),
    )
    if (!hasAnyQuote) return EMPTY_ANNOTATIONS

    const byId = new Map<string, UserQuoteBlock[]>()
    let pending: UserQuoteBlock[] | undefined
    for (const block of chatBlocks) {
        if (block.kind === 'user-text') {
            const quotes = block.blocks.filter((b): b is UserQuoteBlock => b.type === 'quote')
            pending = quotes.length > 0 ? quotes : undefined
        } else if (block.kind === 'agent-text' && pending) {
            byId.set(block.id, pending)
        }
    }
    return byId
}
