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
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { SuggestionChip } from '@/components/composer/SuggestionChip'

describe('SuggestionChip', () => {
    afterEach(() => cleanup())

    it('渲染建议文本', () => {
        render(<SuggestionChip text="用 virtuoso 重构" onAccept={vi.fn()} onDismiss={vi.fn()} />)
        expect(screen.getByText('用 virtuoso 重构')).toBeTruthy()
    })

    it('点击文本触发 onAccept', () => {
        const onAccept = vi.fn()
        render(<SuggestionChip text="建议" onAccept={onAccept} onDismiss={vi.fn()} />)
        fireEvent.click(screen.getByText('建议'))
        expect(onAccept).toHaveBeenCalledTimes(1)
    })

    it('点击关闭触发 onDismiss', () => {
        const onAccept = vi.fn()
        const onDismiss = vi.fn()
        const { container } = render(<SuggestionChip text="建议" onAccept={onAccept} onDismiss={onDismiss} />)
        // antd Tag 的关闭图标（closable）渲染为 .ant-tag-close-icon
        const closeIcon = container.querySelector('.ant-tag-close-icon') as HTMLElement
        expect(closeIcon).toBeTruthy()
        fireEvent.click(closeIcon)
        expect(onDismiss).toHaveBeenCalledTimes(1)
        // 关闭不应同时触发采纳（onClose 内 stopPropagation 防冒泡到 Tag onClick）
        expect(onAccept).not.toHaveBeenCalled()
    })

    it('hidden 时外层彻底塌缩（box-sizing border-box，padding 不留缝）', () => {
        const { container } = render(
            <SuggestionChip text="建议" hidden onAccept={vi.fn()} onDismiss={vi.fn()} />,
        )
        const wrapper = container.firstElementChild as HTMLElement
        expect(wrapper.style.maxHeight).toBe('0px')
        // border-box 保证 maxHeight:0 时 padding 计入盒高、整体塌缩，不残留 4px 透明缝
        expect(wrapper.style.boxSizing).toBe('border-box')
    })
})
