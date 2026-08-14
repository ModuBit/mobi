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

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { App as AntdApp } from 'antd'
import type { ReactNode } from 'react'

// jsdom 没有 ResizeObserver（antd Modal/Select 等组件依赖）
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

afterEach(cleanup)

// ============ 稳定 mock 引用（返回新引用会致 effect 无限循环——项目已知坑） ============

const machinesResult = vi.hoisted(() => ({
    machines: [{
        id: 'm1',
        active: true,
        metadata: { displayName: 'Dev Box', platform: 'darwin', homeDir: '/home/u' },
    }],
    isLoading: false,
}))
vi.mock('@/core/data/hooks/queries/useMachines', () => ({
    useMachines: () => machinesResult,
}))

const createMutateAsync = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const updateMutateAsync = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const createMutationResult = vi.hoisted(() => ({ mutateAsync: createMutateAsync, isPending: false }))
const updateMutationResult = vi.hoisted(() => ({ mutateAsync: updateMutateAsync, isPending: false }))
vi.mock('@/core/data/hooks/mutations/useProjectMutations', () => ({
    useCreateProject: () => createMutationResult,
    useUpdateProject: () => updateMutationResult,
}))

const listingResult = vi.hoisted(() => ({ options: [], isLoading: false }))
vi.mock('@/components/session/useMachineDirectoryListing', () => ({
    useMachineDirectoryListing: () => listingResult,
    parsePrefixInput: vi.fn(),
}))

vi.mock('react-i18next', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        useTranslation: () => ({ t: (k: string) => k }),
    }
})

// 端别受控（setup.ts 的 matchMedia mock 恒不匹配 → useIsMobile 恒 true，需显式钉住）
const mobileState = vi.hoisted(() => ({ current: false }))
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useIsMobile: () => mobileState.current,
}))

import { ProjectFormModal } from '@/components/project/ProjectFormModal'
import type { Project } from '@/core/data/api/types'

function makeProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 'p1',
        namespace: 'ns',
        machineId: 'm1',
        name: 'Demo',
        folders: [{ path: '/home/u/demo', primary: true }],
        createdAt: 1,
        updatedAt: 1,
        seq: 1,
        ...overrides,
    }
}

function renderModal(project?: Project | null) {
    return render(
        <AntdApp>
            <ProjectFormModal open onClose={() => {}} project={project ?? null} />
        </AntdApp>,
    )
}

/** 弹窗底部主按钮（确定/保存）——Modal/Drawer 均渲染在 body 门户，不能查 render 容器 */
function okButton(): HTMLButtonElement {
    // PC 走 Modal footer；移动端操作按钮随表单流入 Drawer body
    const selector = mobileState.current
        ? '.ant-drawer-body .ant-btn-primary'
        : '.ant-modal-footer .ant-btn-primary'
    const btn = document.querySelector(selector)
    if (!(btn instanceof HTMLButtonElement)) throw new Error('ok button not found')
    return btn
}

describe('ProjectFormModal（PC Modal 形态）', () => {
    it('编辑模式回填 name/folders，单机时隐藏机器选择器', async () => {
        const project = makeProject({
            folders: [
                { path: '/home/u/demo', primary: true },
                { path: '/home/u/demo/sub', primary: false },
            ],
        })
        renderModal(project)

        // 标题为编辑
        expect(await screen.findByText('project.edit')).toBeInTheDocument()
        // name 回填
        expect(screen.getByDisplayValue('Demo')).toBeInTheDocument()
        // 两个文件夹路径回填
        expect(screen.getByDisplayValue('/home/u/demo')).toBeInTheDocument()
        expect(screen.getByDisplayValue('/home/u/demo/sub')).toBeInTheDocument()
        // 单机：机器选择器隐藏（AutoComplete 也是 ant-select，按 placeholder 断言）
        expect(screen.queryByPlaceholderText('newSession.machinePlaceholder')).toBeNull()
        // 回填即合法：提交可用
        expect(okButton()).toBeEnabled()
    })

    it('双 primary 校验门禁：提示报错 + 提交禁用', async () => {
        const project = makeProject({
            folders: [
                { path: '/a', primary: true },
                { path: '/b', primary: true },
            ],
        })
        renderModal(project)

        // shared 出错误码，表单映射 i18n key（mock t 原样返回 key）
        expect(await screen.findByText('project.foldersInvalid')).toBeInTheDocument()
        expect(okButton()).toBeDisabled()
    })

    it('移除 primary 行后触发校验报错路径', async () => {
        const project = makeProject({
            folders: [
                { path: '/a', primary: true },
                { path: '/b', primary: false },
            ],
        })
        renderModal(project)
        await screen.findByDisplayValue('/a')

        // 删除第一行（primary）→ 剩余无 primary → 报错 + 禁用
        const removeButtons = document.querySelectorAll('button[title="project.removeFolder"]')
        expect(removeButtons.length).toBe(2)
        fireEvent.click(removeButtons[0])

        await waitFor(() => {
            expect(screen.getByText('project.foldersInvalid')).toBeInTheDocument()
        })
        expect(okButton()).toBeDisabled()
        // 第一行已移除，只剩 /b
        expect(screen.queryByDisplayValue('/a')).toBeNull()
        expect(screen.getByDisplayValue('/b')).toBeInTheDocument()
    })

    it('合法编辑提交：走 update 分支；folders 未动时 patch 只传 name（不触发 hub 全量 folders 校验）', async () => {
        const project = makeProject()
        renderModal(project)
        await screen.findByDisplayValue('Demo')

        fireEvent.click(okButton())

        await waitFor(() => {
            expect(updateMutateAsync).toHaveBeenCalledTimes(1)
        })
        expect(updateMutateAsync).toHaveBeenCalledWith({
            projectId: 'p1',
            patch: { name: 'Demo' },
        })
        expect(createMutateAsync).not.toHaveBeenCalled()
    })

    it('folders 被改动时提交携带新 folders（剥掉行 key）', async () => {
        const project = makeProject()
        renderModal(project)
        const pathInput = await waitFor(() =>
            document.querySelector('.ant-modal-body .ant-select input') as HTMLInputElement)
        fireEvent.change(pathInput, { target: { value: '/home/u/demo2' } })

        fireEvent.click(okButton())

        await waitFor(() => {
            expect(updateMutateAsync).toHaveBeenCalledWith({
                projectId: 'p1',
                patch: {
                    name: 'Demo',
                    folders: [{ path: '/home/u/demo2', primary: true }],
                },
            })
        })
    })
})

describe('ProjectFormModal（新建 + onCreated 回填）', () => {
    beforeEach(() => {
        // 本文件 mock 为 hoisted 共享实例，清掉前序 describe 的调用记录
        vi.clearAllMocks()
    })

    it('新建提交走 create 分支并回调 onCreated 携带创建出的实体', async () => {
        const createdProject = makeProject({ id: 'p-new', name: 'Fresh' })
        createMutateAsync.mockResolvedValueOnce(createdProject)
        const onCreated = vi.fn()

        render(
            <AntdApp>
                <ProjectFormModal open onClose={() => {}} project={null} onCreated={onCreated} />
            </AntdApp>,
        )
        // 单机自动选中（machines mock 只有一台）；只填名称时 folder 路径仍为空 → 门禁拦截
        const nameInput = await screen.findByPlaceholderText('project.namePlaceholder')
        fireEvent.change(nameInput, { target: { value: 'Fresh' } })
        expect(await screen.findByText('project.folderPathRequired')).toBeInTheDocument()
        expect(okButton()).toBeDisabled()

        // 补上合法路径（homeDir=/home/u）后即可提交
        // （AutoComplete 内部 input 的 placeholder 不走标准属性渲染，按结构取输入框）
        const pathInput = document.querySelector('.ant-modal-body .ant-select input') as HTMLInputElement
        expect(pathInput).not.toBeNull()
        fireEvent.change(pathInput, { target: { value: '/home/u/fresh' } })
        await waitFor(() => {
            expect(okButton()).toBeEnabled()
        })

        fireEvent.click(okButton())

        await waitFor(() => {
            expect(createMutateAsync).toHaveBeenCalledWith({
                name: 'Fresh',
                machineId: 'm1',
                folders: [{ path: '/home/u/fresh', primary: true }],
            })
        })
        // 创建出的实体原样回传，供调用方自动回填选中
        await waitFor(() => {
            expect(onCreated).toHaveBeenCalledWith(createdProject)
        })
        expect(updateMutateAsync).not.toHaveBeenCalled()
    })

    it('home 外路径门禁：提示须位于机器主目录内 + 提交禁用（与创建会话 cwd 同一约束）', async () => {
        renderModal(makeProject())

        // 新建场景无初始快照：home 外路径整体拦截
        const pathInput = document.querySelector('.ant-modal-body .ant-select input') as HTMLInputElement
        expect(pathInput).not.toBeNull()
        fireEvent.change(pathInput, { target: { value: '/etc/secret' } })

        expect(await screen.findByText('project.folderOutsideHome')).toBeInTheDocument()
        expect(okButton()).toBeDisabled()
    })

    it('存量 home 外项目：folders 未动时纯改名可保存（patch 只传 name，不做 home 校验）', async () => {
        // 早于 hub 前置校验创建的存量项目，folder 在 home 外（homeDir=/home/u）
        renderModal(makeProject({
            folders: [{ path: '/etc/legacy', primary: true }],
        }))

        // 未动 folders：不触发 home 校验，可直接提交
        expect(okButton()).toBeEnabled()

        const nameInput = screen.getByDisplayValue('Demo')
        fireEvent.change(nameInput, { target: { value: 'Renamed' } })
        fireEvent.click(okButton())

        await waitFor(() => {
            // folders 未变不传——hub 对显式传入的 folders 做全量校验，纯改名不应被存量 path 连坐
            expect(updateMutateAsync).toHaveBeenCalledWith({
                projectId: 'p1',
                patch: { name: 'Renamed' },
            })
        })
    })
})

describe('ProjectFormModal（移动端底部 Drawer 形态）', () => {
    beforeEach(() => {
        mobileState.current = true
    })

    afterEach(() => {
        mobileState.current = false
        cleanup()
    })

    it('渲染为底部 Drawer 而非 Modal，表单与操作按钮可用', async () => {
        renderModal(makeProject())

        expect(await screen.findByText('project.edit')).toBeInTheDocument()
        expect(document.querySelector('.ant-drawer')).not.toBeNull()
        expect(document.querySelector('.ant-modal')).toBeNull()
        // 编辑回填即合法：Drawer 内主按钮可用
        expect(okButton()).toBeEnabled()
        expect(screen.getByDisplayValue('Demo')).toBeInTheDocument()
    })

    it('校验不通过时禁用 Drawer 内提交按钮', async () => {
        renderModal(makeProject({
            folders: [
                { path: '/a', primary: true },
                { path: '/b', primary: true },
            ],
        }))

        expect(await screen.findByText('project.foldersInvalid')).toBeInTheDocument()
        expect(okButton()).toBeDisabled()
    })
})
