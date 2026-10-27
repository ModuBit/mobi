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
 * uiarc button 自管件的行为契约：variant/size/disabled/loading 渲染、onClick 回调、
 * children 直通、loading 吞点击。按压回弹与宽度 morph 观感是 jsdom 测不出的真机验收项。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { Button } from '@/ui/base/interactive/button/Button'

vi.mock('motion/react', async (importOriginal) => {
    const { motionReactStub } = await import('../../helpers/motionReactStub')
    return motionReactStub(importOriginal)
})

afterEach(cleanup)

describe('uiarc Button 行为契约', () => {
    it('children 直通渲染为 button，点击回调', () => {
        const onClick = vi.fn()
        render(<Button onClick={onClick}>保存</Button>)

        fireEvent.click(screen.getByRole('button', { name: '保存' }))
        expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('disabled 不触发点击', () => {
        const onClick = vi.fn()
        render(<Button disabled onClick={onClick}>保存</Button>)

        const btn = screen.getByRole('button', { name: '保存' })
        expect(btn).toBeDisabled()
        fireEvent.click(btn)
        expect(onClick).not.toHaveBeenCalled()
    })

    it('loading：aria-busy + aria-disabled，点击被吞；loader 就位', () => {
        const onClick = vi.fn()
        render(<Button loading onClick={onClick}>保存</Button>)

        const btn = screen.getByRole('button', { name: '保存' })
        expect(btn).toHaveAttribute('aria-busy', 'true')
        expect(btn).toHaveAttribute('aria-disabled', 'true')
        // loading 不禁用按钮（保键盘焦点），靠吞点击实现
        expect(btn).not.toBeDisabled()
        expect(btn.querySelector('[aria-hidden="true"]')).not.toBeNull()

        fireEvent.click(btn)
        expect(onClick).not.toHaveBeenCalled()
    })

    it('loading + 前置 icon：spinner 原位替换 icon（不并排）', () => {
        render(
            <Button loading>
                <svg data-testid="icon" />
                保存
            </Button>,
        )
        // icon 被换下，文案保留
        expect(screen.queryByTestId('icon')).not.toBeInTheDocument()
        expect(screen.getByText('保存')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '保存' }).querySelector('[aria-hidden="true"]')).not.toBeNull()
    })

    it('非 loading + 前置 icon：icon 正常渲染在替换槽位', () => {
        render(
            <Button>
                <svg data-testid="icon" />
                保存
            </Button>,
        )
        expect(screen.getByTestId('icon')).toBeInTheDocument()
    })

    it('variant/size 落 className，默认 primary/md', () => {
        const { rerender } = render(<Button>保存</Button>)
        const btn = screen.getByRole('button', { name: '保存' })
        expect(btn.className).toContain('primary')
        expect(btn.className).toContain('md')

        rerender(<Button variant="ghost" size="sm">保存</Button>)
        expect(btn.className).toContain('ghost')
        expect(btn.className).toContain('sm')
    })

    it('children 含 icon + 文案时可访问名合并（icon 内联形态）', () => {
        render(
            <Button>
                <svg data-testid="icon" />
                新建
            </Button>,
        )
        expect(screen.getByRole('button', { name: /新建/ })).toBeInTheDocument()
        expect(screen.getByTestId('icon')).toBeInTheDocument()
    })
})
