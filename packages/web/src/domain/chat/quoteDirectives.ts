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
 * 回应批注 directive 语义层（spec .scratch/response-annotations 票 03/04）
 *
 * 模型在回复正文输出的内联 directive `:mobi-quote{index="N"}`（字面量单源 shared
 * QUOTE_DIRECTIVE，CLI 协议文案共用）。语法/扫描/去重管线单源 domain/chat/directives，
 * 本模块注册 quote 的参数语义与去重键，并导出渲染插桩用的解析、批注↔回复的 turn 配对
 * （handoff 记录的失败模式：同一 directive 被模型输出多次——由注册的去重键处理）。
 * 全部纯函数、单 pass 正则。
 */

import { QUOTE_DIRECTIVE } from '@mobi/shared'
import type { UserQuoteBlock } from '@mobi/shared'
import { DIRECTIVE_PREFIX, registerDirective } from './directives'
import type { DirectiveDefinition } from './directives'
import type { ChatBlock } from './types'

/** quote 指令在注册表中的名字（由 shared 字面量派生，ui 路由表按此寻址） */
export const QUOTE_DIRECTIVE_NAME = QUOTE_DIRECTIVE.slice(DIRECTIVE_PREFIX.length)

/**
 * quote 指令语义：唯一参数 index（一基正整数串）。非法（伪造/缺字段/"0"）返回 null，
 * 消费方按原文诚实降级；index 超出引用数量的越界由渲染层兜底为纯展示。
 * 去重键 = index：同 index 只保留首次出现。
 */
const QUOTE_DEFINITION: DirectiveDefinition<string> = {
    directive: QUOTE_DIRECTIVE,
    parse: (attrs) => {
        const { index } = attrs
        return index !== undefined && /^\d+$/.test(index) && Number(index) > 0 ? index : null
    },
    dedupeKey: (index) => index,
}

registerDirective(QUOTE_DEFINITION)

/** 会话完全无引用时返回共享空 Map（零分配早退——渲染热路径每帧调用，无批注会话不付全量构建成本） */
const EMPTY_ANNOTATIONS: ReadonlyMap<string, UserQuoteBlock[]> = new Map()

/**
 * 回应批注↔回复的 turn 配对（spec .scratch/response-annotations，领域规则单源）：
 * 与 CLI 协议注入同语义——每条 agent 回复配「触发它的那条 user 消息」的引用。
 *
 * 归属按块顺序线性推导：user-text 之后、下一个 user-text 之前的所有 agent-text
 * 都属于这一轮（一轮常有 thinking/text 分段产生的多条 agent-text）。steer 场景
 * （u1/u2/r1/r2）下回复归属最近一条 user——模型看到的最新协议注入就是它。
 *
 * 旧实现用 FIFO 队列、每条 agent-text 消费一个 user：一轮多条 agent-text 会吞掉
 * 后续 user，而没有产出正文的 user（工具轮/中断轮）会在队列里残留，队列长度越跑
 * 越偏。2026-10-20 生产实锤：会话 e32acfef 的 user 6118 带引用，其回复 6123 被
 * 配到空数组，`:mobi-quote` 在正文里降级成原文。
 */
export function collectQuoteAnnotationsByAgentId(
    chatBlocks: readonly ChatBlock[],
): ReadonlyMap<string, UserQuoteBlock[]> {
    const hasAnyQuote = chatBlocks.some(
        b => b.kind === 'user-text' && b.blocks.some(x => x.type === 'quote'),
    )
    if (!hasAnyQuote) return EMPTY_ANNOTATIONS

    const byId = new Map<string, UserQuoteBlock[]>()
    let currentQuotes: UserQuoteBlock[] = []
    for (const block of chatBlocks) {
        if (block.kind === 'user-text') {
            currentQuotes = block.blocks.filter((b): b is UserQuoteBlock => b.type === 'quote')
        } else if (block.kind === 'agent-text' && currentQuotes.length > 0) {
            byId.set(block.id, currentQuotes)
        }
    }
    return byId
}
