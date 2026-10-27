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
 * NewSessionPage 的快速模式预设：面板里点亮闪电后提交，spawnSession 必须带上
 * `fastMode: true`。
 *
 * 这个用例守的是 **handleSubmit 的闭包新鲜度**：提交回调是 useCallback，漏掉
 * fastMode 依赖时，面板（直接读渲染期状态）显示已开启、提交却仍带旧值——
 * 2026-10-27 真机 E2E 实踩（会话建出来没有 --fast-mode）。
 *
 * 环境注入与 outputStyle 规格同款：localStorage 预选工作区 + 预选支持快速模式的模型。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, waitFor, cleanup, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { ConfigProvider, App as AntdApp } from 'antd'
import '@testing-library/jest-dom/vitest'
import type { Workspace } from '@mobi/shared'
import { NewSessionPage } from '@/pages/NewSessionPage'

vi.mock('motion/react', async (importOriginal) => {
    const { motionReactStub } = await import('../helpers/motionReactStub')
    return motionReactStub(importOriginal)
})

const { spawnSpy } = vi.hoisted(() => ({ spawnSpy: vi.fn() }))
vi.mock('@/core/data/hooks/mutations/useSpawnSession', () => ({
    useSpawnSession: () => ({
        spawnSession: spawnSpy,
        isPending: false,
        error: null,
    }),
}))

vi.mock('@/features/sketchpad/SketchDrawer', () => ({ SketchDrawer: () => null }))

const { stableMachines } = vi.hoisted(() => ({ stableMachines: [] as never[] }))
vi.mock('@/core/data/hooks/queries/useMachines', () => ({
    useMachines: () => ({ machines: stableMachines, isLoading: false }),
}))
vi.mock('@/core/data/hooks/queries/useDaemonStatus', () => ({
    useDaemonStatus: () => ({
        status: { status: 'ok', host: { hostname: 'test-host', platform: 'darwin', homeDir: '/home/u' } },
        isLoading: false,
    }),
}))
const TEST_WORKSPACE: Workspace = {
    id: 'p1',
    namespace: 'personal',
    machineId: 'm1',
    name: 'demo',
    folders: [{ path: '/home/u/demo', primary: true }],
    createdAt: 0,
    updatedAt: 0,
    seq: 0,
}
vi.mock('@/core/data/hooks/queries/useWorkspaces', () => ({
    useWorkspaces: () => ({ data: [TEST_WORKSPACE] }),
}))

/** 探针清单里的模型：声明支持快速模式（闪电钮因此渲染） */
const FAST_MODEL = {
    value: 'fast-model',
    displayName: 'Fast Model',
    description: 'supports fast',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high'],
    supportsFastMode: true,
}
const noop = async () => ({ data: { success: false } })
/** 无快速模式、档位更少（最高 medium）的模型：换到它必须收敛 effort / fastMode */
const PLAIN_MODEL = {
    value: 'plain-model',
    displayName: 'Plain Model',
    description: 'no fast, fewer levels',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium'],
}
vi.mock('@/core/data/hooks/queries/useDirectoryCapabilities', () => ({
    useDirectoryCapabilities: () => ({
        metadata: { models: [FAST_MODEL, PLAIN_MODEL] },
        metadataLoading: false,
        commands: [],
        searchFiles: noop,
        listDirectory: noop,
        uploadFile: noop,
        deleteUpload: noop,
    }),
}))
vi.mock('@/features/composer/useDirectoryCommands', () => ({
    useDirectoryCommands: () => ({ commandsData: undefined, isLoading: false }),
}))

const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => mockNavigate,
    useSearch: () => ({}),
}))
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({ t: (key: string) => key }),
}))
/** 模块级稳定引用：mock 每次渲染返回新对象会让提交回调的依赖身份变化，
 *  反而把「依赖漏项」的 bug 掩盖掉（本规格要验的正是闭包新鲜度） */
const { stableApi } = vi.hoisted(() => ({ stableApi: { messages: { send: async () => ({}) } } }))
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => stableApi,
}))
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useHasFinePointer: () => true,
    useIsMobile: () => false,
}))
vi.mock('@/features/layout/SidebarToggle', () => ({ SidebarToggle: () => null }))
vi.mock('@/features/layout/mobileMenu', () => ({ MobileMenuButton: () => null }))
vi.mock('@/ui/base/brand/Logo', () => ({ Logo: () => null }))
vi.mock('@/ui/shared/WorkspaceFormModal', () => ({ WorkspaceFormModal: () => null }))

beforeEach(() => {
    spawnSpy.mockReset()
    spawnSpy.mockResolvedValue({ type: 'success', sessionId: 'sess-1' })
    localStorage.setItem('mobi:newSession:lastUsedWorkspace', 'p1')
    // 预选支持快速模式的模型：默认 auto 没有能力位，闪电钮不会渲染
    localStorage.setItem('mobi:newSession:model', 'fast-model')
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

function modelTrigger(): HTMLElement {
    const trigger = screen.getAllByRole('button', { name: 'newSession.model' })[0]
    if (!(trigger instanceof HTMLElement)) throw new Error('model trigger not found')
    return trigger
}

async function submit() {
    const sendBtn = document.querySelector('.ant-sender-actions-btn')
    if (!(sendBtn instanceof HTMLElement)) throw new Error('send button not found')
    fireEvent.click(sendBtn)
    await waitFor(() => {
        expect(spawnSpy).toHaveBeenCalledTimes(1)
    })
}

describe('NewSessionPage 快速模式预设', () => {
    it('面板点亮闪电后提交 → spawnSession 带上 fastMode: true', async () => {
        render(<NewSessionPage />, { wrapper })
        await waitFor(() => {
            expect(modelTrigger()).not.toBeDisabled()
        })

        fireEvent.click(modelTrigger())
        const fastToggle = await screen.findByRole('button', { name: 'composer.modelPanel.fastOff' })
        fireEvent.click(fastToggle)
        expect(screen.getByRole('button', { name: 'composer.modelPanel.fastOn' })).toHaveAttribute('aria-pressed', 'true')

        await submit()
        expect(spawnSpy).toHaveBeenCalledWith(expect.objectContaining({
            model: 'fast-model',
            fastMode: true,
        }))
    })

    it('不点亮直接提交 → 入参不携带 fastMode（未指定而不是显式 false）', async () => {
        render(<NewSessionPage />, { wrapper })
        await waitFor(() => {
            expect(modelTrigger()).not.toBeDisabled()
        })

        await submit()
        const input = spawnSpy.mock.calls[0][0] as Record<string, unknown>
        expect(input.fastMode).toBeUndefined()
    })

    it('换到不支持快速模式、档位更少的模型 → 快速模式关闭、档位回落到该模型最高档', async () => {
        localStorage.setItem('mobi:newSession:effort', 'xhigh')
        render(<NewSessionPage />, { wrapper })
        await waitFor(() => {
            expect(modelTrigger()).not.toBeDisabled()
        })

        // 先在支持快速模式的模型上点亮闪电
        fireEvent.click(modelTrigger())
        fireEvent.click(await screen.findByRole('button', { name: 'composer.modelPanel.fastOff' }))
        expect(screen.getByRole('button', { name: 'composer.modelPanel.fastOn' })).toBeInTheDocument()

        // 切到精简模型：闪电该随能力消失，档位该从 xhigh 收敛到 medium
        fireEvent.click(screen.getByRole('button', { name: /Fast Model/ }))
        fireEvent.click(await screen.findByRole('option', { name: /Plain Model/ }))

        await waitFor(() => {
            expect(screen.queryByRole('button', { name: 'composer.modelPanel.fastOn' })).not.toBeInTheDocument()
        })

        await submit()
        const input = spawnSpy.mock.calls[0][0] as Record<string, unknown>
        expect(input.model).toBe('plain-model')
        expect(input.effort).toBe('medium')
        expect(input.fastMode).toBeUndefined()
    })
})
