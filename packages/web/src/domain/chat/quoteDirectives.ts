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
 * 回应批注 directive 语义层（spec .scratch/response-annotations 票 03/04；协议统一
 * spec .scratch/quote-protocol-unification 票 01 派生化改造）
 *
 * 模型在回复正文的引用标记有两代语法，渲染收敛到同一 QuoteDirectiveMarker：
 * - 新 XML 形态 `<quote index="N"/>`（进出同形协议）：语法/解析/去重单源 shared
 *   quoteProtocol，本模块只做管线级组装（注册表外的 markdown 扩展与去重桥接）。
 * - 旧 directive `:mobi-quote{index="N"}`（只读兼容，历史会话渲染，零迁移）：语法/
 *   扫描/去重管线单源 domain/chat/directives 注册表，quote 的 index 语义
 *   （合法性、去重键）从 shared parseQuoteIndexAttr 派生——本模块不私写校验正则。
 * 另导出批注↔回复的 turn 配对（线性推导派生自 shared pairQuotesToReplies；
 * handoff 记录的失败模式：同一标记被模型输出多次——由去重键处理）。
 */

import { QUOTE_DIRECTIVE, parseQuoteIndexAttr, pairQuotesToReplies, EMPTY_QUOTES_MAP } from '@mobi/shared'
import type { QuotePairingEntry, UserQuoteBlock } from '@mobi/shared'
import { DIRECTIVE_PREFIX, registerDirective } from './directives'
import type { DirectiveDefinition } from './directives'
import type { ChatBlock } from './types'

/** quote 指令在注册表中的名字（由 shared 字面量派生，ui 路由表按此寻址） */
export const QUOTE_DIRECTIVE_NAME = QUOTE_DIRECTIVE.slice(DIRECTIVE_PREFIX.length)
/**
 * quote 指令语义：唯一参数 index，合法性由 shared parseQuoteIndexAttr 单源裁决
 * （一基正整数，规范为数字）。非法（伪造/缺字段/"0"）返回 null，消费方按原文诚实
 * 降级；index 超出引用数量的越界由渲染层兜底为纯展示。去重键 = 规范化 index：
 * 同一编号的任何写法只保留首次出现。
 */
const QUOTE_DEFINITION: DirectiveDefinition<string> = {
    directive: QUOTE_DIRECTIVE,
    parse: (attrs) => {
        const index = parseQuoteIndexAttr(attrs.index)
        return index === null ? null : String(index)
    },
    dedupeKey: (index) => index,
}

registerDirective(QUOTE_DEFINITION)

/** 配对输入投影：user-text = 触发方；agent-text / agent-reasoning = assistant 帧投影
 *  （reasoning 不是配对目标，但 turn 首帧常是 thinking-only——官方回戳以它为继承源，
 *  票 03）；其余块不参与、不打断（user 引用跨工具轮仍归属其后的回复）。
 *  合成 user-text（sidechain 子代理 prompt / rewind 起点）不是 turn 边界——排除而非
 *  投影，否则它会重置回戳继承与引用窗口，让工具轮+子代理后的正文帧双落空（review #2） */
type PairableChatBlock = Extract<ChatBlock, { kind: 'user-text' | 'agent-text' | 'agent-reasoning' }>

function isPairable(b: ChatBlock): b is PairableChatBlock {
    if (b.kind === 'user-text') return !b.isSynthetic
    return b.kind === 'agent-text' || b.kind === 'agent-reasoning'
}

/** web ChatBlock → shared 协议中性条目（blocks 按引用透传，不拷贝） */
function toPairingEntry(block: PairableChatBlock): QuotePairingEntry {
    if (block.kind === 'user-text') {
        return { side: 'user', id: block.id, blocks: block.blocks, ...(block.nativeId ? { nativeId: block.nativeId } : {}) }
    }
    return {
        side: 'agent',
        id: block.id,
        ...(block.userMessageUuid ? { userMessageUuid: block.userMessageUuid } : {}),
    }
}

/**
 * 回应批注↔回复的 turn 配对（spec .scratch/response-annotations；领域规则单源
 * shared pairQuotesToReplies——uuid 官方绑定优先 + 线性推导兜底（票 03），本函数
 * 只做 ChatBlock 序列的投影适配）：与 CLI 协议注入同语义——每条 agent 回复配
 * 「触发它的那条 user 消息」的引用。
 *
 * uuid 两端：user 侧 nativeId（落库 metadata.nativeId = SDKUserMessage.uuid）×
 * agent 侧官方回戳 user_message_uuid（SDK assistant 帧）。旧会话（无 uuid）与
 * 异常路径自动回落线性推导，配对不失败。
 *
 * 旧实现用 FIFO 队列、每条 agent-text 消费一个 user：一轮多条 agent-text 会吞掉
 * 后续 user，而没有产出正文的 user（工具轮/中断轮）会在队列里残留，队列长度越跑
 * 越偏。2026-10-20 生产实锤：会话 e32acfef 的 user 6118 带引用，其回复 6123 被
 * 配到空数组，`:mobi-quote` 在正文里降级成原文。
 */
export function collectQuoteAnnotationsByAgentId(
    chatBlocks: readonly ChatBlock[],
): ReadonlyMap<string, UserQuoteBlock[]> {
    // 投影前的廉价预检（单遍 .some 早退）：无引用会话（绝大多数）不进入 filter+map
    // 的中间数组与逐条 entry 分配，直接返回 shared 共享空 Map——渲染热路径每帧调用
    // （chatBlocks 流式期间每帧换引用）。注意与「投影后再扫」的双扫不同：预检在前
    // 省掉的是全部投影分配
    if (!chatBlocks.some(b => b.kind === 'user-text' && b.blocks.some(x => x.type === 'quote'))) {
        return EMPTY_QUOTES_MAP
    }
    const entries: QuotePairingEntry[] = []
    for (const block of chatBlocks) {
        if (isPairable(block)) entries.push(toPairingEntry(block))
    }
    return pairQuotesToReplies(entries)
}
