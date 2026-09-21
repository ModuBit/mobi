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

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { commentTextareaAction } from '@/core/lib/commentTextareaKeys'
import { QuoteCommentInput } from '@/components/chat/QuoteCommentInput'

/** 构造带 IME 组合标志的键盘事件 */
function keyEvent(key: string, isComposing: boolean): React.KeyboardEvent<HTMLTextAreaElement> {
    return {
        key,
        shiftKey: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        nativeEvent: { isComposing },
    } as unknown as React.KeyboardEvent<HTMLTextAreaElement>
}

describe('commentTextareaAction（评论 textarea 键位判定）', () => {
    it('Enter 且非组合 → submit', () => {
        expect(commentTextareaAction(keyEvent('Enter', false))).toBe('submit')
    })

    it('IME 组合中的 Enter 是确认候选词 → null（中文输入法必踩）', () => {
        expect(commentTextareaAction(keyEvent('Enter', true))).toBeNull()
    })

    it('IME 组合中的 Esc 是取消本次候选词 → null，不得连带取消整个评论编辑', () => {
        // 回归：Escape 分支此前未豁免 isComposing，组合中按 Esc 会关闭浮层丢草稿
        expect(commentTextareaAction(keyEvent('Escape', true))).toBeNull()
    })

    it('非组合 Esc → cancel；Shift+Enter / 其它键 → null', () => {
        expect(commentTextareaAction(keyEvent('Escape', false))).toBe('cancel')
        expect(commentTextareaAction(keyEvent('a', false))).toBeNull()
    })
})

describe('QuoteCommentInput IME 组合中 Esc 不关闭浮层', () => {
    it('组合态按 Esc 仅取消候选词，浮层保持打开', () => {
        const onCancel = vi.fn()
        render(
            <QuoteCommentInput
                quote={{ messageId: 'm1', role: 'agent', excerpt: 'E' }}
                rect={new DOMRect(100, 300, 200, 20)}
                onConfirm={vi.fn()}
                onCancel={onCancel}
            />,
        )
        // i18n 未在测试环境初始化，placeholder 渲染为 key 原样——直接取浮层内 textarea
        const ta = screen.getByTestId('quote-comment-input').querySelector('textarea')!
        // isComposing 必须落在真实事件对象上（React synthetic e.nativeEvent 读的是它），
        // fireEvent 的 extra props 不会透传
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: true, bubbles: true }))
        expect(onCancel).not.toHaveBeenCalled()
        ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', isComposing: false, bubbles: true }))
        expect(onCancel).toHaveBeenCalled()
    })
})
