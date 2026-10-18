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

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { SuggestionList, type SuggestionRow } from '@/ui/base/interactive/suggestion-list/SuggestionList'

afterEach(cleanup)

const rows: SuggestionRow[] = [
    { key: 'a', label: 'src/components/Button.tsx', meta: '文件' },
    { key: 'b', label: 'src/features/chat', suffix: '/' },
    { key: 'c', label: '/debug', suffix: '[issue description]' },
]

function renderList(props: Partial<React.ComponentProps<typeof SuggestionList>> = {}) {
    return render(
        <SuggestionList
            listId="test-listbox"
            items={rows}
            activeIndex={0}
            onActiveIndexChange={vi.fn()}
            onSelect={vi.fn()}
            {...props}
        />,
    )
}

describe('SuggestionList', () => {
    it('渲染标签与副文案，query 命中片段用 mark 高亮', () => {
        renderList({ query: 'components' })
        // 高亮用 mark 切分了文本节点，getByText 匹不到整串，改用整行 textContent
        const first = screen.getAllByRole('option')[0]
        expect(first.textContent).toContain('src/components/Button.tsx')
        expect(first.textContent).toContain('文件')
        const mark = document.querySelector('mark')
        expect(mark?.textContent).toBe('components')
    })

    it('参数提示以 suffix 紧跟主文案（同一行，不甩到行尾）', () => {
        renderList()
        const option = screen.getAllByRole('option')[2]
        expect(option.textContent).toBe('/debug[issue description]')
        // suffix 与 label 同处 optionText 内的同一行容器，不是行尾 trailing
        const labelLine = option.querySelector('[class*="labelLine"]')
        expect(labelLine?.textContent).toBe('/debug[issue description]')
    })

    it('激活行 aria-selected，指针移入其他行上报 index', () => {
        const onActiveIndexChange = vi.fn()
        renderList({ activeIndex: 1, onActiveIndexChange })

        const options = screen.getAllByRole('option')
        expect(options[0]).toHaveAttribute('aria-selected', 'false')
        expect(options[1]).toHaveAttribute('aria-selected', 'true')

        fireEvent.pointerMove(options[0])
        expect(onActiveIndexChange).toHaveBeenCalledWith(0)
    })

    it('点击选项按 index 选择，且 mousedown 不抢焦点', () => {
        const onSelect = vi.fn()
        renderList({ onSelect })

        const list = screen.getByRole('listbox')
        // preventDefault 后 fireEvent 返回 false
        expect(fireEvent.mouseDown(list)).toBe(false)

        fireEvent.click(screen.getAllByRole('option')[1])
        expect(onSelect).toHaveBeenCalledWith(1)
    })

    it('option id 由 listId 派生，供 aria-activedescendant 关联', () => {
        renderList()
        const options = screen.getAllByRole('option')
        expect(options[0].id).toBe('test-listbox-option-0')
        expect(options[1].id).toBe('test-listbox-option-1')
        expect(screen.getByRole('listbox').id).toBe('test-listbox')
    })

    it('加载中且无结果时显示加载态', () => {
        renderList({ items: [], loading: true })
        expect(screen.getByRole('status')).toBeInTheDocument()
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('无结果时显示空态文案，未传则整体不渲染', () => {
        const first = renderList({ items: [], emptyText: '没有匹配项' })
        expect(screen.getByText('没有匹配项')).toBeInTheDocument()
        first.unmount()

        const second = renderList({ items: [] })
        expect(second.container.querySelector('[role="listbox"]')).toBeNull()
        expect(second.container.innerHTML).toBe('')
    })
})
