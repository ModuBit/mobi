/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License at
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ScrambleText } from '@/components/chat/ScrambleText'

describe('ScrambleText', () => {
    it('无 previousText 时，从乱码过渡到目标文本', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

        const { container } = render(<ScrambleText text="hello" speed={40} />)
        // 初始：正在乱码动画中
        expect(container.textContent).not.toBe('hello')

        // 推进到完全揭秘
        act(() => { vi.advanceTimersByTime(40 * 6) })
        expect(container.textContent).toBe('hello')

        vi.useRealTimers()
    })

    it('有 previousText 时，从旧文本过渡到新文本', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

        const { container } = render(
            <ScrambleText text="computing" previousText="doing" speed={40} />
        )

        act(() => { vi.advanceTimersByTime(40 * 12) })
        expect(container.textContent).toBe('computing')

        vi.useRealTimers()
    })

    it('text 变化时自动触发过渡动画', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

        const { container, rerender } = render(<ScrambleText text="doing" speed={40} />)
        // 首次渲染也是动画，推进到完成
        act(() => { vi.advanceTimersByTime(40 * 6) })
        expect(container.textContent).toBe('doing')

        // 文本变化 → 触发过渡
        rerender(<ScrambleText text="computing" speed={40} />)
        expect(container.textContent).not.toBe('computing')

        act(() => { vi.advanceTimersByTime(40 * 12) })
        expect(container.textContent).toBe('computing')

        vi.useRealTimers()
    })

    it('短文本到长文本过渡完成后展示新文本', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

        const { container } = render(
            <ScrambleText text="flibbertigibbeting" previousText="doing" speed={40} />
        )

        act(() => { vi.advanceTimersByTime(40 * 20) })
        expect(container.textContent).toBe('flibbertigibbeting')

        vi.useRealTimers()
    })

    it('长文本到短文本过渡完成后展示新文本', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

        const { container } = render(
            <ScrambleText text="doing" previousText="flibbertigibbeting" speed={40} />
        )

        act(() => { vi.advanceTimersByTime(40 * 10) })
        expect(container.textContent).toBe('doing')

        vi.useRealTimers()
    })
})