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
 * useChatInputBridge 契约（编辑器 → mention/slash 模型的换算桥）：
 * - 状态事件单出口：每次 onUpdate（含 programmatic）都先通知消费方
 * - programmatic 短路：归一写回/选中插回不得重新唤起面板、不得再写回
 * - 归一顺序：先取前值快照再比对（先覆盖再比会让顿号归一永不命中）
 * - 面板优先级：slash 命中先于 mention，命中 slash 时关闭 mention
 * - 光标重定位是桥内部事务：归一写回后恢复光标并聚焦
 */

import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ChatInputHandle } from '@/ui/base/interactive/chat-input'
import { useChatInputBridge, type TextInputCtx } from '@/features/composer/useChatInputBridge'

function makeShell() {
    return {
        setText: vi.fn(),
        setCursorOffset: vi.fn(),
        focus: vi.fn(),
    } as unknown as ChatInputHandle
}

function makePanel() {
    return {
        processChange: vi.fn(() => false),
        close: vi.fn(),
    }
}

function setup() {
    const shell = makeShell()
    const slash = makePanel()
    const mention = makePanel()
    const onUpdate = vi.fn()
    const hook = renderHook(() => useChatInputBridge({
        shellRef: { current: shell },
        slash,
        mention,
        onUpdate,
    }))
    const feed = (ctx: TextInputCtx) => hook.result.current.onTextInput(ctx)
    return { shell, slash, mention, onUpdate, feed, hook }
}

const user = (text: string, cursorOffset = text.length): TextInputCtx => ({ text, programmatic: false, cursorOffset })
const programmatic = (text: string): TextInputCtx => ({ text, programmatic: true, cursorOffset: text.length })

describe('useChatInputBridge', () => {
    it('状态事件单出口：programmatic 更新也通知消费方，但短路面板与写回', () => {
        const { shell, slash, mention, onUpdate, feed } = setup()

        feed(programmatic('/cmd '))

        expect(onUpdate).toHaveBeenCalledWith(programmatic('/cmd '))
        expect(shell.setText).not.toHaveBeenCalled()
        expect(slash.processChange).not.toHaveBeenCalled()
        expect(mention.processChange).not.toHaveBeenCalled()
    })

    it('顿号归一：先取前值快照再比对（行首手输「、」→「/」并内部恢复光标）', () => {
        const { shell, slash, mention, feed, hook } = setup()

        feed(user(''))
        feed(user('、', 1))

        expect(shell.setText).toHaveBeenCalledWith('/')
        expect(slash.processChange).toHaveBeenCalledWith('/', 1)
        expect(mention.processChange).toHaveBeenCalledWith('/', 1)

        // 写回后消费方重渲染 → 桥补光标并聚焦
        hook.rerender()
        expect(shell.setCursorOffset).toHaveBeenCalledWith(1)
        expect(shell.focus).toHaveBeenCalled()
    })

    it('前值快照吸收 programmatic 写入：程序化回填后的顿号插入仍能归一', () => {
        const { shell, feed } = setup()

        feed(programmatic('abc'))
        feed(user('、abc', 1))

        expect(shell.setText).toHaveBeenCalledWith('/abc')
    })

    it('前值以顿号开头时不重复归一（连续输入的语义保持原样）', () => {
        const { shell, feed } = setup()

        feed(user('、'))
        feed(user('、、', 2))

        // 第一次已归一为「/」；第二次前值「/」不满足「、+前值」形态，保持原值不再写回
        expect(shell.setText).toHaveBeenCalledTimes(1)
    })

    it('感叹号归一：行首「！ 」→「! 」', () => {
        const { shell, feed } = setup()

        feed(user('！ hi'))

        expect(shell.setText).toHaveBeenCalledWith('! hi')
    })

    it('slash 优先：命中时关闭 mention 并跳过 mention.processChange', () => {
        const { slash, mention, feed } = setup()
        slash.processChange.mockReturnValue(true)

        feed(user('/cmd'))

        expect(slash.processChange).toHaveBeenCalledWith('/cmd', 4)
        expect(mention.processChange).not.toHaveBeenCalled()
        expect(mention.close).toHaveBeenCalled()
    })

    it('mention 命中：不关闭自身；两者都未命中才关闭 mention', () => {
        const { slash, mention, feed } = setup()
        mention.processChange.mockReturnValue(true)

        feed(user('@a'))
        expect(mention.close).not.toHaveBeenCalled()

        mention.processChange.mockReturnValue(false)
        feed(user('@ab'))
        expect(slash.processChange).toHaveBeenCalled()
        expect(mention.close).toHaveBeenCalled()
    })

    it('applySelection：精确落点设置光标；null 落点保持 setText 默认置尾；空结果无动作', () => {
        const { shell, hook } = setup()

        hook.result.current.applySelection({ text: 'hello', cursorPos: 3 })
        expect(shell.setText).toHaveBeenCalledWith('hello')
        expect(shell.setCursorOffset).toHaveBeenCalledWith(3)

        shell.setText.mockClear()
        shell.setCursorOffset.mockClear()
        hook.result.current.applySelection({ text: 'world', cursorPos: null })
        expect(shell.setText).toHaveBeenCalledWith('world')
        expect(shell.setCursorOffset).not.toHaveBeenCalled()

        shell.setText.mockClear()
        hook.result.current.applySelection(null)
        expect(shell.setText).not.toHaveBeenCalled()
    })
})
