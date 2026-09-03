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
 * NewSessionPage 参数区 output style 选择器规格。
 *
 * - 默认选中「跟随 CC 设置」（不携带字段 spawn，CC settings 默认 style 保持权威）
 * - 下拉展开后「跟随 CC 设置」+ 五个内置选项完整（Default / Proactive / Concise / Explanatory / Learning）
 * - 选中 Explanatory 后提交 → spawnSession 收到 outputStyle: 'Explanatory'（CC 规范形）
 * - 显式选中 Default 后提交 → spawnSession 收到 outputStyle: 'default'
 * - 不改默认直接提交 → spawnSession 入参不含 outputStyle 字段
 *
 * 环境注入：通过 localStorage「最近使用项目」恢复路径预选项目（绕开
 * EnvironmentBar 交互），让 gate（机器 + 目录）直接通过以便提交。
 *
 * Select 交互说明（antd v6）：选中值在 `.ant-select-content`，展开用
 * fireEvent.mouseDown(`.ant-select`)，选项 portal 到 body（virtual={false}）。
 * 提交走空输入 create 分支（点击 Sender 发送按钮）——jsdom 下带内容的受控
 * 回车提交存在重渲染不触发的问题，不作为本规格的断言路径。
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ConfigProvider, App as AntdApp } from 'antd'
import '@testing-library/jest-dom/vitest'
import type { Project } from '@mobi/shared'
import { NewSessionPage } from '@/pages/NewSessionPage'

// —— mock spawn mutation：模块级稳定引用（mock 对象跨渲染保持同一身份，避免 effect 无限循环）——
const { spawnSpy } = vi.hoisted(() => ({ spawnSpy: vi.fn() }))
vi.mock('@/core/data/hooks/mutations/useSpawnSession', () => ({
    useSpawnSession: () => ({
        spawnSession: spawnSpy,
        isPending: false,
        error: null,
    }),
}))

// —— mock 数据 hooks：单机器单项目，项目经 localStorage 恢复路径自动选中 ——
vi.mock('@/core/data/hooks/queries/useMachines', () => ({
    useMachines: () => ({ machines: [], isLoading: false }),
}))
const TEST_PROJECT: Project = {
    id: 'p1',
    namespace: 'personal',
    machineId: 'm1',
    name: 'demo',
    folders: [{ path: '/home/u/demo', primary: true }],
    createdAt: 0,
    updatedAt: 0,
    seq: 0,
}
vi.mock('@/core/data/hooks/queries/useProjects', () => ({
    useProjects: () => ({ data: [TEST_PROJECT] }),
}))

// —— mock 目录能力 / 斜杠命令：稳定 no-op（页面渲染依赖，不触发真实请求）——
const noop = async () => ({ data: { success: false } })
vi.mock('@/core/data/hooks/queries/useDirectoryCapabilities', () => ({
    useDirectoryCapabilities: () => ({
        metadata: null,
        metadataLoading: false,
        commands: [],
        searchFiles: noop,
        listDirectory: noop,
        uploadFile: noop,
        deleteUpload: noop,
    }),
}))
vi.mock('@/components/composer/useDirectoryCommands', () => ({
    useDirectoryCommands: () => ({ commandsData: undefined, isLoading: false }),
}))

// —— mock router：useSearch 无 param（走 localStorage 恢复路径）——
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => mockNavigate,
    useSearch: () => ({}),
}))

// —— mock i18n：identity t（placeholder/label 直返 key，便于定位）——
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({ t: (key: string) => key }),
}))

// —— mock api client：页面渲染与空输入提交均不触达真实请求 ——
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({ messages: { send: async () => ({}) } }),
}))

// —— mock 指针媒体查询：桌面形态（Sender submitType=enter，子项不折叠）——
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useHasFinePointer: () => true,
}))

// —— 静态化布局组件：避免 router/动画上下文干扰 ——
vi.mock('@/components/layout/SidebarToggle', () => ({ SidebarToggle: () => null }))
vi.mock('@/components/layout/MobileMenu', () => ({ MobileMenuButton: () => null }))
vi.mock('@/components/layout/Logo', () => ({ Logo: () => null }))
vi.mock('@/components/project/ProjectFormModal', () => ({ ProjectFormModal: () => null }))

// jsdom 无 ResizeObserver / matchMedia，antd Select 弹层路径依赖——最小 stub
class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}
const origResizeObserver = globalThis.ResizeObserver
const origMatchMedia = globalThis.matchMedia
beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
    globalThis.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof matchMedia
})
afterAll(() => {
    globalThis.ResizeObserver = origResizeObserver
    globalThis.matchMedia = origMatchMedia
})

beforeEach(() => {
    spawnSpy.mockReset()
    spawnSpy.mockResolvedValue({ type: 'success', sessionId: 'sess-1' })
    // 预置「最近使用项目」：进入页面即自动回选，gate 直接通过
    localStorage.setItem('mobi:newSession:lastUsedProject', 'p1')
})
afterEach(() => {
    cleanup()
    localStorage.clear()
})

const wrapper = ({ children }: { children: ReactNode }) => (
    <ConfigProvider>
        <AntdApp>{children}</AntdApp>
    </ConfigProvider>
)

function renderPage() {
    return render(<NewSessionPage />, { wrapper })
}

/** 定位 output style 选择器根节点：按选中值文本匹配（跟随 CC 设置 / Default / Explanatory 等，
 *  与其它 Select 区分：模型=Auto、项目名、权限模式为 i18n key）。identity i18n mock 下
 *  「跟随 CC 设置」项 label 即 i18n key 原文 */
function outputStyleSelect(selectedLabel = 'composer.outputStyleFollowSetting'): HTMLElement {
    const select = Array.from(document.querySelectorAll('.ant-select'))
        .find(el => el.querySelector('.ant-select-content')?.textContent === selectedLabel)
    if (!(select instanceof HTMLElement)) throw new Error(`output style select not found: ${selectedLabel}`)
    return select
}

/** 展开下拉后取当前下拉的选项文本列表（portal 到 body，取最新一份 dropdown） */
function dropdownOptionTexts(): string[] {
    const dropdowns = document.querySelectorAll('.ant-select-dropdown')
    const dropdown = dropdowns[dropdowns.length - 1]
    if (!(dropdown instanceof HTMLElement)) throw new Error('select dropdown not found')
    return Array.from(dropdown.querySelectorAll('.ant-select-item-option'))
        .map(el => el.textContent ?? '')
}

/** 展开 output style 下拉并点击含指定 label 的选项 */
async function selectOutputStyle(label: string) {
    fireEvent.mouseDown(outputStyleSelect())
    const dropdowns = document.querySelectorAll('.ant-select-dropdown')
    const dropdown = dropdowns[dropdowns.length - 1]
    const option = Array.from(dropdown.querySelectorAll('.ant-select-item-option'))
        .find(el => (el.textContent ?? '').includes(label))
    if (!(option instanceof HTMLElement)) throw new Error(`option not found: ${label}`)
    fireEvent.click(option)
}

/** 空输入提交：点击 Sender 发送按钮（页面状态机的 create 分支，hasContent=false 时
 *  按钮直接触发 handleSubmit——不依赖 jsdom 下受控回车/输入重渲染的行为差异） */
async function submit() {
    const sendBtn = document.querySelector('.ant-sender-actions-btn')
    if (!(sendBtn instanceof HTMLElement)) throw new Error('send button not found')
    fireEvent.click(sendBtn)
    await waitFor(() => {
        expect(spawnSpy).toHaveBeenCalledTimes(1)
    })
}

describe('NewSessionPage output style 选择器', () => {
    it('默认选中「跟随 CC 设置」（Select 值显示 i18n key）', async () => {
        renderPage()
        // gate 经 localStorage 恢复路径通过后输入区启用，选择器随即渲染
        await waitFor(() => {
            expect(outputStyleSelect()).not.toHaveClass('ant-select-disabled')
        })
        expect(outputStyleSelect().querySelector('.ant-select-content')?.textContent)
            .toBe('composer.outputStyleFollowSetting')
    })

    it('下拉展开后「跟随 CC 设置」+ 五个内置选项完整（共 6 项）', async () => {
        renderPage()
        await waitFor(() => {
            expect(outputStyleSelect()).not.toHaveClass('ant-select-disabled')
        })
        fireEvent.mouseDown(outputStyleSelect())
        await waitFor(() => {
            const texts = dropdownOptionTexts().join('\n')
            for (const label of ['composer.outputStyleFollowSetting', 'Default', 'Proactive', 'Concise', 'Explanatory', 'Learning']) {
                expect(texts).toContain(label)
            }
        })
        expect(dropdownOptionTexts()).toHaveLength(6)
    })

    it('选中 Explanatory 后提交 → spawnSession 收到 outputStyle: Explanatory（CC 规范形）', async () => {
        renderPage()
        await waitFor(() => {
            expect(outputStyleSelect()).not.toHaveClass('ant-select-disabled')
        })
        await selectOutputStyle('Explanatory')
        await waitFor(() => {
            expect(outputStyleSelect('Explanatory')).not.toHaveClass('ant-select-disabled')
        })

        await submit()
        expect(spawnSpy).toHaveBeenCalledWith(expect.objectContaining({
            outputStyle: 'Explanatory',
            machineId: 'm1',
            directory: '/home/u/demo',
        }))
    })

    it('显式选中 Default 后提交 → spawnSession 收到 outputStyle: default（显式选择仍显式传）', async () => {
        renderPage()
        await waitFor(() => {
            expect(outputStyleSelect()).not.toHaveClass('ant-select-disabled')
        })
        await selectOutputStyle('Default')
        await waitFor(() => {
            expect(outputStyleSelect('Default')).not.toHaveClass('ant-select-disabled')
        })

        await submit()
        expect(spawnSpy).toHaveBeenCalledWith(expect.objectContaining({ outputStyle: 'default' }))
    })

    it('默认（跟随 CC 设置）直接提交 → spawnSession 入参不含 outputStyle 字段', async () => {
        renderPage()
        await waitFor(() => {
            expect(outputStyleSelect()).not.toHaveClass('ant-select-disabled')
        })

        await submit()
        // 字段值 undefined（对象键存在但 JSON 序列化后不携带——CC settings 默认 style 保持权威）
        const input = spawnSpy.mock.calls[0][0] as Record<string, unknown>
        expect(input.outputStyle).toBeUndefined()
    })
})
