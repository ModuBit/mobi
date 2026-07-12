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
 * 回归守卫：EnvironmentBar 目录 AutoComplete 受控 open
 *
 * 背景：commit 448a1ceb 把 AutoComplete 改非受控时误删了 open={directoryOpen...}
 * 绑定，导致「选中目录→等子目录加载→重新展开」的 pendingOpen 机制失效（dead code），
 * 用户必须手输 '/' 才能展开下一级。
 *
 * jsdom 无法渲染 antd AutoComplete 的真实 dropdown（portal + 虚拟列表），
 * 所以这里 mock AutoComplete 为 prop 记录器，直接断言「受控 open 连接」：
 * 选中目录后、子目录加载完成时，传给 AutoComplete 的 open 必须为 true。
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { render, cleanup, waitFor, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useState, type ReactNode, type JSX } from 'react'
import { ConfigProvider } from 'antd'
import { EnvironmentBar } from '@/components/composer/EnvironmentBar'
import type { DirectoryOption } from '@/components/session/useMachineDirectoryListing'

// vi.hoisted：mock factory（hoisted 到顶部）也能引用的 prop 记录器
const { acProps } = vi.hoisted(() => ({
    acProps: { current: {} as Record<string, unknown> },
}))

vi.mock('antd', async importActual => {
    const actual = await importActual<typeof import('antd')>()
    // 用 prop 记录器替换 AutoComplete，绕开 jsdom 不渲染 dropdown 的限制
    const MockAutoComplete = (props: Record<string, unknown>): JSX.Element => {
        acProps.current = props
        return <input data-testid="mock-ac" />
    }
    return { ...actual, AutoComplete: MockAutoComplete as unknown as typeof actual.AutoComplete }
})

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
    acProps.current = {}
})

const cpWrapper = ({ children }: { children: ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

/** 受控 Harness：模拟父组件持有 selectedDirectory，并按 dir 返回 directoryOptions */
function Harness({
    initialDir,
    optionsFlow,
}: {
    initialDir: string
    optionsFlow: (dir: string) => DirectoryOption[]
}) {
    const [dir, setDir] = useState(initialDir)
    return (
        <EnvironmentBar
            machines={[]}
            selectedMachineId={null}
            directoryOptions={optionsFlow(dir)}
            selectedDirectory={dir}
            onDirectoryChange={setDir}
            recentPaths={[]}
        />
    )
}

describe('EnvironmentBar 目录 AutoComplete 受控 open', () => {
    it('初始时 open 为 false（受控，非 undefined）', () => {
        render(<Harness initialDir="/zzz" optionsFlow={() => []} />, { wrapper: cpWrapper })
        // 受控 open 必须显式传递；448a1ceb 回归下此值为 undefined
        expect(acProps.current.open).toBe(false)
    })

    it('选中目录后子目录加载完成，open 应回为 true（自动展开下一级）', async () => {
        const optionsFlow = (dir: string): DirectoryOption[] => {
            if (dir === '/foo/') return [{ value: '/foo/bar', label: 'bar' }]
            if (dir.startsWith('/zzz')) return [{ value: '/foo', label: 'foo' }]
            return []
        }

        render(<Harness initialDir="/zzz" optionsFlow={optionsFlow} />, { wrapper: cpWrapper })

        // 模拟选中 foo（等价于 defaultActiveFirstOption + Enter 触发的 onSelect）
        await waitFor(() => expect(acProps.current.onSelect).toBeTruthy())
        act(() => {
            ;(acProps.current.onSelect as (v: string) => void)('/foo')
        })

        // 选中后 dir → /foo/，子目录 bar 加载，pendingOpen 机制应把 open 置 true
        await waitFor(() => {
            expect(acProps.current.open).toBe(true)
        })
    })
})
