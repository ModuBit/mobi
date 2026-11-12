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

import type { Editor } from '@tiptap/core'
import { CHAT_INPUT_QUOTE_NODE_NAME, type ChatInputQuoteAttrs } from './chatInputQuoteTypes'
import {
    QUOTE_MAX_COUNT,
    withQuoteUid,
    withQuoteUids,
    type ComposerQuoteRef,
    type PendingQuoteRef,
} from '@/domain/chat/composerSegments'

/**
 * composer 引用 chip 的 doc 级操作（source of truth = 编辑器文档）：
 * chip 节点即数据，序列化时从 doc 遍历收集；不再有独立的 quotes state。
 *
 * 归属 ui/shared（多域共享的业务呈现 + 其文档操作）：chip 的节点定义/NodeView/
 * 文档遍历都带引用业务语义，不放进零业务的 ui/base；ChatInput 经装配注入节点、
 * 经 Handle 方法调用这里的实现。
 */

/** chip 节点 attrs → 待发送引用条目（消息级 + 片段级偏移；空评论不收） */
function quoteFromAttrs(attrs: ChatInputQuoteAttrs): PendingQuoteRef {
    return {
        messageId: attrs.messageId,
        role: attrs.role,
        excerpt: attrs.excerpt,
        ...(attrs.comment != null && attrs.comment !== '' ? { comment: attrs.comment } : {}),
        ...(typeof attrs.startOffset === 'number' ? { startOffset: attrs.startOffset } : {}),
        ...(typeof attrs.endOffset === 'number' ? { endOffset: attrs.endOffset } : {}),
    }
}

/** 遍历 doc 收集全部引用条目（文档顺序 = prompt quote index 序） */
export function collectQuotesFromDoc(doc: Editor['state']['doc']): ComposerQuoteRef[] {
    const out: ComposerQuoteRef[] = []
    doc.descendants((node) => {
        if (node.type.name !== CHAT_INPUT_QUOTE_NODE_NAME) return true
        out.push({ ...quoteFromAttrs(node.attrs as ChatInputQuoteAttrs), uid: (node.attrs as ChatInputQuoteAttrs).uid })
        return false
    })
    return out
}

function quoteNodeJSON(quote: ComposerQuoteRef) {
    return {
        type: CHAT_INPUT_QUOTE_NODE_NAME,
        attrs: {
            uid: quote.uid,
            messageId: quote.messageId,
            role: quote.role,
            excerpt: quote.excerpt,
            comment: quote.comment ?? null,
            // 片段级定位事实：丢了它，引用回到消息列表只能按 excerpt 模糊命中
            startOffset: quote.startOffset ?? null,
            endOffset: quote.endOffset ?? null,
        },
    }
}

/**
 * 结构化草稿 JSON → 引用条目（纯 JSON 遍历，不需要 editor 实例）。
 * 跨页草稿合并时把旧快照里的 chip 摘出来转入 quotes 桶，避免随 editorState
 * 一起被丢弃（旧快照的正文已被跨页文本替换，chip 是仍可复用的引用上下文）。
 */
export function extractQuotesFromEditorStateJSON(json: string): PendingQuoteRef[] {
    let parsed: unknown
    try {
        parsed = JSON.parse(json) as unknown
    } catch {
        return []
    }
    const out: PendingQuoteRef[] = []
    const seen = new Set<string>()
    const walk = (node: unknown) => {
        if (!node || typeof node !== 'object') return
        const obj = node as { type?: unknown; attrs?: Record<string, unknown>; content?: unknown }
        if (obj.type === CHAT_INPUT_QUOTE_NODE_NAME && obj.attrs) {
            const attrs = obj.attrs as unknown as ChatInputQuoteAttrs
            if (
                typeof attrs.messageId === 'string'
                && typeof attrs.excerpt === 'string'
                && (attrs.role === 'user' || attrs.role === 'agent')
            ) {
                const key = `${attrs.messageId}\u0000${attrs.excerpt}`
                if (!seen.has(key)) {
                    seen.add(key)
                    out.push(quoteFromAttrs(attrs))
                }
            }
        }
        if (Array.isArray(obj.content)) obj.content.forEach(walk)
    }
    walk(parsed)
    return out.slice(0, QUOTE_MAX_COUNT)
}

/**
 * 灌入一条引用（消息列表选区动作 → composer）：去重（同消息同文本返回已有条目）、
 * 上限（QUOTE_MAX_COUNT 达上限返回 null）、插入光标处 + 尾随空格，返回落位条目。
 * 不抢焦点：引用是消息列表里的动作，焦点可能仍在消息区。
 * 有选区/节点选中时插到文档末尾而不替换选区——引用是「追加上下文」，不是「改写正文」。
 */
export function addQuoteToEditor(editor: Editor, quote: PendingQuoteRef): ComposerQuoteRef | null {
    const existingQuotes = collectQuotesFromDoc(editor.state.doc)
    const existing = existingQuotes.find(
        q => q.messageId === quote.messageId && q.excerpt === quote.excerpt,
    )
    if (existing) return existing
    if (existingQuotes.length >= QUOTE_MAX_COUNT) return null
    const entry = withQuoteUid(quote)
    const { selection } = editor.state
    const insertPos = selection.empty ? selection.from : editor.state.doc.content.size - 1
    editor.commands.insertContentAt(insertPos, [quoteNodeJSON(entry), { type: 'text', text: ' ' }])
    return entry
}

/** 更新某条引用的评论（undefined = 清空，attrs 落 null）；返回是否命中 */
export function updateQuoteCommentInEditor(editor: Editor, uid: string, comment: string | undefined): boolean {
    const doc = editor.state.doc
    let pos: number | null = null
    doc.descendants((node, nodePos) => {
        if (pos != null || node.type.name !== CHAT_INPUT_QUOTE_NODE_NAME) return true
        if ((node.attrs as ChatInputQuoteAttrs).uid === uid) {
            pos = nodePos
            return false
        }
        return true
    })
    if (pos == null) return false
    const tr = editor.state.tr.setNodeAttribute(pos, 'comment', comment ?? null)
    editor.view.dispatch(tr)
    return true
}

/** 一键清空全部引用（遍历倒序删，位置不漂移）；返回删除条数 */
export function clearQuotesInEditor(editor: Editor): number {
    const doc = editor.state.doc
    const positions: number[] = []
    doc.descendants((node, pos) => {
        if (node.type.name === CHAT_INPUT_QUOTE_NODE_NAME) positions.push(pos)
        return true
    })
    if (positions.length === 0) return 0
    const tr = editor.state.tr
    for (const pos of positions.reverse()) {
        tr.delete(pos, pos + doc.nodeAt(pos)!.nodeSize)
    }
    editor.view.dispatch(tr)
    return positions.length
}

/**
 * 回填：把一组引用按文档末尾顺序追加（wire 回填数据无 uid——生成规则照旧 withQuoteUid）。
 * 每条 chip 后带一个空格，与手输插入形态一致。
 * 不抢焦点：草稿恢复可能发生在页面挂载/移动端首屏，focus 会弹键盘并抢走滚动；
 * 需要焦点的调用方（如 rewind 回填）自己显式 focus。
 */
export function insertQuotesAtEnd(editor: Editor, quotes: PendingQuoteRef[]): void {
    if (quotes.length === 0) return
    const items = withQuoteUids(quotes.slice(0, QUOTE_MAX_COUNT)).flatMap((q) => [
        quoteNodeJSON(q),
        { type: 'text', text: ' ' },
    ])
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, items)
}
