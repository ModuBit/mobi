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
 * 回归守卫：EnvironmentBar 工作区即环境
 *
 * 新建会话必须选工作区——机器与工作目录从工作区派生，不再提供机器选择/目录输入。
 * 2026-10-15 起工作区选择迁 uiarc Select（jsdom 可真实交互，不再 mock）：
 * - 展开/选项/选中回调走真组件
 * - 底部固定「+ 新建工作区」入口（footer）且点击先收起下拉再回调
 * - 选中工作区后派生环境只读回显
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('motion/react', async (importOriginal) => {
    const { motionReactStub } = await import('../helpers/motionReactStub')
    return motionReactStub(importOriginal)
})

vi.mock('react-i18next', async () => {
    const { i18nKeyStub } = await import('../helpers/motionReactStub')
    return i18nKeyStub()
})

import { EnvironmentBar } from '@/features/composer/EnvironmentBar'

afterEach(cleanup)

const WORKSPACES = [
    { id: 'p1', name: 'mobi' },
    { id: 'p2', name: 'demo' },
]

/** jsdom 无 PointerEvent 布局：Radix trigger 只认 pointerType=mouse 的 pointerdown 展开 */
const openMenu = (el: HTMLElement) => fireEvent.pointerDown(el, { button: 0, pointerType: 'mouse' })

describe('EnvironmentBar 工作区即环境', () => {
    it('展开后选项为全量工作区，点击选项回调', () => {
        const onWorkspaceChange = vi.fn()
        render(
            <EnvironmentBar
                workspaces={WORKSPACES}
                selectedWorkspaceId={null}
                onWorkspaceChange={onWorkspaceChange}
            />,
        )

        const trigger = screen.getByRole('combobox', { name: 'newSession.workspacePlaceholder' })
        openMenu(trigger)
        expect(screen.getByRole('option', { name: 'mobi' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'demo' })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('option', { name: 'demo' }))
        expect(onWorkspaceChange).toHaveBeenCalledWith('p2')
    })

    it('下拉底部固定「+ 新建工作区」入口：点击先收起下拉（受控 open）再回调，避免浮层残留', () => {
        const onCreateWorkspace = vi.fn()
        const onWorkspaceChange = vi.fn()
        render(
            <EnvironmentBar
                workspaces={WORKSPACES}
                selectedWorkspaceId={null}
                onWorkspaceChange={onWorkspaceChange}
                onCreateWorkspace={onCreateWorkspace}
            />,
        )

        const trigger = screen.getByRole('combobox', { name: 'newSession.workspacePlaceholder' })
        openMenu(trigger)
        expect(trigger).toHaveAttribute('aria-expanded', 'true')

        fireEvent.click(screen.getByText('workspace.create'))
        expect(onCreateWorkspace).toHaveBeenCalledTimes(1)
        expect(onWorkspaceChange).not.toHaveBeenCalled() // footer 点击不是选项选中
        expect(trigger).toHaveAttribute('aria-expanded', 'false') // 宿主下拉已收起
    })

    it('选中工作区后展示派生环境只读回显（机器 + 主目录）', () => {
        render(
            <EnvironmentBar
                workspaces={WORKSPACES}
                selectedWorkspaceId="p1"
                onWorkspaceChange={vi.fn()}
                hostLabel="Dev Box"
                directoryLabel="~/workspace/mobi"
            />,
        )

        expect(screen.getByText('Dev Box · ~/workspace/mobi')).toBeInTheDocument()
    })

    it('未选工作区时不渲染派生回显', () => {
        render(
            <EnvironmentBar
                workspaces={WORKSPACES}
                selectedWorkspaceId={null}
                onWorkspaceChange={vi.fn()}
                hostLabel="Dev Box"
                directoryLabel="~/workspace/mobi"
            />,
        )

        expect(screen.queryByText('Dev Box · ~/workspace/mobi')).not.toBeInTheDocument()
    })
})
