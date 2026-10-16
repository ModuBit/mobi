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
 * uiarc split-button 自管件的行为契约：主动作点击、箭头钮展开菜单、菜单项回调与
 * 关闭、disabled 全链路（主钮 / 箭头钮 / 菜单项）。morph 文字与宽度 spring、开合
 * 动效观感是 jsdom 测不出的真机验收项。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { SplitButton } from '@/ui/base/interactive/split-button/SplitButton'

vi.mock('motion/react', async (importOriginal) => {
    const { motionReactStub } = await import('../../helpers/motionReactStub')
    return motionReactStub(importOriginal)
})

vi.mock('react-i18next', async () => {
    const { i18nKeyStub } = await import('../../helpers/i18nStub')
    return i18nKeyStub()
})

afterEach(cleanup)

/** jsdom 无 PointerEvent 布局：Radix trigger 只认 pointerType=mouse 的 pointerdown 展开 */
const openMenu = (el: HTMLElement) => fireEvent.pointerDown(el, { button: 0, pointerType: 'mouse' })

/** 箭头钮的可访问名：i18n key 直通桩 → 断言 key 本身 */
const TRIGGER_NAME = 'uiarc.splitButton.moreActionsAriaLabel'

describe('uiarc SplitButton 行为契约', () => {
    it('主动作点击触发 onClick（可访问名来自 srOnly 直通 label）', () => {
        const onClick = vi.fn()
        render(<SplitButton label="保存" actions={[{ label: '导出', onSelect: () => {} }]} onClick={onClick} />)

        fireEvent.click(screen.getByRole('button', { name: '保存' }))
        expect(onClick).toHaveBeenCalledTimes(1)
    })

    it('箭头钮展开菜单，菜单项各就各位', () => {
        render(<SplitButton label="保存" actions={[{ label: '导出' }, { label: '另存为' }]} />)

        openMenu(screen.getByRole('button', { name: TRIGGER_NAME }))
        expect(screen.getByRole('menuitem', { name: '导出' })).toBeInTheDocument()
        expect(screen.getByRole('menuitem', { name: '另存为' })).toBeInTheDocument()
    })

    it('菜单项点击触发对应 onSelect 且只触发被点项，菜单随之关闭', () => {
        const onExport = vi.fn()
        const onSaveAs = vi.fn()
        render(<SplitButton label="保存" actions={[{ label: '导出', onSelect: onExport }, { label: '另存为', onSelect: onSaveAs }]} />)

        openMenu(screen.getByRole('button', { name: TRIGGER_NAME }))
        fireEvent.click(screen.getByRole('menuitem', { name: '导出' }))

        expect(onExport).toHaveBeenCalledTimes(1)
        expect(onSaveAs).not.toHaveBeenCalled()
        // 菜单关闭（Radix 选中即收起）
        expect(screen.queryByRole('menuitem', { name: '导出' })).toBeNull()
    })

    it('disabled：主钮与箭头钮均禁用，点击不触发、菜单不展开', () => {
        const onClick = vi.fn()
        const onExport = vi.fn()
        render(<SplitButton label="保存" actions={[{ label: '导出', onSelect: onExport }]} onClick={onClick} disabled />)

        const main = screen.getByRole('button', { name: '保存' })
        const trigger = screen.getByRole('button', { name: TRIGGER_NAME })
        expect(main).toBeDisabled()
        expect(trigger).toBeDisabled()

        fireEvent.click(main)
        expect(onClick).not.toHaveBeenCalled()

        openMenu(trigger)
        expect(screen.queryByRole('menuitem')).toBeNull()
    })

    it('菜单项 disabled（data-disabled）：点击不触发 onSelect，其余项不受影响', () => {
        const onPublish = vi.fn()
        const onPreview = vi.fn()
        render(<SplitButton label="操作" actions={[{ label: '发布', disabled: true, onSelect: onPublish }, { label: '预览', onSelect: onPreview }]} />)

        openMenu(screen.getByRole('button', { name: TRIGGER_NAME }))
        const publishItem = screen.getByRole('menuitem', { name: '发布' })
        expect(publishItem).toHaveAttribute('data-disabled')

        fireEvent.click(publishItem)
        expect(onPublish).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('menuitem', { name: '预览' }))
        expect(onPreview).toHaveBeenCalledTimes(1)
    })
})
