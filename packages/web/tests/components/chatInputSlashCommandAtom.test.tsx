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
 * composer slash 命令原子节点（features/composer/slashCommandNode）契约：
 * - 空格收尾才原子化（命令名输入中不动它）；语法判定，不查命令表
 * - wire / getText / 剪贴板字面量不变（空白收进节点 attrs、renderText 原样还原）
 * - 原子不可拆：退格整块删除，不会残留半截命令名
 * - 代码块 / 行内 code 内不转换（保留原始代码文本）
 * - 面板选中走 replaceTextRangeWithAtom；粘贴走 PasteRule 且不重复插入
 */

import { describe, it, expect, afterEach } from 'vitest'
import type { Node as PMNode } from '@tiptap/pm/model'
import '@testing-library/jest-dom/vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import { ChatInput, type ChatInputHandle, type ChatInputProps } from '@/ui/base/interactive/chat-input'
import {
    COMPOSER_EXTRA_EXTENSIONS,
    slashCommandNodeJSON,
} from '@/features/composer/slashCommandNode'

/** 统计 doc 中某节点类型的出现次数 */
function countNodes(doc: PMNode, typeName: string): number {
    let count = 0
    doc.descendants((node) => { if (node.type.name === typeName) count++ })
    return count
}

afterEach(cleanup)

function setup(props: Partial<ChatInputProps> = {}) {
    const handleRef: { current: ChatInputHandle | null } = { current: null }
    const utils = render(
        <ChatInput
            {...props}
            extraExtensions={COMPOSER_EXTRA_EXTENSIONS}
            ref={(h: ChatInputHandle | null) => { handleRef.current = h }}
        />,
    )
    const pm = () => document.querySelector('.ProseMirror') as HTMLElement
    const ready = () =>
        waitFor(() => {
            expect(pm()).toBeInTheDocument()
            expect(handleRef.current).not.toBeNull()
        })
    const typeKey = (init: KeyboardEventInit & { keyCode?: number }) => {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
        if (init.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: init.keyCode })
        pm().dispatchEvent(event)
        return event
    }
    return { ...utils, handle: handleRef, pm, ready, typeKey }
}

/** 逐字输入：与 chatInput.test.tsx 同法（handleTextInput 是 InputRule 所在的缝） */
function typeInto(handle: { current: ChatInputHandle | null }, text: string) {
    const editor = handle.current!.getEditor()!
    const view = editor.view
    for (const ch of text) {
        const { from, to } = view.state.selection
        const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch))
        if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
    }
}

describe('composer slash 命令原子节点', () => {
    it('输入空格收尾 → 原子节点；getText / getWireText 字面量不变', async () => {
        const { handle, ready } = setup()
        await ready()
        typeInto(handle, '/compact ')
        expect(countNodes(handle.current!.getEditor()!.state.doc, 'slashCommand')).toBe(1)
        expect(handle.current!.getText()).toBe('/compact ')
        expect(handle.current!.getWireText()).toBe('/compact ')
    })

    it('命令名输入中不转换（无尾空格保持纯文本）', async () => {
        const { handle, ready } = setup()
        await ready()
        typeInto(handle, '/compact')
        expect(countNodes(handle.current!.getEditor()!.state.doc, 'slashCommand')).toBe(0)
        expect(handle.current!.getText()).toBe('/compact')
    })

    it('不在命令表里的命令同样原子化（语法判定，不查表）', async () => {
        const { handle, ready } = setup()
        await ready()
        typeInto(handle, '/not-a-real-command ')
        expect(countNodes(handle.current!.getEditor()!.state.doc, 'slashCommand')).toBe(1)
        expect(handle.current!.getText()).toBe('/not-a-real-command ')
    })

    it('句中命令：前导空格收进节点，后续文本正常衔接', async () => {
        const { handle, ready } = setup()
        await ready()
        typeInto(handle, 'foo /compact bar')
        expect(countNodes(handle.current!.getEditor()!.state.doc, 'slashCommand')).toBe(1)
        expect(handle.current!.getText()).toBe('foo /compact bar')
        expect(handle.current!.getWireText()).toBe('foo /compact bar')
    })

    it('原子整块删除：选中节点删除后不残留半截命令名', async () => {
        const { handle, ready } = setup()
        await ready()
        typeInto(handle, '/compact ')
        const editor = handle.current!.getEditor()!
        // jsdom 无原生 contenteditable 退格删除；用 NodeSelection 表达「退格选中整个原子」
        // 的语义：节点是单一 leaf，删除只可能整体消失（无法产生半截文本）
        let atomPos = -1
        editor.state.doc.descendants((node, pos) => {
            if (node.type.name === 'slashCommand') atomPos = pos
        })
        expect(atomPos).toBeGreaterThan(-1)
        editor.commands.setNodeSelection(atomPos)
        editor.commands.deleteSelection()
        expect(handle.current!.getText().trim()).toBe('')
        expect(countNodes(editor.state.doc, 'slashCommand')).toBe(0)
    })

    it('命令中间不可编辑：光标定位到节点区间时落在节点之后', async () => {
        const { handle, ready } = setup()
        await ready()
        typeInto(handle, '/compact ')
        handle.current!.setCursorOffset(3)
        handle.current!.insertAtCursor('X')
        expect(handle.current!.getText()).toBe('/compact X')
    })

    it('代码块内不原子化（保留原始代码文本）', async () => {
        const { handle, ready } = setup()
        await ready()
        const editor = handle.current!.getEditor()!
        editor.commands.setContent({
            type: 'doc',
            content: [{ type: 'codeBlock', content: [{ type: 'text', text: '/compact' }] }],
        })
        handle.current!.setCursorOffset(8)
        typeInto(handle, ' ')
        expect(countNodes(editor.state.doc, 'slashCommand')).toBe(0)
        // 尾部空段落是 TrailingNode 的默认行为（块级文档末尾补段落），与原子化无关
        expect(handle.current!.getText().trim()).toBe('/compact')
    })

    it('行内 code 内不原子化', async () => {
        const { handle, ready } = setup()
        await ready()
        const editor = handle.current!.getEditor()!
        editor.commands.setContent({
            type: 'doc',
            content: [{
                type: 'paragraph',
                content: [{ type: 'text', marks: [{ type: 'code' }], text: '/compact' }],
            }],
        })
        handle.current!.setCursorOffset(8)
        typeInto(handle, ' ')
        expect(countNodes(editor.state.doc, 'slashCommand')).toBe(0)
        expect(handle.current!.getText()).toBe('/compact ')
    })

    it('粘贴 /cmd → 单个原子节点（paste rule 不重复插入）', async () => {
        const { handle, ready } = setup()
        await ready()
        const editor = handle.current!.getEditor()!
        const tr = editor.state.tr.insertText('/compact 参数', 1)
        tr.setMeta('uiEvent', 'paste')
        editor.view.dispatch(tr)
        expect(countNodes(editor.state.doc, 'slashCommand')).toBe(1)
        expect(handle.current!.getText()).toBe('/compact 参数')
    })

    it('面板选中（replaceTextRangeWithAtom）：前导空格收进节点、光标落节点后', async () => {
        const { handle, ready } = setup()
        await ready()
        handle.current!.setText('foo /han')
        const ok = handle.current!.replaceTextRangeWithAtom(
            3,
            8,
            slashCommandNodeJSON({ command: 'hand', leadingSpace: true, trailingSpace: true }),
        )
        expect(ok).toBe(true)
        expect(countNodes(handle.current!.getEditor()!.state.doc, 'slashCommand')).toBe(1)
        expect(handle.current!.getText()).toBe('foo /hand ')
        handle.current!.insertAtCursor('X')
        expect(handle.current!.getText()).toBe('foo /hand X')
    })

    it('结构化快照（editorStateJSON）可恢复原子节点', async () => {
        const { handle, ready } = setup()
        await ready()
        typeInto(handle, '/compact ')
        const json = handle.current!.getEditorStateJSON()
        handle.current!.setText('')
        handle.current!.setEditorStateJSON(json)
        expect(countNodes(handle.current!.getEditor()!.state.doc, 'slashCommand')).toBe(1)
        expect(handle.current!.getText()).toBe('/compact ')
    })

    it('getHTML 序列化不抛错且带 data 属性（剪贴板 HTML 路径）', async () => {
        const { handle, ready } = setup()
        await ready()
        typeInto(handle, '/compact ')
        const html = handle.current!.getEditor()!.getHTML()
        expect(html).toContain('data-slash-command="compact"')
    })
})
