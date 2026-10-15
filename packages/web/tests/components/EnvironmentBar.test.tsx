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
 * 2026-10-15 起工作区选择走 uiarc Combobox（搜索是明确需求，jsdom 可真实交互）：
 * - 聚焦展开/输入过滤/选中回调走真组件
 * - 底部固定「+ 新建工作区」入口（footer）且点击先收起下拉再回调
 * - 无清空语义（allowClear=false）：有值不渲染清除钮
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

/** jsdom 无 PointerEvent 布局：Combobox 聚焦即展开 */
const openMenu = (el: HTMLElement) => fireEvent.focus(el)

describe('EnvironmentBar 工作区即环境', () => {
    it('聚焦展开全量工作区；输入按 label 过滤（搜索是明确需求）', () => {
        const onWorkspaceChange = vi.fn()
        render(
            <EnvironmentBar
                workspaces={WORKSPACES}
                selectedWorkspaceId={null}
                onWorkspaceChange={onWorkspaceChange}
            />,
        )

        const input = screen.getByRole('combobox', { name: 'newSession.workspacePlaceholder' })
        openMenu(input)
        expect(screen.getByRole('option', { name: 'mobi' })).toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'demo' })).toBeInTheDocument()

        fireEvent.change(input, { target: { value: 'de' } })
        expect(screen.queryByRole('option', { name: 'mobi' })).not.toBeInTheDocument()
        expect(screen.getByRole('option', { name: 'demo' })).toBeInTheDocument()
    })

    it('点击选项回调 onWorkspaceChange', () => {
        const onWorkspaceChange = vi.fn()
        render(
            <EnvironmentBar
                workspaces={WORKSPACES}
                selectedWorkspaceId={null}
                onWorkspaceChange={onWorkspaceChange}
            />,
        )

        openMenu(screen.getByRole('combobox', { name: 'newSession.workspacePlaceholder' }))
        fireEvent.click(screen.getByRole('option', { name: 'demo' }))
        expect(onWorkspaceChange).toHaveBeenCalledWith('p2')
    })

    it('无清空语义（allowClear=false）：选中后不渲染清除钮', () => {
        render(
            <EnvironmentBar
                workspaces={WORKSPACES}
                selectedWorkspaceId="p1"
                onWorkspaceChange={vi.fn()}
            />,
        )

        expect(screen.queryByRole('button', { name: 'common.clearSelection' })).not.toBeInTheDocument()
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

        const input = screen.getByRole('combobox', { name: 'newSession.workspacePlaceholder' })
        openMenu(input)
        expect(input).toHaveAttribute('aria-expanded', 'true')

        fireEvent.click(screen.getByText('workspace.create'))
        expect(onCreateWorkspace).toHaveBeenCalledTimes(1)
        expect(onWorkspaceChange).not.toHaveBeenCalled() // footer 点击不是选项选中
        expect(input).toHaveAttribute('aria-expanded', 'false') // 宿主下拉已收起
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
