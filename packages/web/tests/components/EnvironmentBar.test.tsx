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
 * 回归守卫：EnvironmentBar 项目即环境
 *
 * 新建会话必须选项目——机器与工作目录从项目派生，不再提供机器选择/目录输入。
 * jsdom 无法渲染 antd Select 的真实 dropdown（portal + 虚拟列表），
 * 所以 mock Select 为 prop 记录器，直接断言：
 * - 可搜索（showSearch）且按 label 过滤
 * - 底部固定「+ 新建项目」入口（popupRender）且点击回调
 * - 选中项目后派生环境只读回显
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode, JSX } from 'react'
import { ConfigProvider } from 'antd'

// vi.hoisted：mock factory（hoisted 到顶部）也能引用的 prop 记录器
const { selectProps } = vi.hoisted(() => ({
    selectProps: { current: {} as Record<string, unknown> },
}))

vi.mock('antd', async importActual => {
    const actual = await importActual<typeof import('antd')>()
    // 用 prop 记录器替换 Select，绕开 jsdom 不渲染 dropdown 的限制
    const MockSelect = (props: Record<string, unknown>): JSX.Element => {
        selectProps.current = props
        return <input data-testid="mock-select" />
    }
    return { ...actual, Select: MockSelect as unknown as typeof actual.Select }
})

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

import { EnvironmentBar } from '@/components/composer/EnvironmentBar'

beforeAll(() => {
    // @ts-expect-error jsdom 无 ResizeObserver
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
})

afterEach(() => {
    cleanup()
    selectProps.current = {}
})

const cpWrapper = ({ children }: { children: ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

const PROJECTS = [
    { id: 'p1', name: 'mobi' },
    { id: 'p2', name: 'demo' },
]

/** 渲染 popupRender 产物（模拟 antd 展开下拉时的自定义内容） */
function renderPopup(): ReturnType<typeof render> {
    const popupRender = selectProps.current.popupRender as (menu: ReactNode) => ReactNode
    return render(<div>{popupRender(<div>menu</div>)}</div>)
}

describe('EnvironmentBar 项目即环境', () => {
    it('项目 Select 可搜索且按 label 过滤，选项为全量项目', () => {
        render(
            <EnvironmentBar
                projects={PROJECTS}
                selectedProjectId={null}
                onProjectChange={vi.fn()}
            />,
            { wrapper: cpWrapper },
        )

        expect(selectProps.current.showSearch).toBe(true)
        expect(selectProps.current.optionFilterProp).toBe('label')
        const options = selectProps.current.options as Array<{ value: string; label: string }>
        expect(options.map(o => o.value)).toEqual(['p1', 'p2'])
    })

    it('下拉底部固定「+ 新建项目」入口，点击触发 onCreateProject', () => {
        const onCreateProject = vi.fn()
        render(
            <EnvironmentBar
                projects={PROJECTS}
                selectedProjectId={null}
                onProjectChange={vi.fn()}
                onCreateProject={onCreateProject}
            />,
            { wrapper: cpWrapper },
        )

        const { getByText } = renderPopup()
        fireEvent.click(getByText('project.create'))
        expect(onCreateProject).toHaveBeenCalledTimes(1)
    })

    it('选中项目后展示派生环境只读回显（机器 + 主目录）', () => {
        render(
            <EnvironmentBar
                projects={PROJECTS}
                selectedProjectId="p1"
                onProjectChange={vi.fn()}
                machineLabel="Dev Box"
                directoryLabel="~/workspace/mobi"
            />,
            { wrapper: cpWrapper },
        )

        expect(screen.getByText('Dev Box · ~/workspace/mobi')).toBeInTheDocument()
    })

    it('未选项目时不渲染派生回显', () => {
        render(
            <EnvironmentBar
                projects={PROJECTS}
                selectedProjectId={null}
                onProjectChange={vi.fn()}
                machineLabel="Dev Box"
                directoryLabel="~/workspace/mobi"
            />,
            { wrapper: cpWrapper },
        )

        expect(screen.queryByText('Dev Box · ~/workspace/mobi')).not.toBeInTheDocument()
    })
})
