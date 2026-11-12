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
import type { Node as PMNode } from '@tiptap/pm/model'
import '@testing-library/jest-dom/vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import { ChatInput, type ChatInputHandle, type ChatInputProps } from '@/ui/base/interactive/chat-input'
import { resolveNewlineAction, type NewlineAction } from '@/ui/base/interactive/chat-input/newlinePolicy'
import { __resetDraftCacheForTesting, getDraft, saveDraft } from '@/core/lib/composerDrafts'
import { emptySegments, isSegmentEmpty } from '@/domain/chat/composerSegments'

/** 统计 doc 中某节点类型的出现次数 */
function countNodes(doc: PMNode, typeName: string): number {
    let count = 0
    doc.descendants((node) => { if (node.type.name === typeName) count++ })
    return count
}

// vitest 未开 globals：渲染型测试需显式 cleanup，否则 DOM 累积致 querySelector 命中前一个用例的节点
afterEach(cleanup)

/**
 * 测试壳：持 handle 引用 + 键位派发助手。
 * useEditor(immediatelyRender:false) 异步挂载——所有操作前先 waitFor 编辑器就绪。
 */
function setup(props: Partial<ChatInputProps> = {}) {
    const handleRef: { current: ChatInputHandle | null } = { current: null }
    const utils = render(
        <ChatInput {...props} ref={(h: ChatInputHandle | null) => { handleRef.current = h }} />,
    )
    const pm = () => document.querySelector('.ProseMirror') as HTMLElement
    const ready = () =>
        waitFor(() => {
            expect(pm()).toBeInTheDocument()
            expect(handleRef.current).not.toBeNull()
        })
    // 往编辑器派发 keydown（jsdom 的 keyCode/isComposing 需手动补齐）
    const typeKey = (init: KeyboardEventInit & { keyCode?: number }) => {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
        if (init.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: init.keyCode })
        if (init.isComposing !== undefined) Object.defineProperty(event, 'isComposing', { value: init.isComposing })
        pm().dispatchEvent(event)
        return event
    }
    return { ...utils, handle: handleRef, pm, ready, typeKey }
}

/**
 * 模拟逐字输入：先走 ProseMirror 的 handleTextInput（输入规则所在钩子），
 * 未命中再普通插入。jsdom 无法触发真实 beforeinput，这是规则层最接近的缝。
 */
function typeInto(handle: { current: ChatInputHandle | null }, text: string) {
    const editor = handle.current!.getEditor()!
    const view = editor.view
    for (const ch of text) {
        const { from, to } = view.state.selection
        const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch))
        if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
    }
}

describe('ChatInput', () => {
    it('非程序化内容变化 → onUpdate({ text, programmatic: false })', async () => {
        const onUpdate = vi.fn()
        const { handle, ready } = setup({ onUpdate })
        await ready()
        handle.current!.insertAtCursor('ab')
        expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'ab', programmatic: false }))
    })

    it('NBSP 归一：contenteditable 行尾空格（\\u00a0）在 getText / onUpdate 中落普通空格', async () => {
        const onUpdate = vi.fn()
        const { handle, ready } = setup({ onUpdate })
        await ready()
        // 真实浏览器里行尾空格在模型中是 NBSP（DOM 落盘产物）；消费方判定按普通空格语义
        handle.current!.getEditor()!.commands.insertContent('!\u00a0')
        expect(handle.current!.getText()).toBe('! ')
        expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ text: '! ' }))
    })

    it('setText → onUpdate({ text, programmatic: true }) 且 getText 同步', async () => {
        const onUpdate = vi.fn()
        const { handle, ready } = setup({ onUpdate })
        await ready()
        handle.current!.setText('x')
        expect(handle.current!.getText()).toBe('x')
        expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'x', programmatic: true }))
    })

    it('setText 不入 undo 栈：Cmd+Z 不回滚内容', async () => {
        const { handle, ready, typeKey } = setup()
        await ready()
        handle.current!.setText('x')
        typeKey({ key: 'z', metaKey: true })
        expect(handle.current!.getText()).toBe('x')
    })

    it("Enter（submitKey='enter'）→ onSubmit 调用且不产生新段落", async () => {
        const onSubmit = vi.fn()
        const { handle, ready, typeKey } = setup({ onSubmit })
        await ready()
        handle.current!.setText('ab')
        typeKey({ key: 'Enter' })
        expect(onSubmit).toHaveBeenCalledTimes(1)
        expect(handle.current!.getText()).toBe('ab')
    })

    it("shift+Enter（submitKey='enter'）→ 不提交，文本多一段（'\\n' 分隔）", async () => {
        const onSubmit = vi.fn()
        const { handle, ready, typeKey } = setup({ onSubmit })
        await ready()
        handle.current!.setText('ab')
        typeKey({ key: 'Enter', shiftKey: true })
        expect(onSubmit).not.toHaveBeenCalled()
        expect(handle.current!.getText()).toBe('ab\n')
    })

    it("submitKey='shiftEnter'：shift+Enter 提交、裸 Enter 换行", async () => {
        const onSubmit = vi.fn()
        const { handle, ready, typeKey } = setup({ onSubmit, submitKey: 'shiftEnter' })
        await ready()
        handle.current!.setText('ab')
        typeKey({ key: 'Enter', shiftKey: true })
        expect(onSubmit).toHaveBeenCalledTimes(1)
        handle.current!.setText('ab')
        typeKey({ key: 'Enter' })
        expect(onSubmit).toHaveBeenCalledTimes(1)
        expect(handle.current!.getText()).toBe('ab\n')
    })

    it('IME：isComposing=true 或 keyCode=229 时 Enter 不触发 onSubmit', async () => {
        const onSubmit = vi.fn()
        const { handle, ready, typeKey } = setup({ onSubmit })
        await ready()
        handle.current!.setText('ab')
        typeKey({ key: 'Enter', isComposing: true })
        typeKey({ key: 'Enter', keyCode: 229 })
        expect(onSubmit).not.toHaveBeenCalled()
    })

    it('IME 守卫先于消费方：组合中的按键不交给 onKeyDown（否则面板吞掉候选词确认）', async () => {
        const onKeyDown = vi.fn(() => true)
        const { ready, typeKey } = setup({ onKeyDown })
        await ready()
        typeKey({ key: 'Enter', isComposing: true })
        typeKey({ key: 'Escape', keyCode: 229 })
        expect(onKeyDown).not.toHaveBeenCalled()

        typeKey({ key: 'Enter' })
        expect(onKeyDown).toHaveBeenCalledTimes(1)
    })

    it('link / underline 扩展启用', async () => {
        const { handle, ready } = setup()
        await ready()
        const marks = handle.current!.getEditor()!.schema.marks
        expect(marks.link).toBeTruthy()
        expect(marks.underline).toBeTruthy()
    })

    it('onKeyDown 返回 true 时内置 Enter 判定被跳过', async () => {
        const onSubmit = vi.fn()
        const onKeyDown = vi.fn(() => true)
        const { handle, ready, typeKey } = setup({ onSubmit, onKeyDown })
        await ready()
        handle.current!.setText('ab')
        typeKey({ key: 'Enter' })
        expect(onKeyDown).toHaveBeenCalledTimes(1)
        expect(onSubmit).not.toHaveBeenCalled()
    })

    it('insertAtCursor 在光标处插入（setText 光标置尾 → 插入追加）', async () => {
        const { handle, ready } = setup()
        await ready()
        handle.current!.setText('ab')
        handle.current!.insertAtCursor('c')
        expect(handle.current!.getText()).toBe('abc')
    })

    it('getEditorStateJSON → setEditorStateJSON round-trip 内容恢复', async () => {
        const { handle, ready } = setup()
        await ready()
        handle.current!.setText('ab')
        const json = handle.current!.getEditorStateJSON()
        handle.current!.clear()
        expect(handle.current!.getText()).toBe('')
        handle.current!.setEditorStateJSON(json)
        expect(handle.current!.getText()).toBe('ab')
    })

    it('setEditorStateJSON 传非法 JSON 不抛且内容不变', async () => {
        const { handle, ready } = setup()
        await ready()
        handle.current!.setText('keep')
        expect(() => handle.current!.setEditorStateJSON('{not json')).not.toThrow()
        expect(handle.current!.getText()).toBe('keep')
    })

    it('setEditorStateJSON 遇 schema 不认的节点：静默保留当前文档（不降级为空 doc）', async () => {
        const { handle, ready } = setup()
        await ready()
        handle.current!.setText('keep')
        expect(() => handle.current!.setEditorStateJSON(JSON.stringify({
            type: 'doc',
            content: [{ type: 'nodeThatDoesNotExist' }],
        }))).not.toThrow()
        expect(handle.current!.getText()).toBe('keep')
    })

    it('replaceTextRange：按纯文本区间替换并保留前后内容', async () => {
        const { handle, ready } = setup()
        await ready()
        handle.current!.setText('abcdef')
        handle.current!.replaceTextRange(2, 4, 'XY')
        expect(handle.current!.getText()).toBe('abXYef')
        // 光标落在替换段之后（offset 4），继续输入不跳到末尾
        handle.current!.insertAtCursor('!')
        expect(handle.current!.getText()).toBe('abXY!ef')
    })

    it('replaceTextRange 走程序化通道：onUpdate 标 programmatic', async () => {
        const onUpdate = vi.fn()
        const { handle, ready } = setup({ onUpdate })
        await ready()
        handle.current!.setText('ab')
        handle.current!.replaceTextRange(1, 2, 'X')
        expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'aX', programmatic: true }))
    })

    it('disabled → 编辑器不可编辑（contenteditable=false）', async () => {
        const { pm, ready } = setup({ disabled: true })
        await ready()
        await waitFor(() => expect(pm()).toHaveAttribute('contenteditable', 'false'))
    })

    it('placeholder：空态渲染 is-editor-empty，有内容消失', async () => {
        const { handle, ready } = setup({ placeholder: '说点什么…' })
        await ready()
        expect(document.querySelector('.ProseMirror p.is-editor-empty')).not.toBeNull()
        handle.current!.setText('x')
        expect(document.querySelector('.ProseMirror p.is-editor-empty')).toBeNull()
    })

    it('onUpdate ctx 携带 cursorOffset（光标前文本长度）', async () => {
        const onUpdate = vi.fn()
        const { handle, ready } = setup({ onUpdate })
        await ready()
        handle.current!.setText('abc') // 写入后光标置尾
        expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ cursorOffset: 3 }))
    })

    it('setCursorOffset 定位光标 → insertAtCursor 落点正确', async () => {
        const { handle, ready } = setup()
        await ready()
        handle.current!.setText('ab')
        handle.current!.setCursorOffset(1) // 光标到 'a' 之后
        handle.current!.insertAtCursor('X')
        expect(handle.current!.getText()).toBe('aXb')
    })

    it('setCursorOffset 越界/空文档不抛（置尾）', async () => {
        const { handle, ready } = setup()
        await ready()
        expect(() => handle.current!.setCursorOffset(99)).not.toThrow()
        handle.current!.insertAtCursor('!')
        expect(handle.current!.getText()).toBe('!')
    })

    it('onReady：编辑器就绪后回调一次', async () => {
        const onReady = vi.fn()
        const { ready } = setup({ onReady })
        await ready()
        await new Promise((r) => setTimeout(r, 50))
        expect(onReady).toHaveBeenCalledTimes(1)
    })

    describe('富文本行内 marks（票 01）', () => {
        it('schema 启用行内 marks（bold/italic/strike/code）', async () => {
            const { handle, ready } = setup()
            await ready()
            const marks = handle.current!.getEditor()!.schema.marks
            expect(marks.bold).toBeTruthy()
            expect(marks.italic).toBeTruthy()
            expect(marks.strike).toBeTruthy()
            expect(marks.code).toBeTruthy()
        })

        it('输入 **abc** → 粗体 mark，wire 为 **abc**', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, '**abc**')
            const editor = handle.current!.getEditor()!
            expect(editor.getHTML()).toContain('<strong>abc</strong>')
            expect(handle.current!.getWireText()).toBe('**abc**')
            // 纯文本出口不带语法符号（canSend/bash/mention 依赖）
            expect(handle.current!.getText()).toBe('abc')
        })

        it('输入 *abc* → 斜体 mark，wire 为 *abc*', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, '*abc*')
            expect(handle.current!.getEditor()!.getHTML()).toContain('<em>abc</em>')
            expect(handle.current!.getWireText()).toBe('*abc*')
        })

        it('输入 ~~abc~~ → 删除线 mark，wire 为 ~~abc~~', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, '~~abc~~')
            expect(handle.current!.getEditor()!.getHTML()).toContain('<s>abc</s>')
            expect(handle.current!.getWireText()).toBe('~~abc~~')
        })

        it('输入 `abc` → 行内代码 mark，wire 为 `abc`', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, '`abc`')
            expect(handle.current!.getEditor()!.getHTML()).toContain('<code>abc</code>')
            expect(handle.current!.getWireText()).toBe('`abc`')
        })

        it('Cmd/Ctrl+B 切换粗体', async () => {
            const { handle, ready, typeKey } = setup()
            await ready()
            handle.current!.setText('abc')
            handle.current!.getEditor()!.commands.selectAll()
            // jsdom 的 navigator.platform 不是 mac，prosemirror-keymap 把 Mod- 解析为 Ctrl-
            typeKey({ key: 'b', ctrlKey: true })
            expect(handle.current!.getEditor()!.getHTML()).toContain('<strong>abc</strong>')
            expect(handle.current!.getWireText()).toBe('**abc**')
        })

        it('空文档 wire 为空字符串', async () => {
            const { handle, ready } = setup()
            await ready()
            expect(handle.current!.getWireText()).toBe('')
        })
    })

    describe('富文本块级结构（票 02）', () => {
        it('schema 启用块级节点（heading h1–h3 / 列表 / 引用 / 代码块）', async () => {
            const { handle, ready } = setup()
            await ready()
            const nodes = handle.current!.getEditor()!.schema.nodes
            expect(nodes.heading).toBeTruthy()
            expect(nodes.bulletList).toBeTruthy()
            expect(nodes.orderedList).toBeTruthy()
            expect(nodes.blockquote).toBeTruthy()
            expect(nodes.codeBlock).toBeTruthy()
        })

        it('输入 "# abc" → h1，wire 为 "# abc"', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, '# abc')
            expect(handle.current!.getEditor()!.getHTML()).toContain('<h1>abc</h1>')
            // Markdown 序列化约定末尾带块分隔空行：wire 断言按内容比较
            expect(handle.current!.getWireText().trimEnd()).toBe('# abc')
        })

        it('输入 "#### abc" → 不转标题（级别限 h1–h3），保留字面量', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, '#### abc')
            const html = handle.current!.getEditor()!.getHTML()
            expect(html).not.toContain('<h4')
            expect(handle.current!.getText()).toBe('#### abc')
        })

        it('输入 "- abc" → 无序列表，wire 为 "- abc"', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, '- abc')
            expect(handle.current!.getEditor()!.getHTML()).toContain('<ul>')
            expect(handle.current!.getWireText()).toMatch(/^-\s+abc$/m)
        })

        it('输入 "1. abc" → 有序列表，wire 为 "1. abc"', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, '1. abc')
            expect(handle.current!.getEditor()!.getHTML()).toContain('<ol>')
            expect(handle.current!.getWireText()).toMatch(/^1\.\s+abc$/m)
        })

        it('输入 "> abc" → 引用块，wire 为 "> abc"', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, '> abc')
            expect(handle.current!.getEditor()!.getHTML()).toContain('<blockquote>')
            expect(handle.current!.getWireText()).toMatch(/^>\s+abc$/m)
        })

        it('输入 "```js " → 代码块（language-js），wire 为围栏代码', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, '```js ')
            typeInto(handle, 'a')
            const html = handle.current!.getEditor()!.getHTML()
            expect(html).toContain('<pre><code class="language-js">')
            expect(handle.current!.getWireText()).toMatch(/^```js$/m)
        })

        it('代码块按围栏语言着色（lowlight 装饰，不进 wire）', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, '```js ')
            typeInto(handle, 'const a = 1')
            const editor = handle.current!.getEditor()!
            // hljs token 是 Decoration（只进视图），wire 仍是纯围栏文本
            expect(editor.view.dom.querySelector('pre code .hljs-keyword')?.textContent).toBe('const')
            expect(handle.current!.getWireText().trimEnd()).toBe('```js\nconst a = 1\n```')
        })

        it('列表项内 Shift+Enter → 新建列表项（不退出列表）', async () => {
            const onSubmit = vi.fn()
            const { handle, ready, typeKey } = setup({ onSubmit })
            await ready()
            typeInto(handle, '- abc')
            typeKey({ key: 'Enter', shiftKey: true })
            expect(onSubmit).not.toHaveBeenCalled()
            const doc = handle.current!.getEditor()!.state.doc
            expect(countNodes(doc, 'listItem')).toBe(2)
        })

        it('空列表项再 Shift+Enter → 退出列表，光标落到外部段落', async () => {
            const { handle, ready, typeKey } = setup()
            await ready()
            typeInto(handle, '- abc')
            typeKey({ key: 'Enter', shiftKey: true })
            typeKey({ key: 'Enter', shiftKey: true })
            const editor = handle.current!.getEditor()!
            expect(countNodes(editor.state.doc, 'listItem')).toBe(1)            // 列表之后的普通段落（lift 后光标所在块）
            expect(editor.state.selection.$from.parent.type.name).toBe('paragraph')
            typeInto(handle, 'x')
            expect(handle.current!.getWireText()).toMatch(/^- abc$/m)
            expect(handle.current!.getWireText()).toMatch(/^x$/m)
        })

        it('代码块内 Shift+Enter → 块内换行（仍是单一代码块）', async () => {
            const { handle, ready, typeKey } = setup()
            await ready()
            typeInto(handle, '```js ')
            typeInto(handle, 'a')
            typeKey({ key: 'Enter', shiftKey: true })
            typeInto(handle, 'b')
            const ed = handle.current!.getEditor()!
            expect(countNodes(ed.state.doc, 'codeBlock')).toBe(1)
            expect(ed.state.selection.$from.parent.type.name).toBe('codeBlock')
            expect(handle.current!.getWireText()).toContain('a\nb')
        })

        it('标题末尾 Shift+Enter → 落到普通段落（不产生连续标题）', async () => {
            const { handle, ready, typeKey } = setup()
            await ready()
            typeInto(handle, '# abc')
            typeKey({ key: 'Enter', shiftKey: true })
            typeInto(handle, 'x')
            const ed = handle.current!.getEditor()!
            expect(countNodes(ed.state.doc, 'heading')).toBe(1)
            expect(ed.state.selection.$from.parent.type.name).toBe('paragraph')
            expect(handle.current!.getWireText().trimEnd()).toBe('# abc\n\nx')
        })

        it('普通段落 Shift+Enter → 新段落', async () => {
            const { handle, ready, typeKey } = setup()
            await ready()
            typeInto(handle, 'ab')
            typeKey({ key: 'Enter', shiftKey: true })
            typeInto(handle, 'cd')
            expect(handle.current!.getText()).toBe('ab\ncd')
        })

        it("触屏语义（submitKey='shiftEnter'）：列表内裸 Enter 换行而非提交", async () => {
            const onSubmit = vi.fn()
            const { handle, ready, typeKey } = setup({ onSubmit, submitKey: 'shiftEnter' })
            await ready()
            typeInto(handle, '- abc')
            typeKey({ key: 'Enter' })
            expect(onSubmit).not.toHaveBeenCalled()
            const doc = handle.current!.getEditor()!.state.doc
            expect(countNodes(doc, 'listItem')).toBe(2)
        })

        it('代码块内 Tab 插入两空格、Shift+Tab 退掉行首缩进', async () => {
            const { handle, ready, typeKey } = setup()
            await ready()
            typeInto(handle, '```js ')
            typeKey({ key: 'Tab' })
            typeInto(handle, 'a')
            expect(handle.current!.getEditor()!.state.doc.textContent).toBe('  a')
            typeKey({ key: 'Tab', shiftKey: true })
            expect(handle.current!.getEditor()!.state.doc.textContent).toBe('a')
        })

        it('列表内 Tab 不被代码块逻辑吞掉（放行给列表缩进）', async () => {
            const { handle, ready, typeKey } = setup()
            await ready()
            typeInto(handle, '- abc')
            const event = typeKey({ key: 'Tab' })
            expect(event.defaultPrevented).toBe(false)
        })

        describe('resolveNewlineAction（纯函数）', () => {
            /**
             * 直接构造 editor state 断言分流结果：显式把光标放进目标类型的首个文本块。
             * 不能用 focus('end')——setContent 会追加 TrailingNode 空段落，末尾必是段落。
             */
            async function actionAt(
                html: string,
                cursor: { type: string; empty?: boolean },
            ): Promise<NewlineAction> {
                const { handle, ready } = setup()
                await ready()
                const ed = handle.current!.getEditor()!
                ed.commands.setContent(html, { emitUpdate: false })
                let pos: number | null = null
                ed.state.doc.descendants((node, p) => {
                    if (pos != null || node.type.name !== cursor.type) return true
                    const isEmpty = node.content.size === 0
                    if (isEmpty !== (cursor.empty === true)) return true
                    pos = isEmpty ? p + 1 : p + node.nodeSize - 1
                    return false
                })
                expect(pos).not.toBeNull()
                ed.commands.setTextSelection(pos!)
                const action = resolveNewlineAction(ed.state)
                cleanup()
                return action
            }

            it('段落 → splitBlock', async () => {
                expect(await actionAt('<p>abc</p>', { type: 'paragraph' })).toBe('splitBlock')
            })

            it('标题 → exitHeading', async () => {
                expect(await actionAt('<h1>abc</h1>', { type: 'heading' })).toBe('exitHeading')
            })

            it('非空列表项 → splitListItem', async () => {
                expect(await actionAt('<ul><li><p>abc</p></li></ul>', { type: 'paragraph' })).toBe('splitListItem')
            })

            it('空列表项 → liftListItem', async () => {
                expect(await actionAt(
                    '<ul><li><p>abc</p></li><li><p></p></li></ul>',
                    { type: 'paragraph', empty: true },
                )).toBe('liftListItem')
            })

            it('代码块 → newlineInCode', async () => {
                expect(await actionAt('<pre><code>abc</code></pre>', { type: 'codeBlock' })).toBe('newlineInCode')
            })
        })
    })

    describe('粘贴管线（票 03）', () => {
        /**
         * 构造可控 paste 事件：jsdom 无 ClipboardEvent/DataTransfer 实现，
         * clipboardData 用最小桩（getData + items），ProseMirror 只读这两个字段。
         */
        function pasteInto(data: { text?: string; html?: string; files?: File[] }) {
            const pm = document.querySelector('.ProseMirror') as HTMLElement
            const items = (data.files ?? []).map((file) => ({
                kind: 'file',
                type: file.type,
                getAsFile: () => file,
            }))
            const event = new Event('paste', { bubbles: true, cancelable: true })
            Object.defineProperty(event, 'clipboardData', {
                value: {
                    types: [...(data.html ? ['text/html'] : []), 'text/plain'],
                    getData: (type: string) => {
                        if (type === 'text/html') return data.html ?? ''
                        if (type === 'text/plain') return data.text ?? ''
                        return ''
                    },
                    items,
                },
            })
            pm.dispatchEvent(event)
            return event
        }

        it('HTML 富文本粘贴 → 走 schema 解析（粗体保留）', async () => {
            const { handle, ready } = setup()
            await ready()
            pasteInto({ html: '<p><strong>abc</strong></p>', text: 'abc' })
            expect(handle.current!.getEditor()!.getHTML()).toContain('<strong>abc</strong>')
            expect(handle.current!.getWireText()).toContain('**abc**')
        })

        it('HTML 表格粘贴 → 保留表格并序列化为 GFM 表格', async () => {
            const { handle, ready } = setup()
            await ready()
            pasteInto({
                html: '<table><tbody><tr><th>H</th></tr><tr><td>1</td></tr></tbody></table>',
                text: 'H\n1',
            })
            const ed = handle.current!.getEditor()!
            expect(ed.getHTML()).toContain('<table')
            expect(handle.current!.getWireText()).toMatch(/\|\s*H\s*\|/)
        })

        it('Markdown 块级文本粘贴 → 转为富文本（标题/列表）', async () => {
            const { handle, ready } = setup()
            await ready()
            handle.current!.insertAtCursor('前缀')
            const event = pasteInto({ text: '# 标题\n\n- 一\n- 二' })
            expect(event.defaultPrevented).toBe(true)
            const html = handle.current!.getEditor()!.getHTML()
            expect(html).toContain('<h1>标题</h1>')
            expect(html).toContain('<ul>')
            // 前缀保留（就点插入，不整档替换）
            expect(handle.current!.getText()).toContain('前缀')
        })

        it('行内 Markdown（无块级结构）→ 原样纯文本，不渲染', async () => {
            const { handle, ready } = setup()
            await ready()
            // 成对标记也须字面保留：StarterKit 的 bold/italic/strike paste rule 若生效，
            // 这里会出现 <strong>/<em>/<s>（代码粘贴被误渲染）
            const literal = 'const a = 2 ** 3; // *beta* ~~gamma~~'
            pasteInto({ text: literal })
            expect(handle.current!.getText()).toBe(literal)
            const html = handle.current!.getEditor()!.getHTML()
            expect(html).not.toContain('<strong>')
            expect(html).not.toContain('<em>')
            expect(html).not.toContain('<s>')
        })

        it('粘贴裸 URL → 仍是链接（link 的 paste rule 保留）', async () => {
            const { handle, ready } = setup()
            await ready()
            pasteInto({ text: 'https://example.com' })
            expect(handle.current!.getEditor()!.getHTML()).toContain('href="https://example.com"')
        })

        it('附件钩子优先：onPaste 返回 true 时正文不变（文件粘贴不走富文本）', async () => {
            const onPaste = vi.fn((e: ClipboardEvent) => {
                e.preventDefault()
                return true
            })
            const { handle, ready } = setup({ onPaste })
            await ready()
            const file = new File(['x'], 'a.png', { type: 'image/png' })
            const event = pasteInto({ files: [file], text: 'ignored' })
            expect(onPaste).toHaveBeenCalledTimes(1)
            expect(event.defaultPrevented).toBe(true)
            expect(handle.current!.getText()).toBe('')
        })
    })

    describe('链接 + 下划线（票 04）', () => {
        it('输入 [mobi](url) → 链接 mark，wire 为 [mobi](url)', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, '[mobi](https://example.com)')
            const ed = handle.current!.getEditor()!
            expect(ed.getHTML()).toContain('<a')
            expect(ed.getHTML()).toContain('href="https://example.com"')
            expect(handle.current!.getWireText()).toContain('[mobi](https://example.com)')
            // 纯文本出口不带语法符号
            expect(handle.current!.getText()).toBe('mobi ')
        })

        it('粘贴 URL 自动变链接（autolink）', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, 'https://example.com ')
            const ed = handle.current!.getEditor()!
            expect(ed.getHTML()).toContain('href="https://example.com"')
            expect(handle.current!.getWireText()).toContain('[https://example.com](https://example.com)')
        })

        it('Cmd/Ctrl+U 切换下划线，wire 为 <u>abc</u>', async () => {
            const { handle, ready, typeKey } = setup()
            await ready()
            handle.current!.setText('abc')
            handle.current!.getEditor()!.commands.selectAll()
            // jsdom 的 navigator.platform 不是 mac，Mod- 解析为 Ctrl-
            typeKey({ key: 'u', ctrlKey: true })
            expect(handle.current!.getEditor()!.getHTML()).toContain('<u>abc</u>')
            expect(handle.current!.getWireText()).toContain('<u>abc</u>')
        })

        it('下划线 + 粗体嵌套：wire 保留两层 mark', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, '**abc**')
            handle.current!.getEditor()!.commands.selectAll()
            handle.current!.getEditor()!.commands.toggleUnderline()
            const wire = handle.current!.getWireText()
            expect(wire).toContain('**<u>abc</u>**')
        })

        it('编辑器内点击链接不跳转（openOnClick=false）', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, '[mobi](https://example.com)')
            const anchor = document.querySelector('.ProseMirror a') as HTMLElement
            expect(anchor).toBeTruthy()
            const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
            anchor.click()
            expect(openSpy).not.toHaveBeenCalled()
            openSpy.mockRestore()
        })
    })

    describe('兼容层锁定（票 05）', () => {
        it('草稿结构化恢复保留粗体 / 列表格式', async () => {
            const first = setup()
            await first.ready()
            typeInto(first.handle, '**abc**')
            first.handle.current!.getEditor()!.commands.splitBlock()
            typeInto(first.handle, '- one')
            const text = first.handle.current!.getText()
            const json = first.handle.current!.getEditorStateJSON()

            __resetDraftCacheForTesting()
            saveDraft('s-rich', { text, files: [], images: [], quotes: [], editorState: { v: 1, json } })
            __resetDraftCacheForTesting()
            const restored = getDraft('s-rich')!
            cleanup()

            const second = setup()
            await second.ready()
            // 双路恢复顺序：setText 兜底 → setEditorStateJSON 覆盖
            second.handle.current!.setText(restored.text)
            second.handle.current!.setEditorStateJSON(restored.editorState!.json)
            const html = second.handle.current!.getEditor()!.getHTML()
            expect(html).toContain('<strong>abc</strong>')
            expect(html).toContain('<ul>')
        })

        it('replaceTextRange 只换差异段：区间外的粗体 / 列表原样保留', async () => {
            const { handle, ready } = setup()
            await ready()
            const ed = handle.current!.getEditor()!
            ed.commands.setContent(
                '<p><strong>abc</strong></p><ul><li><p>one</p></li></ul><p>tail</p>',
                { emitUpdate: false },
            )
            const text = handle.current!.getText() // 'abc\none\ntail'
            const from = text.indexOf('tail')
            handle.current!.replaceTextRange(from, from + 4, 'TAIL')

            // getText 的块分隔符会为列表嵌套层级加 '\n'：断言首尾与原文替换点即可
            const after = handle.current!.getText()
            expect(after.startsWith('abc')).toBe(true)
            expect(after.endsWith('TAIL')).toBe(true)
            expect(after).not.toContain('tail')
            const html = ed.getHTML()
            expect(html).toContain('<strong>abc</strong>')
            expect(html).toContain('<ul>')
        })

        it('空列表项（只有格式无文字）wire 为空 → 不可发送', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, '- ')
            expect(handle.current!.getWireText()).toBe('')
            expect(isSegmentEmpty({ ...emptySegments(), text: handle.current!.getWireText() })).toBe(true)
        })

        it('格式 + 文字 → wire 非空、可发送', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, '- one')
            expect(handle.current!.getWireText().trimEnd()).toBe('- one')
            expect(isSegmentEmpty({ ...emptySegments(), text: handle.current!.getWireText() })).toBe(false)
        })

        it('bash 前缀判定的纯文本出口：marks 不掺入 getText', async () => {
            const { handle, ready } = setup()
            await ready()
            typeInto(handle, '**! ls**')
            expect(handle.current!.getText()).toBe('! ls')
            expect(handle.current!.getText().startsWith('! ')).toBe(true)
        })

        it('IME 组合中不触发输入规则（** 保持字面量）', async () => {
            const { handle, ready } = setup()
            await ready()
            const ed = handle.current!.getEditor()!
            // composing 是只读派生值：用真实 composition 事件驱动 InputState
            ed.view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
            typeInto(handle, '**abc**')
            ed.view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
            expect(ed.getHTML()).not.toContain('<strong>')
            expect(handle.current!.getText()).toBe('**abc**')
        })
    })
})
