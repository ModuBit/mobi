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
import { CHAT_INPUT_QUOTE_NODE_NAME, type ChatInputQuoteAttrs } from '@/ui/base/interactive/chat-input'
import {
    QUOTE_MAX_COUNT,
    withQuoteUid,
    type ComposerQuoteRef,
    type PendingQuoteRef,
} from '@/domain/chat/composerSegments'

/**
 * composer 引用 chip 的 doc 级操作（source of truth = 编辑器文档）：
 * chip 节点即数据，序列化时从 doc 遍历收集；不再有独立的 quotes state。
 * 视觉/节点定义在 ui 层（ChatInputQuoteNode），业务语义（去重/上限/uid）在此。
 */

/** 遍历 doc 收集全部引用条目（文档顺序 = prompt quote index 序） */
export function collectQuotesFromDoc(doc: Editor['state']['doc']): ComposerQuoteRef[] {
    const out: ComposerQuoteRef[] = []
    doc.descendants((node) => {
        if (node.type.name !== CHAT_INPUT_QUOTE_NODE_NAME) return true
        const attrs = node.attrs as ChatInputQuoteAttrs
        out.push({
            uid: attrs.uid,
            messageId: attrs.messageId,
            role: attrs.role,
            excerpt: attrs.excerpt,
            ...(attrs.comment != null && attrs.comment !== '' ? { comment: attrs.comment } : {}),
        })
        return false
    })
    return out
}

/** 节点 attrs JSON（insertContent 用） */
function quoteNodeJSON(quote: ComposerQuoteRef) {
    return {
        type: CHAT_INPUT_QUOTE_NODE_NAME,
        attrs: {
            uid: quote.uid,
            messageId: quote.messageId,
            role: quote.role,
            excerpt: quote.excerpt,
            comment: quote.comment ?? null,
        },
    }
}

/**
 * 灌入一条引用（消息列表选区动作 → composer）：去重（同消息同文本返回已有条目）、
 * 上限（QUOTE_MAX_COUNT 达上限返回 null）、插入光标处 + 尾随空格，返回落位条目。
 * 不抢焦点：引用是消息列表里的动作，焦点可能仍在消息区。
 */
export function addQuoteToEditor(editor: Editor, quote: PendingQuoteRef): ComposerQuoteRef | null {
    const existing = collectQuotesFromDoc(editor.state.doc).find(
        q => q.messageId === quote.messageId && q.excerpt === quote.excerpt,
    )
    if (existing) return existing
    if (collectQuotesFromDoc(editor.state.doc).length >= QUOTE_MAX_COUNT) return null
    const entry = withQuoteUid(quote)
    editor.commands.insertContent([quoteNodeJSON(entry), { type: 'text', text: ' ' }])
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
 */
export function insertQuotesAtEnd(editor: Editor, quotes: PendingQuoteRef[]): void {
    if (quotes.length === 0) return
    const items = quotes.slice(0, QUOTE_MAX_COUNT).flatMap((q) => {
        const entry = withQuoteUid(q)
        return [quoteNodeJSON(entry), { type: 'text', text: ' ' }]
    })
    editor.chain().focus('end').insertContent(items).run()
}
