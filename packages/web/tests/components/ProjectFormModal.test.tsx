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

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
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

/** 弹窗底部主按钮（确定/保存）——Modal 渲染在 body 门户，不能查 render 容器 */
function okButton(): HTMLButtonElement {
    const btn = document.querySelector('.ant-modal-footer .ant-btn-primary')
    if (!(btn instanceof HTMLButtonElement)) throw new Error('ok button not found')
    return btn
}

describe('ProjectFormModal', () => {
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

        // validateProjectFolders 的报错提示（shared 侧字面量）
        expect(await screen.findByText('Exactly one primary folder is required')).toBeInTheDocument()
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
            expect(screen.getByText('Exactly one primary folder is required')).toBeInTheDocument()
        })
        expect(okButton()).toBeDisabled()
        // 第一行已移除，只剩 /b
        expect(screen.queryByDisplayValue('/a')).toBeNull()
        expect(screen.getByDisplayValue('/b')).toBeInTheDocument()
    })

    it('合法编辑提交：走 update 分支并剥掉行 key', async () => {
        const project = makeProject()
        renderModal(project)
        await screen.findByDisplayValue('Demo')

        fireEvent.click(okButton())

        await waitFor(() => {
            expect(updateMutateAsync).toHaveBeenCalledTimes(1)
        })
        expect(updateMutateAsync).toHaveBeenCalledWith({
            projectId: 'p1',
            patch: {
                name: 'Demo',
                folders: [{ path: '/home/u/demo', primary: true }],
            },
        })
        expect(createMutateAsync).not.toHaveBeenCalled()
    })
})
