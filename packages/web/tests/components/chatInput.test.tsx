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
import { ChatInput, type ChatInputHandle, type ChatInputProps } from '@/ui/base/interactive/chat-input'

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

describe('ChatInput', () => {
    it('非程序化内容变化 → onUpdate({ text, programmatic: false })', async () => {
        const onUpdate = vi.fn()
        const { handle, ready } = setup({ onUpdate })
        await ready()
        handle.current!.insertAtCursor('ab')
        expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'ab', programmatic: false }))
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
})
