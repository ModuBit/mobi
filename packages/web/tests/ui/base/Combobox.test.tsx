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
 * uiarc combobox 自管件的行为契约：聚焦展开、关键词/label 过滤、选择回调、
 * 清除（"" 哨兵）、keywords 命中。恒占位 picker（value 恒 ""）是 MemorySection
 * 迁移站点的关键用法，单独守卫。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { Combobox } from '@/ui/base/interactive/combobox/Combobox'

vi.mock('motion/react', async (importOriginal) => {
    const { motionReactStub } = await import('../../helpers/motionReactStub')
    return motionReactStub(importOriginal)
})

vi.mock('react-i18next', async () => {
    const { i18nKeyStub } = await import('../../helpers/motionReactStub')
    return i18nKeyStub()
})

const OPTIONS = [
    { value: 'w-1', label: '学习' },
    { value: 'w-2', label: '工作笔记' },
    { value: 'w-3', label: '博客', keywords: ['writing'] },
]

afterEach(cleanup)

describe('uiarc Combobox 过滤与选择', () => {
    it('聚焦展开全量选项；输入按 label 过滤（含 keywords）', () => {
        render(<Combobox aria-label="工作区" options={OPTIONS} />)

        const input = screen.getByRole('combobox', { name: '工作区' })
        fireEvent.focus(input)
        expect(screen.getByRole('listbox')).toBeInTheDocument()
        expect(screen.getAllByRole('option')).toHaveLength(3)

        fireEvent.change(input, { target: { value: 'writing' } })
        expect(screen.getAllByRole('option')).toHaveLength(1)
        expect(screen.getByRole('option', { name: /博客/ })).toBeInTheDocument()
    })

    it('点击选项回调；value 恒 "" 的占位 picker 选中后回占位（MemorySection 迁移用法）', () => {
        const onValueChange = vi.fn<(v: string) => void>()
        render(<Combobox aria-label="添加规则" options={OPTIONS} value="" onValueChange={onValueChange} />)

        fireEvent.focus(screen.getByRole('combobox', { name: '添加规则' }))
        fireEvent.click(screen.getByText('学习'))

        expect(onValueChange).toHaveBeenCalledWith('w-1')
        // 受控 value 恒 ""：选中即回落占位（退出动画是上游行为，jsdom 不收敛不断言卸载）
        expect(screen.getByRole('combobox', { name: '添加规则' })).toHaveValue('')
    })

    it('有值渲染清除钮，点击回调 "" 并重新展开（保持可继续输入）', () => {
        const onValueChange = vi.fn<(v: string) => void>()
        render(<Combobox aria-label="工作区" options={OPTIONS} value="w-1" onValueChange={onValueChange} />)

        fireEvent.click(screen.getByRole('button', { name: 'common.clearSelection' }))
        expect(onValueChange).toHaveBeenCalledWith('')
        expect(screen.getByRole('listbox')).toBeInTheDocument()
    })

    it('无匹配渲染空态（i18n key 直通）', () => {
        render(<Combobox aria-label="工作区" options={OPTIONS} />)
        fireEvent.focus(screen.getByRole('combobox', { name: '工作区' }))
        fireEvent.change(screen.getByRole('combobox', { name: '工作区' }), { target: { value: '不存在' } })
        expect(screen.getByText('common.noMatches')).toBeInTheDocument()
    })

    it('菜单展开时 Enter 未导航（activeIndex=-1）也拦住默认行为——不冒泡提交外层表单', () => {
        const onSubmit = vi.fn<(e: Event) => void>()
        const { container } = render(
            <form onSubmit={onSubmit}>
                <Combobox aria-label="工作区" options={OPTIONS} />
            </form>,
        )
        const input = screen.getByRole('combobox', { name: '工作区' })
        fireEvent.focus(input)
        // 菜单开着但未键盘导航，直接 Enter：只拦（preventDefault），不误选也不提交表单
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onSubmit).not.toHaveBeenCalled()
        expect(container.querySelector('form')).toBeInTheDocument()
    })
})
