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
 * uiarc floating-button-group 自管件的行为契约：toolbar 渲染与子项可访问名、点击回调
 * （onSelect + onAction）、disabled 吞点击、pressed 的 aria-pressed、separator、方向键
 * roving focus（跳过 disabled）。高亮 morph 与 tooltip 悬停是 jsdom 测不出的真机验收项。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { FloatingButtonGroup } from '@/ui/base/interactive/floating-button-group/FloatingButtonGroup'
import type { FloatingButtonGroupItem } from '@/ui/base/interactive/floating-button-group/FloatingButtonGroup'

vi.mock('motion/react', async (importOriginal) => {
    const { motionReactStub } = await import('../../helpers/motionReactStub')
    return motionReactStub(importOriginal)
})

afterEach(cleanup)

const items: FloatingButtonGroupItem[] = [
    { id: 'undo', label: '撤销' },
    { id: 'sep', type: 'separator' },
    { id: 'redo', label: '重做' },
    { id: 'clear', label: '清空', disabled: true },
]

describe('uiarc FloatingButtonGroup 行为契约', () => {
    it('渲染 role=toolbar（aria-label 为组名），子项以 label 为可访问名', () => {
        render(<FloatingButtonGroup items={items} label="画板操作" />)

        expect(screen.getByRole('toolbar', { name: '画板操作' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '撤销' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '重做' })).toBeInTheDocument()
    })

    it('separator 以 role=separator 渲染', () => {
        render(<FloatingButtonGroup items={items} label="画板操作" />)

        expect(screen.getByRole('separator')).toBeInTheDocument()
    })

    it('点击子项：onSelect 与 onAction(id) 都回调', () => {
        const onSelect = vi.fn()
        const onAction = vi.fn()
        render(
            <FloatingButtonGroup
                items={[{ id: 'undo', label: '撤销', onSelect }]}
                label="画板操作"
                onAction={onAction}
            />,
        )

        fireEvent.click(screen.getByRole('button', { name: '撤销' }))
        expect(onSelect).toHaveBeenCalledTimes(1)
        expect(onAction).toHaveBeenCalledWith('undo')
    })

    it('disabled 子项：aria-disabled 且点击被吞', () => {
        const onSelect = vi.fn()
        const onAction = vi.fn()
        render(
            <FloatingButtonGroup
                items={[{ id: 'clear', label: '清空', disabled: true, onSelect }]}
                label="画板操作"
                onAction={onAction}
            />,
        )

        const btn = screen.getByRole('button', { name: '清空' })
        expect(btn).toHaveAttribute('aria-disabled', 'true')
        fireEvent.click(btn)
        expect(onSelect).not.toHaveBeenCalled()
        expect(onAction).not.toHaveBeenCalled()
    })

    it('pressed 子项落 aria-pressed=true', () => {
        render(
            <FloatingButtonGroup
                items={[{ id: 'present', label: '演示', pressed: true }]}
                label="画板操作"
            />,
        )

        expect(screen.getByRole('button', { name: '演示' })).toHaveAttribute('aria-pressed', 'true')
    })

    it('方向键在可用子项间移动焦点，跳过 disabled', () => {
        render(<FloatingButtonGroup items={items} label="画板操作" />)

        const undo = screen.getByRole('button', { name: '撤销' })
        const redo = screen.getByRole('button', { name: '重做' })
        undo.focus()
        fireEvent.keyDown(undo, { key: 'ArrowRight' })
        expect(document.activeElement).toBe(redo)
    })
})
