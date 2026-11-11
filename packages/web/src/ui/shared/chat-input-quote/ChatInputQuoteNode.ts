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

import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { QuoteChipView } from './QuoteChipView'
import { CHAT_INPUT_QUOTE_NODE_NAME, type ChatInputQuoteOptions } from './chatInputQuoteTypes'

/**
 * 输入流内嵌引用 chip 节点（Claude Desktop 同款形态）：inline atom——光标不可入、
 * 选中即整体；随文字流排版，序列化时从 doc 遍历收集。
 *
 * - renderText（→ schema.toText）：纯文本降级「「excerpt」」，editor.getText 与
 *   getTextBetween 自动消费（cursorOffset / canSend / 面板检测同源）
 * - parseHTML/renderHTML：复制粘贴与 setContent(HTML) 往返（attrs 走 data-*）
 * - Backspace 两段式（Claude Desktop 同款）：光标恰在 chip 后时第一次按选中 chip
 *   （NodeSelection，不改内容），第二次才整体删除
 */
export const ChatInputQuoteNode = Node.create<ChatInputQuoteOptions>({
    name: CHAT_INPUT_QUOTE_NODE_NAME,
    inline: true,
    group: 'inline',
    atom: true,
    draggable: false,

    addOptions() {
        return { onLocate: undefined }
    },

    addAttributes() {
        const fromData = (name: string) => ({
            default: null as unknown,
            parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name}`),
            renderHTML: (attributes: Record<string, unknown>) => {
                const value = attributes[name]
                return value == null ? {} : { [`data-${name}`]: String(value) }
            },
        })
        // 偏移是数字语义：HTML 往返（复制粘贴）后保持 number，收集侧不用二次转换
        const numericFromData = (name: string) => ({
            default: null as unknown,
            parseHTML: (element: HTMLElement) => {
                const raw = element.getAttribute(`data-${name}`)
                if (raw == null || raw === '') return null
                const value = Number(raw)
                return Number.isFinite(value) ? value : null
            },
            renderHTML: (attributes: Record<string, unknown>) => {
                const value = attributes[name]
                return value == null ? {} : { [`data-${name}`]: String(value) }
            },
        })
        return {
            uid: fromData('uid'),
            messageId: fromData('message-id'),
            role: fromData('role'),
            excerpt: fromData('excerpt'),
            comment: fromData('comment'),
            startOffset: numericFromData('start-offset'),
            endOffset: numericFromData('end-offset'),
        }
    },

    parseHTML() {
        return [{ tag: 'span[data-chat-input-quote]' }]
    },

    renderHTML({ node, HTMLAttributes }) {
        // NodeView 卸载时（如导出 HTML）的降级呈现：span 内 excerpt 文本
        return ['span', mergeAttributes(HTMLAttributes, { 'data-chat-input-quote': '' }), String(node.attrs.excerpt ?? '')]
    },

    renderText({ node }) {
        return `「${node.attrs.excerpt ?? ''}」`
    },

    addNodeView() {
        return ReactNodeViewRenderer(QuoteChipView)
    },

    addKeyboardShortcuts() {
        const quoteType = this.type
        return {
            Backspace: () => {
                const { selection } = this.editor.state
                if (!selection.empty) return false
                const $from = selection.$from
                const nodeBefore = $from.nodeBefore
                if (!nodeBefore || nodeBefore.type !== quoteType) return false
                // 第一段：把 chip 变为 NodeSelection（视觉高亮），不改内容；
                // 第二段 Backspace 时 ProseMirror 默认对 NodeSelection 执行删除
                return this.editor.commands.setNodeSelection($from.pos - nodeBefore.nodeSize)
            },
        }
    },
})
