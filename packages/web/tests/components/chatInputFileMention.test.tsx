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

import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react'
import { useChatInputBridge } from '@/features/composer/useChatInputBridge'
import { useMentionInteraction, type MentionSelectionResult } from '@/features/composer/useMentionInteraction'
import { ChatInput, type ChatInputHandle } from '@/ui/base/interactive/chat-input'
import { COMPOSER_EXTRA_EXTENSIONS } from '@/features/composer/slashCommandNode'

async function setup() {
    const ref = { current: null as ChatInputHandle | null }
    const { container } = render(<ChatInput ref={ref} extraExtensions={COMPOSER_EXTRA_EXTENSIONS} />)
    await waitFor(() => expect(ref.current?.isReady()).toBe(true))
    return { input: ref.current!, editor: ref.current!.getEditor()!, container }
}

function setupPanel(input: ChatInputHandle) {
    const shellRef = { current: input }
    const { result } = renderHook(() => {
        const mention = useMentionInteraction({ target: null, searchFiles: null, listDirectory: null, workingDir: '/w' })
        const bridge = useChatInputBridge({ shellRef, mention, slash: { processChange: () => false, close: () => {} } })
        return { mention, bridge }
    })
    const select = (item: Parameters<typeof result.current.mention.selectItem>[0]) => {
        let picked: MentionSelectionResult | null = null
        act(() => { picked = result.current.mention.selectItem(item, input.getText()) })
        act(() => { result.current.bridge.applySelection(picked) })
    }
    return { result, select }
}

afterEach(cleanup)

describe('Sender 的 @ 文件引用', () => {
    it('手打引用与同一行的 slash 原子共存；路径中途可逐字删除', async () => {
        const { input, editor, container } = await setup()
        for (const ch of '/compact 看 @src/foo.ts') {
            const { from, to } = editor.state.selection
            const handled = editor.view.someProp('handleTextInput', fn => fn(editor.view, from, to, ch))
            if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to))
        }
        expect(editor.state.doc.firstChild?.firstChild?.type.name).toBe('slashCommand')
        expect(container.querySelector('.mention-file')?.textContent).toBe('@src/foo.ts')
        expect(container.querySelector('.file-mention-widget a')).toBeNull()
        input.setCursorOffset('/compact 看 @src/fo'.length)
        const pos = editor.state.selection.from
        editor.view.dispatch(editor.state.tr.delete(pos - 1, pos))
        expect(container.querySelector('.mention-file')?.textContent).toBe('@src/fo.ts')
        expect(input.getWireText()).toBe('/compact 看 @src/fo.ts')
        expect(input.getEditorStateJSON()).not.toContain('mention-file')
    })

    it('粘贴装饰文件和目录，跳过邮件与代码，不把徽章写入剪贴板', async () => {
        const { input, editor, container } = await setup()
        const text = '看@src/foo.ts @docs.v2/ a@b.com'
        editor.view.pasteText(text, new Event('paste') as ClipboardEvent)
        expect(container.querySelector('.mention-file')?.textContent).toBe('@src/foo.ts')
        expect(container.querySelector('.mention-directory:not(.file-mention-widget)')?.textContent).toBe('@docs.v2/')
        expect(container.querySelectorAll('.mention-file')).toHaveLength(1)
        editor.commands.selectAll()
        const clipboard = editor.view.serializeForClipboard(editor.state.selection.content())
        expect(clipboard.text).toBe(text)
        expect(clipboard.dom.querySelector('[data-mention-icon]')).toBeNull()
        expect(input.getWireText()).toBe('看@src/foo.ts @docs.v2/ [a@b.com](mailto:a@b.com)')
        input.setMarkdown('`@x/a.ts`\n\n```text\n@x/b.ts\n```\n\n**@x/foo**.ts')
        expect(container.querySelector('strong')?.textContent).toBe('@x/foo')
        expect(container.querySelector('.mention-directory:not(.file-mention-widget)')?.textContent).toBe('@x/foo')
        expect(container.querySelector('.mention-file')).toBeNull()
        expect(container.querySelectorAll('.file-mention-widget')).toHaveLength(1)
        expect(container.querySelector('code .mention-file')).toBeNull()
    })

    it('前文编辑改变文档坐标时，后面段落里的引用仍装饰原来的路径', async () => {
        const { input, container } = await setup()
        input.setText('开头\n看 @src/file.ts')
        expect(container.querySelector('.mention-file')?.textContent).toBe('@src/file.ts')
        input.replaceTextRange(0, 2, '改了长度的前文')
        expect(container.querySelector('.mention-file')?.textContent).toBe('@src/file.ts')
        expect(input.getWireText()).toBe('改了长度的前文\n看 @src/file.ts')
    })

    it('粘贴的标点后引用仍有徽章；图标随正文同步挂载', async () => {
        const { input, container } = await setup()
        input.setText('请看：@src/a.ts 然后复查')
        expect(container.querySelector('.mention-file')?.textContent).toBe('@src/a.ts')
        expect(container.querySelector('[data-mention-icon="file"] svg')).not.toBeNull()
    })

    it.each([
        ['看 @sr，继续测试', '看 @sr', '看 @src/a.ts ，继续测试'],
        ['@src/a-old.ts 后文', '@src/a', '@src/a.ts  后文'],
    ])('只替换 %s 中当前引用的路径', async (text, prefix, expected) => {
        const { input } = await setup()
        const { result, select } = setupPanel(input)
        input.setText(text)
        act(() => { result.current.mention.processChange(input.getText(), prefix.length) })
        select({ label: 'a.ts', value: 'a.ts', path: 'src/a.ts', isDirectory: false })
        expect(input.getText()).toBe(expected)
    })

    it('回填后旧候选不能替换新正文', async () => {
        const { input } = await setup()
        const { result, select } = setupPanel(input)
        input.setText('@verylong')
        act(() => { result.current.mention.processChange(input.getText(), input.getText().length) })
        input.setText('@x keep this')
        select({ label: 'a.ts', value: 'a.ts', path: 'src/a.ts', isDirectory: false })
        expect(input.getText()).toBe('@x keep this')
        expect(result.current.mention.isOpen).toBe(false)
    })

    it('补全替换格式化引用时保留原格式', async () => {
        const { input, container } = await setup()
        const { result, select } = setupPanel(input)
        input.setMarkdown('**@fi** tail')
        act(() => { result.current.mention.processChange(input.getText(), '@fi'.length) })
        select({ label: 'file.ts', value: 'file.ts', isDirectory: false })
        expect(container.querySelector('strong .mention-file')?.textContent).toBe('@file.ts')
        expect(input.getText()).toBe('@file.ts  tail')
        expect(input.getWireText()).toBe('**@file.ts**  tail')
    })

    it('不把无法用现有语法表示的路径当成可补全的引用', async () => {
        const { input } = await setup()
        const { result, select } = setupPanel(input)
        input.setText('@docs/My')
        act(() => { result.current.mention.processChange(input.getText(), input.getText().length) })
        select({ label: 'My Report.md', value: 'My Report.md', isDirectory: false })
        expect(input.getText()).toBe('@docs/My')
    })

    it('目录选中后继续下钻；选中的无扩展名文件使用真实类型，编辑后重新识别', async () => {
        const { input, editor, container } = await setup()
        const shellRef = { current: input }
        const { result } = renderHook(() => {
            const mention = useMentionInteraction({ target: null, searchFiles: null, listDirectory: null, workingDir: '/w' })
            const bridge = useChatInputBridge({ shellRef, mention, slash: { processChange: () => false, close: () => {} } })
            return { mention, bridge }
        })
        input.setText('@docs.v1/ 后文')
        act(() => { result.current.mention.processChange(input.getText(), '@docs'.length) })
        const select = (item: Parameters<typeof result.current.mention.selectItem>[0]) => {
            let picked: MentionSelectionResult | null = null
            act(() => { picked = result.current.mention.selectItem(item, input.getText()) })
            act(() => { result.current.bridge.applySelection(picked) })
        }
        select({ label: 'docs.v2', value: 'docs.v2', isDirectory: true })
        expect(container.querySelector('.mention-directory:not(.file-mention-widget)')?.textContent).toBe('@docs.v2/')
        expect(result.current.mention.isOpen).toBe(true)
        expect(result.current.mention.query).toBe('docs.v2/')
        select({ label: 'Caddyfile', value: 'Caddyfile', isDirectory: false })
        expect(result.current.mention.isOpen).toBe(false)
        expect(container.querySelector('.mention-file')?.textContent).toBe('@docs.v2/Caddyfile')
        expect(input.getWireText()).toContain('@docs.v2/Caddyfile')
        await waitFor(() => expect(container.querySelector('[data-mention-icon="file"] svg')).not.toBeNull())

        // 路径插入一个字符后不能沿用已选文件的类型。其他位置的编辑则保留提示。
        editor.view.dispatch(editor.state.tr.insertText('看 ', 1))
        expect(container.querySelector('.mention-file')?.textContent).toBe('@docs.v2/Caddyfile')
        input.setCursorOffset('看 @docs.v2/Ca'.length)
        editor.view.dispatch(editor.state.tr.insertText('x'))
        expect(container.querySelector('.mention-file')).toBeNull()
        expect(container.querySelector('.mention-directory:not(.file-mention-widget)')?.textContent).toBe('@docs.v2/Caxddyfile')
    })
})
