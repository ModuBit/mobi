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

import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import {
    ChatInput,
    ChatInputQuoteNode,
    CHAT_INPUT_QUOTE_NODE_NAME,
    type ChatInputHandle,
    type ChatInputProps,
} from '@/ui/base/interactive/chat-input'
import {
    addQuoteToEditor,
    clearQuotesInEditor,
    collectQuotesFromDoc,
    extractWireText,
    insertQuotesAtEnd,
    updateQuoteCommentInEditor,
} from '@/ui/base/interactive/chat-input/chatInputQuoteDoc'
import { __resetDraftCacheForTesting, getDraft, saveDraft } from '@/core/lib/composerDrafts'

// vitest 未开 globals：渲染型测试需显式 cleanup
afterEach(cleanup)

const QUOTE = { messageId: 'm1', role: 'agent' as const, excerpt: '原文片段' }

/** 测试壳：装配引用节点；ready 后返回 editor（doc 级操作入口） */
function setup(props: Partial<ChatInputProps> = {}) {
    const handleRef: { current: ChatInputHandle | null } = { current: null }
    render(
        <ChatInput {...props} extraNodes={[ChatInputQuoteNode]} ref={(h) => { handleRef.current = h }} />,
    )
    const pm = () => document.querySelector('.ProseMirror') as HTMLElement
    const ready = () =>
        waitFor(() => {
            expect(pm()).toBeInTheDocument()
            expect(handleRef.current?.getEditor()).toBeTruthy()
        })
    /** 往编辑器派发 keydown（走 ProseMirror keymap 的 addKeyboardShortcuts 通道） */
    const press = (key: string) => {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        pm().dispatchEvent(event)
        return event
    }
    /** 光标移到 chip 之后（addQuoteToEditor 插入的尾随空格之前） */
    const cursorAfterQuote = (editor: Editor) => {
        let pos: number | null = null
        editor.state.doc.descendants((node, p) => {
            if (pos == null && node.type.name === CHAT_INPUT_QUOTE_NODE_NAME) {
                pos = p + node.nodeSize
                return false
            }
            return true
        })
        expect(pos).not.toBeNull()
        editor.commands.setTextSelection(pos!)
    }
    return { handle: handleRef, pm, ready, press, cursorAfterQuote }
}

describe('ChatInputQuoteNode（引用 chip 节点）', () => {
    it('addQuoteToEditor → chip 渲染 + 文档收集 + onUpdate extraNodeCount/文本降级同源', async () => {
        const onUpdate = vi.fn()
        const { handle, ready } = setup({ onUpdate })
        await ready()
        const editor = handle.current!.getEditor()!

        const entry = addQuoteToEditor(editor, QUOTE)
        expect(entry).not.toBeNull()
        // NodeView 为 React 渲染，插入后异步挂载
        await waitFor(() => {
            expect(document.querySelector('[data-testid="chat-input-quote-chip"]')).toBeInTheDocument()
        })

        // 文档顺序收集：uid 由 withQuoteUid 补，其余 attrs 原样
        const collected = collectQuotesFromDoc(editor.state.doc)
        expect(collected).toHaveLength(1)
        expect(collected[0]).toMatchObject({ ...QUOTE, uid: entry!.uid })

        // renderText 降级：「excerpt」进 getText（canSend/面板检测与纯文本同源）
        expect(handle.current!.getText()).toBe('「原文片段」 ')
        expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ extraNodeCount: 1 }))
    })

    it('去重与上限：同消息同文本不重复插入；达 QUOTE_MAX_COUNT 返回 null', async () => {
        const { handle, ready } = setup()
        await ready()
        const editor = handle.current!.getEditor()!

        const first = addQuoteToEditor(editor, QUOTE)
        const dup = addQuoteToEditor(editor, QUOTE)
        expect(dup!.uid).toBe(first!.uid)
        expect(collectQuotesFromDoc(editor.state.doc)).toHaveLength(1)

        // 上限 5：补足至 5 条后第 6 条被拒
        for (let i = 2; i <= 5; i++) {
            addQuoteToEditor(editor, { ...QUOTE, excerpt: `片段${i}` })
        }
        expect(collectQuotesFromDoc(editor.state.doc)).toHaveLength(5)
        expect(addQuoteToEditor(editor, { ...QUOTE, excerpt: '溢出' })).toBeNull()
        expect(collectQuotesFromDoc(editor.state.doc)).toHaveLength(5)
    })

    it('Backspace 两段式：第一次选中 chip 不改内容，第二次整体删除', async () => {
        const { handle, ready, press, cursorAfterQuote } = setup()
        await ready()
        const editor = handle.current!.getEditor()!
        addQuoteToEditor(editor, QUOTE)
        cursorAfterQuote(editor)

        // 第一段：NodeSelection（视觉高亮），内容不变
        press('Backspace')
        await waitFor(() => {
            expect(document.querySelector('[data-testid="chat-input-quote-chip"]')).toHaveAttribute('data-selected', 'true')
        })
        expect(collectQuotesFromDoc(editor.state.doc)).toHaveLength(1)

        // 第二段：ProseMirror 默认删除 NodeSelection
        press('Backspace')
        await waitFor(() => {
            expect(document.querySelector('[data-testid="chat-input-quote-chip"]')).not.toBeInTheDocument()
        })
        expect(collectQuotesFromDoc(editor.state.doc)).toHaveLength(0)
    })

    it('updateQuoteCommentInEditor：按 uid 更新/清空 attrs；未命中返回 false', async () => {
        const { handle, ready } = setup()
        await ready()
        const editor = handle.current!.getEditor()!
        const entry = addQuoteToEditor(editor, QUOTE)!
        await waitFor(() => {
            expect(document.querySelector('[data-testid="chat-input-quote-chip"]')).not.toHaveTextContent('✎')
        })

        expect(updateQuoteCommentInEditor(editor, entry.uid, '是什么意思？')).toBe(true)
        expect(collectQuotesFromDoc(editor.state.doc)[0]!.comment).toBe('是什么意思？')
        await waitFor(() => {
            expect(document.querySelector('[data-testid="chat-input-quote-chip"]')).toHaveTextContent('✎')
        })

        // undefined = 清空（attrs 落 null，收集侧不收该字段）
        expect(updateQuoteCommentInEditor(editor, entry.uid, undefined)).toBe(true)
        expect(collectQuotesFromDoc(editor.state.doc)[0]).not.toHaveProperty('comment')

        expect(updateQuoteCommentInEditor(editor, 'missing-uid', 'x')).toBe(false)
    })

    it('clearQuotesInEditor 倒序删全部；insertQuotesAtEnd 回填带尾随空格', async () => {
        const { handle, ready } = setup()
        await ready()
        const editor = handle.current!.getEditor()!
        addQuoteToEditor(editor, QUOTE)
        addQuoteToEditor(editor, { ...QUOTE, excerpt: '第二段' })
        expect(clearQuotesInEditor(editor)).toBe(2)
        expect(collectQuotesFromDoc(editor.state.doc)).toHaveLength(0)
        // 仅删 chip 节点，其尾随空格残留（正文由用户自己管理）
        expect(handle.current!.getText().trim()).toBe('')

        handle.current!.setText('')
        insertQuotesAtEnd(editor, [QUOTE, { ...QUOTE, excerpt: '第二段' }])
        expect(collectQuotesFromDoc(editor.state.doc).map((q) => q.excerpt)).toEqual(['原文片段', '第二段'])
        expect(handle.current!.getText()).toBe('「原文片段」 「第二段」 ')
    })

    it('extractWireText：wire 正文剥掉 chip 降级文本（引用由 quote block 承载，不重复）', async () => {
        const { handle, ready } = setup()
        await ready()
        const editor = handle.current!.getEditor()!
        addQuoteToEditor(editor, QUOTE)
        handle.current!.insertAtCursor('正文')
        // 编辑器内视图：chip 有降级文本（光标/面板语义）……
        expect(handle.current!.getText()).toBe('「原文片段」 正文')
        // ……wire 正文不含它；多段分隔与 getText 同语义
        expect(extractWireText(editor.state.doc)).toBe(' 正文')
        editor.commands.splitBlock()
        editor.commands.insertContent('第二段')
        expect(extractWireText(editor.state.doc)).toBe(' 正文\n第二段')
        // NBSP（行尾空格在模型里的形态）同样归一回普通空格
        editor.commands.insertContent('\u00a0')
        expect(extractWireText(editor.state.doc)).toBe(' 正文\n第二段 ')
    })

    it('草稿双路 round-trip：含 chip（含评论）的 EditorState JSON 恢复', async () => {
        const first = setup()
        await first.ready()
        const editor = first.handle.current!.getEditor()!
        const entry = addQuoteToEditor(editor, QUOTE)!
        updateQuoteCommentInEditor(editor, entry.uid, '批注')
        first.handle.current!.insertAtCursor('正文')
        const text = first.handle.current!.getText()
        const json = first.handle.current!.getEditorStateJSON()

        // 持久化 → 冷读（绕过内存 cache，走 sessionStorage 校验路径）
        __resetDraftCacheForTesting()
        saveDraft('s-quote', { text, files: [], images: [], quotes: [], editorState: { v: 1, json } })
        __resetDraftCacheForTesting()
        const restored = getDraft('s-quote')!
        expect(restored.editorState?.json).toBe(json)
        cleanup()

        // 新编辑器按双路顺序恢复：setText 兜底 → setEditorStateJSON 覆盖（chip + 评论随文档回来）
        const second = setup()
        await second.ready()
        second.handle.current!.setText(restored.text)
        second.handle.current!.setEditorStateJSON(restored.editorState!.json)
        expect(collectQuotesFromDoc(second.handle.current!.getEditor()!.state.doc)).toEqual([
            { ...QUOTE, uid: entry.uid, comment: '批注' },
        ])
        expect(second.handle.current!.getText()).toBe(text)
    })
})
