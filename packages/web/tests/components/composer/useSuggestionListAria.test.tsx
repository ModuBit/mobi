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
 * useSuggestionListAria：编辑器异步挂载（immediatelyRender:false）时逐帧重试，
 * 挂载后属性才写入；属性被编辑器 setProps 冲掉时由 MutationObserver 补回。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { render, waitFor, act, cleanup } from '@testing-library/react'
import { useSuggestionListAria, type ActiveSuggestionList } from '@/features/composer/useSuggestionListAria'

// jsdom 不实现 requestAnimationFrame：stub 为 setTimeout 以便重试链真实推进
beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})
afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
})

function Harness({ suggestion, editorMounted }: {
    suggestion: ActiveSuggestionList | null
    editorMounted: boolean
}) {
    const [wrapper, setWrapper] = useState<HTMLDivElement | null>(null)
    useSuggestionListAria({ current: wrapper }, suggestion)
    return (
        <div ref={setWrapper}>
            {editorMounted ? <div className="ProseMirror" /> : null}
        </div>
    )
}

const OPEN: ActiveSuggestionList = { listId: 'list-1', activeIndex: 1, count: 3 }

describe('useSuggestionListAria', () => {
    it('编辑器延迟挂载：挂载后自动写入 combobox 与展开属性', async () => {
        const { rerender } = render(<Harness suggestion={OPEN} editorMounted={false} />)
        expect(document.querySelector('.ProseMirror')).toBeNull()

        rerender(<Harness suggestion={OPEN} editorMounted />)

        await waitFor(() => {
            const pm = document.querySelector('.ProseMirror')!
            expect(pm.getAttribute('role')).toBe('combobox')
            expect(pm.getAttribute('aria-expanded')).toBe('true')
            expect(pm.getAttribute('aria-controls')).toBe('list-1')
            expect(pm.getAttribute('aria-activedescendant')).toBe('list-1-option-1')
        })
    })

    it('面板收起：expanded=false 且移除 controls/activedescendant', async () => {
        const { rerender } = render(<Harness suggestion={OPEN} editorMounted />)
        await waitFor(() => {
            expect(document.querySelector('.ProseMirror')).toHaveAttribute('aria-expanded', 'true')
        })

        rerender(<Harness suggestion={null} editorMounted />)
        await waitFor(() => {
            const pm = document.querySelector('.ProseMirror')!
            expect(pm.getAttribute('aria-expanded')).toBe('false')
            expect(pm.hasAttribute('aria-controls')).toBe(false)
            expect(pm.hasAttribute('aria-activedescendant')).toBe(false)
        })
    })

    it('编辑器 setProps 冲掉 role 后自动补回', async () => {
        render(<Harness suggestion={OPEN} editorMounted />)
        await waitFor(() => {
            expect(document.querySelector('.ProseMirror')).toHaveAttribute('role', 'combobox')
        })

        act(() => {
            document.querySelector('.ProseMirror')!.removeAttribute('role')
        })

        await waitFor(() => {
            expect(document.querySelector('.ProseMirror')).toHaveAttribute('role', 'combobox')
        })
    })
})
