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
 * uiarc button-group 自管件的行为契约：连体渲染（子按钮成组 + role=group 可访问名）、
 * onSelect 回调、href 链接段、item/group 两级 disabled、attached menu 的 Radix 展开、
 * 按压后标签更替的 aria-live 播报、方向键/Home/End 键盘导航。
 * 滑行高亮、宽度 morph、溢出折叠标签（collapseLabels 依赖真实布局）是 jsdom 测不出
 * 的真机验收项。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { ButtonGroup } from '@/ui/base/interactive/button-group/ButtonGroup'

vi.mock('motion/react', async (importOriginal) => {
    const { motionReactStub } = await import('../../helpers/motionReactStub')
    return motionReactStub(importOriginal)
})

// vitest 未开 globals：渲染型测试必须显式 cleanup，否则 DOM 累积致 getBy* 多元素报错
afterEach(cleanup)

describe('uiarc ButtonGroup 行为契约', () => {
    it('items 连体渲染为 role=group 内的按钮，点击回调 onSelect', () => {
        const onShare = vi.fn()
        const onExport = vi.fn()
        render(
            <ButtonGroup label="文档操作" items={[
                { id: 'share', label: '分享', onSelect: onShare },
                { id: 'export', label: '导出', onSelect: onExport },
            ]} />,
        )

        const group = screen.getByRole('group', { name: '文档操作' })
        expect(group).toHaveAttribute('data-orientation', 'horizontal')

        fireEvent.click(screen.getByRole('button', { name: '分享' }))
        expect(onShare).toHaveBeenCalledTimes(1)
        expect(onExport).not.toHaveBeenCalled()
    })

    it('variant/size/orientation 落 className，默认 outline/md；href 段渲染为链接', () => {
        const onSelect = vi.fn()
        const { rerender } = render(
            <ButtonGroup label="文档操作" items={[
                { id: 'share', label: '分享', onSelect },
                { id: 'docs', label: '文档', href: 'https://example.com', onSelect },
            ]} />,
        )

        const group = screen.getByRole('group', { name: '文档操作' })
        expect(group.className).toContain('outline')
        expect(group.className).toContain('md')
        expect(group.className).not.toContain('vertical')

        const link = screen.getByRole('link', { name: '文档' })
        expect(link).toHaveAttribute('href', 'https://example.com')
        fireEvent.click(link)
        expect(onSelect).toHaveBeenCalledTimes(1)

        // vertical 落 orientation 类
        rerender(<ButtonGroup label="文档操作" orientation="vertical" items={[
            { id: 'share', label: '分享', onSelect },
            { id: 'docs', label: '文档', href: 'https://example.com', onSelect },
        ]} />)
        expect(screen.getByRole('group', { name: '文档操作' }).className).toContain('vertical')
    })

    it('item 级 disabled：aria-disabled 且点击不回调；group 级 disabled：按钮原生禁用', () => {
        const onShare = vi.fn()
        const onExport = vi.fn()
        const { rerender } = render(
            <ButtonGroup label="文档操作" items={[
                { id: 'share', label: '分享', disabled: true, onSelect: onShare },
                { id: 'export', label: '导出', onSelect: onExport },
            ]} />,
        )

        // item 级：保持可聚焦（aria-disabled），点击被吞
        const share = screen.getByRole('button', { name: '分享' })
        expect(share).toHaveAttribute('aria-disabled', 'true')
        expect(share).not.toBeDisabled()
        fireEvent.click(share)
        expect(onShare).not.toHaveBeenCalled()

        // group 级：整组原生禁用
        rerender(
            <ButtonGroup label="文档操作" disabled items={[
                { id: 'share', label: '分享', onSelect: onShare },
                { id: 'export', label: '导出', onSelect: onExport },
            ]} />,
        )
        expect(screen.getByRole('button', { name: '分享' })).toBeDisabled()
        expect(screen.getByRole('button', { name: '导出' })).toBeDisabled()
        fireEvent.click(screen.getByRole('button', { name: '导出' }))
        expect(onExport).not.toHaveBeenCalled()
    })

    it('attached menu：pointerDown 展开 chevron 触发器，菜单项点击回调', () => {
        const onDuplicate = vi.fn()
        const onDelete = vi.fn()
        render(
            <ButtonGroup label="文档操作" items={[{ id: 'share', label: '分享' }]} menu={{
                label: '更多操作',
                items: [
                    { id: 'duplicate', label: '创建副本', onSelect: onDuplicate },
                    { id: 'delete', label: '删除', destructive: true, onSelect: onDelete },
                ],
            }} />,
        )

        // chevron 触发器是组内最后一个 segment，可访问名来自 menu.label
        const trigger = screen.getByRole('button', { name: '更多操作' })
        expect(trigger.closest('[role="group"]')).not.toBeNull()

        // Radix 在 pointerdown 上展开，非 click；jsdom 无真实指针，直接派发
        fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })
        expect(screen.getByRole('menuitem', { name: '创建副本' })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: '删除' })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('menuitem', { name: '创建副本' }))
        expect(onDuplicate).toHaveBeenCalledTimes(1)
        expect(onDelete).not.toHaveBeenCalled()
    })

    it('attached menu：group disabled 时触发器禁用', () => {
        render(
            <ButtonGroup label="文档操作" disabled items={[{ id: 'share', label: '分享' }]} menu={{
                label: '更多操作',
                items: [{ id: 'duplicate', label: '创建副本' }],
            }} />,
        )
        expect(screen.getByRole('button', { name: '更多操作' })).toBeDisabled()
    })

    it('按压后标签更替：aria-live 区播报新标签（Share 应答 Copied 契约）', () => {
        const { container, rerender } = render(
            <ButtonGroup label="文档操作" items={[{ id: 'share', label: '分享' }]} />,
        )
        fireEvent.click(screen.getByRole('button', { name: '分享' }))

        rerender(<ButtonGroup label="文档操作" items={[{ id: 'share', label: '已复制' }]} />)
        const live = container.querySelector('[aria-live="polite"]')
        expect(live).toHaveTextContent('已复制')
    })

    it('键盘导航：ArrowRight 移焦下一段，Home/End 跳首尾', () => {
        render(
            <ButtonGroup label="文档操作" items={[
                { id: 'a', label: '甲' },
                { id: 'b', label: '乙' },
                { id: 'c', label: '丙' },
            ]} />,
        )
        const [first, second, third] = screen.getAllByRole('button')

        first!.focus()
        fireEvent.keyDown(first!, { key: 'ArrowRight' })
        expect(second).toHaveFocus()

        fireEvent.keyDown(second!, { key: 'End' })
        expect(third).toHaveFocus()

        fireEvent.keyDown(third!, { key: 'Home' })
        expect(first).toHaveFocus()
    })
})
