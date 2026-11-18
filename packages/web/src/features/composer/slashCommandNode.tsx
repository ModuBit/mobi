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

import { InputRule, Node, PasteRule, type Extensions, type JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { COMMAND_NAME_CHARS_SRC } from '@/domain/command/slashCommandHelper'
import { SlashCommandTag } from '@/ui/base/display/SlashCommandTag'

/**
 * slash 命令原子节点（composer 专用）。
 *
 * 语义：命令名 + 两侧分隔空白是一个不可拆的整体——退格整块删除、光标进不到命令名中间。
 * 分隔空白（前导/尾随）存在节点 attrs 里而不是留在正文：Claude Code 只认
 * 「行首/空格 + 命令名 + 空格/行尾」三类边界，空白如果留在节点外，用户删掉它就会把
 * `/cmd` 和相邻文本粘成 `/cmdfoo`（命令名被改写、CC 也识别不到）。把空白收进原子，
 * 结构上就不可能出现粘连。
 *
 * wire 不变：renderText/renderMarkdown 精确还原「空白 + /命令名 + 空白」，
 * editor.getText() / getMarkdown() 与用户敲的字面量一致。
 *
 * 触发只发生在「token 收尾」的两个时刻：输入空格（InputRule）与面板选中（插入 API），
 * 命令名还在输入过程中保持纯文本（不提前着色）。
 *
 * 代码块 / 行内 code 内不转换——那里本来就要展示原始代码。
 */

export interface SlashCommandAttrs {
    /** 不含 / 前缀的命令名 */
    command: string
    /** 节点前是否有分隔空白（行首为 false） */
    leadingSpace: boolean
    /** 节点后是否有分隔空白（行尾为 false） */
    trailingSpace: boolean
}

/** 节点对应的字面量文本（wire / getText / 剪贴板共用这一个还原函数） */
export function slashCommandText(attrs: Pick<SlashCommandAttrs, 'command' | 'leadingSpace' | 'trailingSpace'>): string {
    return `${attrs.leadingSpace ? ' ' : ''}/${attrs.command}${attrs.trailingSpace ? ' ' : ''}`
}

/** 构造可交给 replaceTextRangeWithAtom 的节点 JSON（features 侧用） */
export function slashCommandNodeJSON(attrs: SlashCommandAttrs): JSONContent {
    return { type: 'slashCommand', attrs: { ...attrs } }
}

const SlashCommandView = ({ node }: NodeViewProps) => {
    const attrs = node.attrs as SlashCommandAttrs
    // 手写内联 span 而非 NodeViewWrapper：后者把 `as` 原样透成 DOM 属性（<span as="span">），
    // 且默认 div 不能做行内原子。data-node-view-wrapper 供 tiptap 识别节点视图产物
    return (
        <span data-node-view-wrapper="" data-slash-command={attrs.command}>
            {attrs.leadingSpace ? ' ' : null}
            <SlashCommandTag command={attrs.command} />
            {attrs.trailingSpace ? ' ' : null}
        </span>
    )
}

/** 命中位置是否位于代码块 / 行内 code：是则不做原子化（保留原始代码文本） */
function isInsideCode(state: { doc: PMNode }, from: number, to: number): boolean {
    if (state.doc.resolve(from).parent.type.name === 'codeBlock') return true
    const probe = Math.min(to - 1, state.doc.content.size)
    return state.doc.resolve(probe).marks().some(m => m.type.name === 'code')
}

export const SlashCommandNode = Node.create({
    name: 'slashCommand',
    group: 'inline',
    inline: true,
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
        return {
            command: {
                default: '',
                parseHTML: (el: HTMLElement) => el.getAttribute('data-command') ?? '',
                renderHTML: (attrs: Record<string, unknown>) => ({ 'data-command': attrs.command }),
            },
            leadingSpace: {
                default: false,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-leading-space') === '1',
                renderHTML: (attrs: Record<string, unknown>) => ({ 'data-leading-space': attrs.leadingSpace ? '1' : '0' }),
            },
            trailingSpace: {
                default: false,
                parseHTML: (el: HTMLElement) => el.getAttribute('data-trailing-space') === '1',
                renderHTML: (attrs: Record<string, unknown>) => ({ 'data-trailing-space': attrs.trailingSpace ? '1' : '0' }),
            },
        }
    },

    parseHTML() {
        return [{ tag: 'span[data-slash-command]' }]
    },

    renderHTML({ node }) {
        return ['span', { 'data-slash-command': node.attrs.command }, slashCommandText(node.attrs as SlashCommandAttrs)]
    },

    // getText / 文本偏移桥（textLengthBefore / positionAtOffset）走这里拿到字面量长度
    renderText({ node }) {
        return slashCommandText(node.attrs as SlashCommandAttrs)
    },

    // getWireText 的 markdown 兜底路径也要还原为纯文本（正常走 plain 分支，这里防御）
    renderMarkdown(node: JSONContent) {
        return slashCommandText((node.attrs ?? {}) as SlashCommandAttrs)
    },

    addNodeView() {
        return ReactNodeViewRenderer(SlashCommandView)
    },

    addInputRules() {
        return [
            // 输入空格收尾：`/cmd `（行首或前空格）+ 后空格 → 原子节点。
            // range 覆盖「前导空白 + /cmd + 尾空格」，节点 renderText 原样还原，
            // wire 字面量一个字符都不变。
            new InputRule({
                find: new RegExp(`(^|\\s)(\\/[${COMMAND_NAME_CHARS_SRC}]+) $`),
                handler: ({ state, range, match }) => {
                    if (isInsideCode(state, range.from, range.to)) return
                    // 前导空白只吸收普通空格：制表符/换行保留在正文（节点 renderText 只还原空格），
                    // 避免吸收后把 `\t` 改写成 ` ` 改掉字面量
                    const absorbLeading = match[1] === ' '
                    const replaceFrom = absorbLeading ? range.from : range.from + match[1].length
                    const node = state.schema.nodes.slashCommand.create({
                        // match[2] 含 / 前缀；attrs.command 只存命令名（renderText 负责补回 /）
                        command: match[2].slice(1),
                        leadingSpace: absorbLeading,
                        trailingSpace: true,
                    } satisfies SlashCommandAttrs)
                    const tr = state.tr.replaceWith(replaceFrom, range.to, node)
                    tr.setSelection(TextSelection.create(tr.doc, replaceFrom + node.nodeSize))
                },
            }),
        ]
    },

    addPasteRules() {
        return [
            // 粘贴文本里的 /cmd 也原子化（边界与原文本一致，空白由节点还原）
            new PasteRule({
                find: new RegExp(`(^|\\s)(\\/[${COMMAND_NAME_CHARS_SRC}]+)(?=\\s|$)`, 'g'),
                handler: ({ state, range, match }) => {
                    if (isInsideCode(state, range.from, range.to)) return
                    // paste rule 会对 textblock 与其 text 子节点各跑一遍，text 子节点那一遍的
                    // range 比实际文本偏移一位（tiptap 内部 +1 只在 textblock 成立）。用文档
                    // 实际文本比对：不是这段匹配的原文就跳过，避免重复插入原子
                    if (state.doc.textBetween(range.from, range.to) !== match[0]) return
                    const node = state.schema.nodes.slashCommand.create({
                        // match[2] 含 / 前缀；attrs.command 只存命令名（renderText 负责补回 /）
                        command: match[2].slice(1),
                        leadingSpace: match[1] !== '',
                        trailingSpace: false,
                    } satisfies SlashCommandAttrs)
                    state.tr.replaceWith(range.from, range.to, node)
                },
            }),
        ]
    },
})

/**
 * composer 需要注入 ChatInput 的业务扩展集合（模块级稳定引用：
 * useEditor 的 deps 直接持有它，内联数组会让编辑器每次渲染重建）
 */
export const COMPOSER_EXTRA_EXTENSIONS: Extensions = [SlashCommandNode]
