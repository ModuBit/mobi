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

import { describe, expect, it, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { SkillInfo } from '@mobi/shared'

/** vi.mock 工厂提升先于 const 声明，被工厂引用的桩须 vi.hoisted */
const { mockMessage, mockMutate, mockVisibility, mockModal, mockDeleteAsync, mockInstallAsync, mockUpdateMutate, mockBundled, mockNavigate, mockSaveDraftText, mockCreatePrompt, mockFindAsync } = vi.hoisted(() => {
    return {
        /** toast 断言靶（App.useApp 返回的 message） */
        mockMessage: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
        /** 票 03 启停 mutation 桩：默认静默成功，用例可改写 mutate 行为 */
        mockMutate: vi.fn(),
        mockVisibility: {
            mutate: null as unknown as ReturnType<typeof vi.fn>,
            isPending: false,
            variables: null as { name: string } | null,
        },
        /** 票 04：modal.confirm 桩——捕获配置并同步执行 onOk */
        mockModal: {
            confirm: vi.fn((opts: { onOk?: () => Promise<void> }) => {
                void opts.onOk?.()
            }),
        },
        mockDeleteAsync: vi.fn(),
        mockInstallAsync: vi.fn(),
        mockUpdateMutate: vi.fn(),
        /** 票 06：内置名单桩（旧用例默认空；票 06 用例 mockReturnValue 覆盖） */
        mockBundled: { bundled: [], isLoading: false, error: null },
        /** 票 07：新建流程桩 */
        mockNavigate: vi.fn(),
        mockSaveDraftText: vi.fn(),
        mockCreatePrompt: vi.fn(),
        /** 生态搜索桩（安装弹窗「先搜再装」段） */
        mockFindAsync: vi.fn(),
    }
})
mockVisibility.mutate = mockMutate

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
    initReactI18next: { type: '3rd-party', init: () => {} },
}))
// ConfirmMorph（详情 sheet 卸载钮）：motion stub 下默认 6s confirmTimeout 窗口不可靠
// （自有测试也须关超时才能测）——此处以双击等价件替身，保留「两击确认」行为断言；
// ConfirmMorph 自身契约由 tests/ui/base/ConfirmMorph.test.tsx 守护
vi.mock('@/ui/base/interactive/confirm-morph/ConfirmMorph', () => ({
    ConfirmMorph: function ConfirmMorphStub({ label, prompt, onConfirm }: { label: string; prompt?: string; onConfirm?: () => Promise<boolean> | boolean }) {
        const [armed, setArmed] = useState(false)
        return (
            <button
                type="button"
                data-testid="confirm-morph"
                title={prompt}
                onClick={() => { if (armed) void onConfirm?.(); else setArmed(true) }}
            >
                {armed ? (prompt ?? `${label}?`) : label}
            </button>
        )
    },
}))
vi.mock('antd', async (importOriginal) => {
    const actual = await importOriginal<typeof import('antd')>()
    return {
        ...actual,
        // App.useApp 的 message/modal 走 mock（toast 与确认弹窗断言直接看调用）
        App: { ...actual.App, useApp: () => ({ message: mockMessage, modal: mockModal }) },
    }
})
vi.mock('@/core/data/hooks/queries/useWorkspaces', () => ({
    useWorkspaces: vi.fn(),
}))
vi.mock('@/core/data/hooks/queries/useSkills', () => ({
    useSkills: vi.fn(),
    // 默认桩（旧用例不关心启停），票 03 用例再 mockReturnValue 覆盖
    useSkillVisibility: vi.fn(() => mockVisibility),
    useSkillDelete: vi.fn(() => ({ mutateAsync: mockDeleteAsync })),
    useSkillInstall: vi.fn(() => ({ mutateAsync: mockInstallAsync, isPending: false })),
    useSkillUpdate: vi.fn(() => ({ mutate: mockUpdateMutate, isPending: false, variables: null })),
    // createPrompt 桩保持 api 返回形状（res.data.prompt），useSkillsActions 透明消费
    useSkillCreatePrompt: vi.fn(() => ({ mutateAsync: mockCreatePrompt, isPending: false })),
    // 两步式安装清单桩（res.data.skills）；安装弹窗用例可覆盖
    useSkillAvailable: vi.fn(() => ({
        mutateAsync: vi.fn(async () => ({ data: { skills: [] } })),
        isPending: false,
    })),
    // 生态搜索桩（res.data.skills）；「先搜再装」用例覆盖
    useSkillFind: vi.fn(() => ({ mutateAsync: mockFindAsync, isPending: false })),
    useBundledSkills: vi.fn(() => mockBundled),
    // 占用桩：默认 ws-1 有技能（tabs 显示工作区）；空项目隐藏用例再覆盖
    useSkillOccupancy: vi.fn(() => ({ workspaceIds: ['ws-1'] })),
    // 详情桩：正文 + 空 meta（detail 请求随 sheet 开启发出；用例可覆盖）。
    // skill 行数据头部展示走列表行 prop，桩内对象仅占位（vi.hoisted 早于 fixture 声明）
    useSkillDetail: vi.fn(() => ({
        detail: { skill: { name: '' } as never, body: 'SKILL BODY', meta: {} },
        isLoading: false,
        error: null,
    })),
}))
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => mockNavigate,
}))
vi.mock('@/core/lib/draftText', () => ({
    saveDraftText: mockSaveDraftText,
    consumeDraftText: vi.fn(() => null),
}))
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({ skills: { createPrompt: mockCreatePrompt } }),
}))

import { SkillsSection } from '@/features/settings/sections/SkillsSection'
import { useSkills, useSkillVisibility, useBundledSkills, useSkillOccupancy, useSkillDetail, useSkillAvailable } from '@/core/data/hooks/queries/useSkills'
import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'

afterEach(() => {
    cleanup()
    // resetAllMocks（非 clearAllMocks）：mockReturnValue 的用例级覆盖必须随用例结束恢复
    // vi.fn(impl) 原始工厂，否则空项目用例的 occupancy 覆盖会泄漏进后续用例
    vi.resetAllMocks()
    mockVisibility.isPending = false
    mockVisibility.variables = null
})

/** fixture：三来源 + 遮蔽/停用各一（字段省略处走 schema 缺省）。
 *  插件携带 skill 已归类系统视角（bundled 端点），个人视角清单不含——见票 06 用例 */
const GLOBAL_SKILLS = [
    {
        name: 'alpha', description: 'Alpha personal skill', source: 'personal',
        form: 'directory', path: '/x/alpha/SKILL.md', tracked: false, overrideable: true, deletable: true,
        effectiveState: null, effectiveFromLayer: null, ownState: null,
    },
    {
        name: 'beta', description: 'From skills CLI', source: 'personal',
        form: 'symlink', path: '/x/beta/SKILL.md', tracked: true, installSource: 'vercel-labs/skills',
        overrideable: true, deletable: true, effectiveState: null, effectiveFromLayer: null, ownState: null,
    },
    {
        name: 'shadowed-one', source: 'personal', form: 'directory', path: '/x/s/SKILL.md',
        tracked: false, overrideable: true, deletable: true,
        effectiveState: 'off', effectiveFromLayer: 'local', ownState: 'on',
    },
    {
        name: 'plain-off', source: 'personal', form: 'directory', path: '/x/o/SKILL.md',
        tracked: false, overrideable: true, deletable: true,
        effectiveState: 'off', effectiveFromLayer: 'user', ownState: 'off',
    },
] satisfies SkillInfo[]

const WS_SKILLS = [
    {
        name: 'proj-plain', description: 'Project skill', source: 'project',
        form: 'directory', path: '/w/p/SKILL.md', tracked: false, overrideable: true, deletable: true,
        effectiveState: null, effectiveFromLayer: null, ownState: null,
    },
] satisfies SkillInfo[]

/** 按 tab 视角回数据（global | ws-1） */
const mockSkillsByScope = vi.fn((workspaceId: string) => ({
    skills: workspaceId === 'global' ? GLOBAL_SKILLS : WS_SKILLS,
    isLoading: false,
}))

describe('SkillsSection（票 02：tabs + 列表 + 搜索）', () => {
    it('默认全局视角渲染 skill 行：名字/描述/来源徽标/安装来源', () => {
        vi.mocked(useWorkspaces).mockReturnValue({ data: [{ id: 'ws-1', name: 'Demo Workspace' }] } as never)
        vi.mocked(useSkills).mockImplementation(mockSkillsByScope)

        render(<SkillsSection />)

        expect(screen.getByText('alpha')).toBeTruthy()
        expect(screen.getByText('Alpha personal skill')).toBeTruthy()
        // 多行同来源：存在性断言用 getAllByText
        expect(screen.getAllByText('settings.skills.source.personal').length).toBeGreaterThan(0)
        expect(screen.getByText('settings.skills.trackedFrom')).toBeTruthy()
        // 插件携带行已归系统视角：个人 tab 不渲染
        expect(screen.queryByText('settings.skills.source.plugin')).toBeNull()
    })

    it('tabs 含全局与每个工作区；切换工作区 tab 换数据源', async () => {
        vi.mocked(useWorkspaces).mockReturnValue({ data: [{ id: 'ws-1', name: 'Demo Workspace' }] } as never)
        vi.mocked(useSkills).mockImplementation(mockSkillsByScope)

        render(<SkillsSection />)

        expect(screen.getByText('Demo Workspace')).toBeTruthy()
        expect(screen.queryByText('proj-plain')).toBeNull()

        fireEvent.click(screen.getByText('Demo Workspace'))
        await waitFor(() => expect(screen.getByText('proj-plain')).toBeTruthy())
        expect(screen.queryByText('alpha')).toBeNull()
    })

    it('搜索过滤当前 tab：匹配名字保留、无匹配出空态文案', () => {
        vi.mocked(useWorkspaces).mockReturnValue({ data: [] } as never)
        vi.mocked(useSkills).mockImplementation(mockSkillsByScope)

        render(<SkillsSection />)

        const input = screen.getByPlaceholderText('settings.skills.searchPlaceholder')
        fireEvent.change(input, { target: { value: 'alpha' } })
        expect(screen.getByText('alpha')).toBeTruthy()
        expect(screen.queryByText('beta')).toBeNull()

        fireEvent.change(input, { target: { value: 'zzz-no-match' } })
        expect(screen.getByText('settings.skills.emptyFiltered')).toBeTruthy()
    })

    it('生效态：own off 显示停用徽标；own on 被 local 压制显示遮蔽徽标', () => {
        vi.mocked(useWorkspaces).mockReturnValue({ data: [] } as never)
        vi.mocked(useSkills).mockImplementation(mockSkillsByScope)

        render(<SkillsSection />)

        expect(screen.getByText('settings.skills.state.off')).toBeTruthy()
        expect(screen.getByText('settings.skills.state.shadowed')).toBeTruthy()
    })

    it('空列表显示空态文案', () => {
        vi.mocked(useWorkspaces).mockReturnValue({ data: [] } as never)
        vi.mocked(useSkills).mockReturnValue({ skills: [], isLoading: false })

        render(<SkillsSection />)

        expect(screen.getByText('settings.skills.empty')).toBeTruthy()
    })

    it('无技能的工作区不出现在 tabs，但弹窗 radio 仍可选（空项目可建第一个 skill）', async () => {
        vi.mocked(useWorkspaces).mockReturnValue({ data: [{ id: 'ws-1', name: 'Demo Workspace' }] } as never)
        vi.mocked(useSkills).mockImplementation(mockSkillsByScope)
        vi.mocked(useSkillOccupancy).mockReturnValue({ workspaceIds: [] })

        render(<SkillsSection />)

        // tabs 里没有空项目（tabs 容器内限定——弹窗 radio 的同名文本不参与）
        expect(within(screen.getByTestId('skills-tabs')).queryByText('Demo Workspace')).toBeNull()

        // 新建弹窗 radio 仍有该项目（目标 scope 用全量清单）
        screen.getByTestId('skills-create').click()
        await screen.findByText('settings.skills.createSubmit')
        expect(document.querySelector('input[type="radio"][value="ws-1"]')).not.toBeNull()
    })
})

describe('SkillsSection（票 03：启停开关）', () => {
    function setupGlobal() {
        vi.mocked(useWorkspaces).mockReturnValue({ data: [] } as never)
        vi.mocked(useSkills).mockImplementation(mockSkillsByScope)
        vi.mocked(useSkillVisibility).mockReturnValue(mockVisibility as never)
        render(<SkillsSection />)
    }

    /** 找某 skill 行内的 Switch（role=switch） */
    function switchOf(name: string): HTMLElement {
        const row = screen.getByText(name).closest('[data-skill-name]')!
        return row.querySelector('[role="switch"]')!
    }

    it('overrideable 行渲染开关，点击携带当前 tab 与目标态发起 mutation', () => {
        setupGlobal()

        // alpha（personal，overrideable）有开关；停用行同有（开关即恢复入口）
        expect(switchOf('alpha')).toBeTruthy()
        expect(switchOf('plain-off')).toBeTruthy()

        fireEvent.click(switchOf('alpha'))
        expect(mockMutate).toHaveBeenCalledWith(
            { name: 'alpha', enabled: false, workspaceId: 'global' },
            expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
        )
    })

    it('打开后被更高层压制：响应 effectiveState=off → 弹遮蔽提示', () => {
        setupGlobal()

        fireEvent.click(switchOf('plain-off')) // off → on
        const opts = mockMutate.mock.calls[0]![1]!
        opts.onSuccess({ effectiveState: 'off' })
        expect(mockMessage.warning).toHaveBeenCalledWith('settings.skills.shadowedToast')
    })

    it('打开后正常生效：不弹遮蔽提示', () => {
        setupGlobal()

        fireEvent.click(switchOf('plain-off'))
        const opts = mockMutate.mock.calls[0]![1]!
        opts.onSuccess({ effectiveState: null })
        expect(mockMessage.warning).not.toHaveBeenCalled()
    })

    it('失败：弹错误提示', () => {
        setupGlobal()

        fireEvent.click(switchOf('alpha'))
        const opts = mockMutate.mock.calls[0]![1]!
        opts.onError(new Error('x'))
        expect(mockMessage.error).toHaveBeenCalledWith('settings.skills.toggleFailed')
    })
})

describe('SkillsSection（票 04：删除——详情 sheet 内 ConfirmMorph 就地确认）', () => {
    /** ConfirmMorph 双击替身：一击 armed（armed 面显示 prompt 文案），再击确认 */
    async function confirmDelete() {
        fireEvent.click(screen.getByText('settings.skills.detail.delete'))
        fireEvent.click(screen.getByText('settings.skills.deleteConfirmUntracked'))
    }

    function setup() {
        vi.mocked(useWorkspaces).mockReturnValue({ data: [] } as never)
        vi.mocked(useSkills).mockImplementation(mockSkillsByScope)
        vi.mocked(useSkillVisibility).mockReturnValue(mockVisibility as never)
        render(<SkillsSection />)
    }

    it('行点击开详情 sheet：deletable 行有卸载入口', async () => {
        setup()

        // alpha（personal，deletable）→ sheet 内有 ConfirmMorph
        fireEvent.click(screen.getByText('alpha'))
        await screen.findByText('settings.skills.detail.delete')
    })

    it('untracked 卸载：两击确认后发起删除 + 成功 toast', async () => {
        setup()
        mockDeleteAsync.mockResolvedValueOnce(undefined)

        fireEvent.click(screen.getByText('alpha'))
        await screen.findByText('settings.skills.detail.delete')
        await confirmDelete()

        await waitFor(() => expect(mockDeleteAsync).toHaveBeenCalledWith({ name: 'alpha', workspaceId: 'global' }))
        expect(mockMessage.success).toHaveBeenCalledWith('settings.skills.deleted')
    })

    it('tracked 卸载：确认提示用 CLI 卸载文案（带安装来源）', async () => {
        setup()
        mockDeleteAsync.mockResolvedValueOnce(undefined)

        fireEvent.click(screen.getByText('beta'))
        await screen.findByText('settings.skills.detail.delete')

        // armed 文案 = tracked 分支（deleteConfirmTracked，带安装来源）；确认后发起删除
        fireEvent.click(screen.getByText('settings.skills.detail.delete'))
        fireEvent.click(screen.getByText('settings.skills.deleteConfirmTracked'))
        await waitFor(() => expect(mockDeleteAsync).toHaveBeenCalled())
    })

    it('失败（无透传详情）：通用失败 toast', async () => {
        setup()
        mockDeleteAsync.mockRejectedValueOnce(new Error('network'))

        fireEvent.click(screen.getByText('alpha'))
        await screen.findByText('settings.skills.detail.delete')
        await confirmDelete()

        await waitFor(() => expect(mockMessage.error).toHaveBeenCalledWith('settings.skills.deleteFailed'))
    })

    it('失败（daemon 透传 CLI 输出）：输出原样呈现', async () => {
        setup()
        mockDeleteAsync.mockRejectedValueOnce({ response: { data: { error: 'npm error: not found in lock' } } } as never)

        fireEvent.click(screen.getByText('alpha'))
        await screen.findByText('settings.skills.detail.delete')
        await confirmDelete()

        await waitFor(() => expect(mockMessage.error).toHaveBeenCalledWith('npm error: not found in lock'))
    })
})

describe('SkillsSection（票 05：安装与更新）', () => {
    function setup(ws = false) {
        vi.mocked(useWorkspaces).mockReturnValue(
            ws ? { data: [{ id: 'ws-1', name: 'Demo Workspace' }] } as never : { data: [] } as never,
        )
        vi.mocked(useSkills).mockImplementation(mockSkillsByScope)
        vi.mocked(useSkillVisibility).mockReturnValue(mockVisibility as never)
        render(<SkillsSection />)
    }

    it('更新入口在详情 sheet（tracked 行）：点击发起 update mutation + 成功 toast', async () => {
        setup()
        mockUpdateMutate.mockImplementationOnce((_vars, opts) => { opts?.onSuccess?.() })

        // 点 tracked 行 beta 开 sheet → sheet 内更新钮
        fireEvent.click(screen.getByText('beta'))
        const updateBtn = await screen.findByText('settings.skills.detail.update')
        fireEvent.click(updateBtn)
        await waitFor(() => {
            expect(mockUpdateMutate).toHaveBeenCalledWith(
                { name: 'beta', workspaceId: 'global' },
                expect.anything(),
            )
        })
        expect(mockMessage.success).toHaveBeenCalledWith('settings.skills.updated')
    })

    it('安装弹窗：单 skill 来源 → 获取清单直达安装（installAsync 携带勾选）', async () => {
        setup()
        mockInstallAsync.mockResolvedValueOnce({ data: { ok: true, installed: ['only-skill'], failed: [] } })
        vi.mocked(useSkillAvailable).mockReturnValue({
            mutateAsync: vi.fn(async () => ({
                data: { skills: [{ name: 'only-skill', description: 'Only one', installed: false, conflict: false }] },
            })),
            isPending: false,
        } as never)

        screen.getByTestId('skills-install').click()
        const input = await screen.findByPlaceholderText('settings.skills.installSourcePlaceholder')
        fireEvent.change(input, { target: { value: 'vercel-labs/skills' } })

        // 输入段确认钮（okText=installFetch）→ 单 skill 跳过选择直达安装
        fireEvent.click(screen.getByText('settings.skills.installFetch'))
        await waitFor(() =>
            expect(mockInstallAsync).toHaveBeenCalledWith({ source: 'vercel-labs/skills', scope: 'global', skills: ['only-skill'] }))
        expect(mockMessage.success).toHaveBeenCalledWith('settings.skills.installed')
    })

    it('安装弹窗：多 skill → 选择段（已装 readonly 默认排除）→ 提交携带勾选', async () => {
        setup()
        mockInstallAsync.mockResolvedValueOnce({ data: { ok: true, installed: ['a'], failed: [] } })
        vi.mocked(useSkillAvailable).mockReturnValue({
            mutateAsync: vi.fn(async () => ({
                data: { skills: [
                    { name: 'a', description: 'Opt A', installed: false, conflict: false },
                    { name: 'b', description: 'Already installed', installed: true, conflict: false },
                    { name: 'c', description: 'Opt C', installed: false, conflict: false },
                ] },
            })),
            isPending: false,
        } as never)

        screen.getByTestId('skills-install').click()
        const input = await screen.findByPlaceholderText('settings.skills.installSourcePlaceholder')
        fireEvent.change(input, { target: { value: 'vercel-labs/skills' } })
        fireEvent.click(screen.getByText('settings.skills.installFetch'))

        // 选择段出现：三个名字都在（b 已装 readonly 勾上但禁用）
        await screen.findByText('b')
        const bOption = screen.getByText('b').closest('.skill-option')!
        expect(bOption.querySelector('[disabled]')).toBeTruthy()

        // 提交：默认勾选 = 未装项（a、c；已装 b 不在列）
        fireEvent.click(screen.getByText('settings.skills.installSubmit'))
        await waitFor(() =>
            expect(mockInstallAsync).toHaveBeenCalledWith({ source: 'vercel-labs/skills', scope: 'global', skills: ['a', 'c'] }))
    })

    it('安装失败：弹窗保持开（可改来源重试）+ 失败 toast', async () => {
        setup()
        mockInstallAsync.mockRejectedValueOnce(new Error('x'))
        vi.mocked(useSkillAvailable).mockReturnValue({
            mutateAsync: vi.fn(async () => ({
                data: { skills: [{ name: 'only-skill', description: 'Only one', installed: false, conflict: false }] },
            })),
            isPending: false,
        } as never)

        screen.getByTestId('skills-install').click()
        const input = await screen.findByPlaceholderText('settings.skills.installSourcePlaceholder')
        fireEvent.change(input, { target: { value: 'bad/repo' } })
        fireEvent.click(screen.getByText('settings.skills.installFetch'))
        await waitFor(() => expect(mockMessage.error).toHaveBeenCalledWith('settings.skills.installFailed'))

        // 弹窗未关：输入框仍在
        expect(screen.getByPlaceholderText('settings.skills.installSourcePlaceholder')).toBeTruthy()
    })

    it('安装弹窗：生态搜索点选命中 → 带入来源直达选择段（只预勾命中项）', async () => {
        setup()
        mockFindAsync.mockResolvedValueOnce({ data: { skills: [
            { name: 'pdf', source: 'anthropics/skills', skillId: 'pdf', installs: 231296 },
        ] } })
        const availAsync = vi.fn(async () => ({
            data: { skills: [
                { name: 'pdf', description: 'PDF tools', installed: false, conflict: false },
                { name: 'docx', description: 'DOCX tools', installed: false, conflict: false },
            ] },
        }))
        vi.mocked(useSkillAvailable).mockReturnValue({ mutateAsync: availAsync, isPending: false } as never)
        mockInstallAsync.mockResolvedValueOnce({ data: { ok: true, installed: ['pdf'], failed: [] } })

        screen.getByTestId('skills-install').click()
        const findInput = await screen.findByPlaceholderText('settings.skills.findPlaceholder')
        fireEvent.change(findInput, { target: { value: 'pdf' } })
        fireEvent.keyDown(findInput, { key: 'Enter' })

        // 命中行（名称 + 来源 · 安装数）点选 → 拉该 repo 清单
        const hit = (await screen.findByText('anthropics/skills · settings.skills.findInstalls')).closest('button')!
        fireEvent.click(hit)
        await waitFor(() =>
            expect(availAsync).toHaveBeenCalledWith({ source: 'anthropics/skills', workspaceId: 'global' }))

        // 选择段只预勾命中的 pdf（同 repo 的 docx 不默认勾选）
        await screen.findByText('docx')
        fireEvent.click(screen.getByText('settings.skills.installSubmit'))
        await waitFor(() =>
            expect(mockInstallAsync).toHaveBeenCalledWith({ source: 'anthropics/skills', scope: 'global', skills: ['pdf'] }))
    })

    it('安装弹窗：搜索无结果 → 空态提示', async () => {
        setup()
        mockFindAsync.mockResolvedValueOnce({ data: { skills: [] } })

        screen.getByTestId('skills-install').click()
        const findInput = await screen.findByPlaceholderText('settings.skills.findPlaceholder')
        fireEvent.change(findInput, { target: { value: 'zzz-no-hit' } })
        fireEvent.keyDown(findInput, { key: 'Enter' })

        await screen.findByText('settings.skills.findEmpty')
    })
})

describe('SkillsSection（票 06：系统 tab 内置名单）', () => {
    function setup(bundled: typeof mockBundled = { bundled: [], isLoading: false, error: null }) {
        vi.mocked(useWorkspaces).mockReturnValue({ data: [{ id: 'ws-1', name: 'Demo Workspace' }] } as never)
        vi.mocked(useSkills).mockImplementation(mockSkillsByScope)
        vi.mocked(useSkillVisibility).mockReturnValue(mockVisibility as never)
        vi.mocked(useBundledSkills).mockReturnValue(bundled)
        render(<SkillsSection />)
    }

    /** fixture：内置两行（其一与个人 skill 同名，覆盖判定用）+ 插件携带行（mobi 内置插件归类系统视角） */
    const BUNDLED = [
        { name: 'alpha', description: 'Bundled alpha (shadowed by personal)' },
        { name: 'doctor', description: 'Health-check the setup' },
        { name: 'visualize', description: 'From mobi plugin', pluginName: 'mobi' },
    ]

    /** 进入系统 tab（bundled 数据只属该 tab，i18n mock 下 tab 文本 = 键名） */
    function openBundledTab() {
        fireEvent.click(screen.getByText('settings.skills.tabBundled'))
    }

    it('个人 tab 默认不渲染内置名单；系统 tab 渲染只读行（内置徽标、无开关/删除/更新）', () => {
        setup({ bundled: BUNDLED, isLoading: false, error: null })

        expect(screen.queryByText('settings.skills.source.bundled')).toBeNull()
        openBundledTab()

        // 内置徽标只属 CC 内置行；插件携带行走插件徽标
        expect(screen.getAllByText('settings.skills.source.bundled').length).toBe(2)
        expect(screen.getByText('settings.skills.source.plugin')).toBeTruthy()

        const bundledRow = document.querySelector('[data-bundled="true"][data-skill-name="doctor"]')!
        expect(bundledRow.querySelector('[role="switch"]')).toBeNull()
        expect(bundledRow.querySelector('[data-skill-delete="doctor"]')).toBeNull()
        expect(bundledRow.querySelector('[data-skill-update="doctor"]')).toBeNull()
    })

    it('插件携带行可点进只读详情 sheet：无开关/更新/卸载入口', async () => {
        setup({ bundled: BUNDLED, isLoading: false, error: null })
        openBundledTab()

        fireEvent.click(screen.getByText('visualize'))
        await screen.findByText('SKILL BODY')

        expect(screen.queryByText('settings.skills.detail.delete')).toBeNull()
        expect(screen.queryByText('settings.skills.detail.update')).toBeNull()
        expect(document.querySelector('[role="switch"]')).toBeNull()
    })

    it('与个人 skill 同名的内置行显示覆盖徽标（用户胜）', () => {
        setup({ bundled: BUNDLED, isLoading: false, error: null })
        openBundledTab()

        const covered = document.querySelector('[data-bundled="true"][data-skill-name="alpha"]')!
        expect(covered.textContent).toContain('settings.skills.coveredByLocal')
        const notCovered = document.querySelector('[data-bundled="true"][data-skill-name="doctor"]')!
        expect(notCovered.textContent).not.toContain('settings.skills.coveredByLocal')
    })

    it('系统 tab 空名单：空态文案（与个人 tab 空态区分）', () => {
        setup()
        openBundledTab()

        expect(screen.getByText('settings.skills.emptyBundled')).toBeTruthy()
    })

    it('工作区 tab 不渲染内置名单', () => {
        setup({ bundled: BUNDLED, isLoading: false, error: null })

        fireEvent.click(within(screen.getByTestId('skills-tabs')).getByText('Demo Workspace'))
        expect(screen.queryByText('settings.skills.source.bundled')).toBeNull()
    })

    it('内置名单加载失败：错误提示（不伪装空名单静默）', () => {
        setup({ bundled: [], isLoading: false, error: new Error('probe timeout') })
        openBundledTab()

        expect(screen.getByText('settings.skills.bundledFailed')).toBeTruthy()
    })
})

describe('SkillsSection（票 07：对话式新建）', () => {
    function setup(ws: { id: string; name: string }[] = [{ id: 'ws-1', name: 'Demo Workspace' }]) {
        vi.mocked(useWorkspaces).mockReturnValue({ data: ws } as never)
        vi.mocked(useSkills).mockImplementation(mockSkillsByScope)
        vi.mocked(useSkillVisibility).mockReturnValue(mockVisibility as never)
        render(<SkillsSection />)
    }

    it('新建弹窗：确认后 createPrompt → 草稿预填 + 跳新会话页（带宿主工作区）', async () => {
        setup()
        mockCreatePrompt.mockResolvedValueOnce({ data: { targetDir: '/x/skills', prompt: 'CREATE PROMPT' } })

        screen.getByTestId('skills-create').click()
        fireEvent.click(await screen.findByText('settings.skills.createSubmit'))

        await waitFor(() => {
            expect(mockCreatePrompt).toHaveBeenCalledWith('global')
            expect(mockSaveDraftText).toHaveBeenCalledWith('CREATE PROMPT')
            expect(mockNavigate).toHaveBeenCalledWith({
                to: '/sessions/new',
                search: { workspaceId: 'ws-1' },
            })
        })
    })

    it('scope 切到工作区：createPrompt 用该 ws、宿主同为该 ws', async () => {
        setup()
        mockCreatePrompt.mockResolvedValueOnce({ data: { targetDir: '/w/.claude/skills', prompt: 'P' } })

        screen.getByTestId('skills-create').click()
        // 弹窗内的 scope radio（与 tabs 同名文本区分，按 value 定位）
        await screen.findByText('settings.skills.createSubmit')
        const wsRadio = document.querySelector('input[type="radio"][value="ws-1"]') as HTMLInputElement
        fireEvent.click(wsRadio)
        fireEvent.click(screen.getByText('settings.skills.createSubmit'))

        await waitFor(() => {
            expect(mockCreatePrompt).toHaveBeenCalledWith('ws-1')
            expect(mockNavigate).toHaveBeenCalledWith({
                to: '/sessions/new',
                search: { workspaceId: 'ws-1' },
            })
        })
    })

    it('global 且无工作区：提示不跳转', async () => {
        setup([])
        mockMessage.warning.mockClear()

        screen.getByTestId('skills-create').click()
        fireEvent.click(await screen.findByText('settings.skills.createSubmit'))

        await waitFor(() => expect(mockMessage.warning).toHaveBeenCalledWith('settings.skills.createNoWorkspace'))
        expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('工作区清单加载中（undefined ≠ 空数组）：不误弹「无工作区」（code-review 修复）', async () => {
        // 修复前：pending 期提交 → data undefined 被当「无工作区」→ 误弹 warning
        vi.mocked(useWorkspaces).mockReturnValue({ data: undefined, isLoading: true } as never)
        vi.mocked(useSkills).mockImplementation(mockSkillsByScope)
        vi.mocked(useSkillVisibility).mockReturnValue(mockVisibility as never)
        render(<SkillsSection />)
        mockMessage.warning.mockClear()

        screen.getByTestId('skills-create').click()
        fireEvent.click(await screen.findByText('settings.skills.createSubmit'))

        // 静默拒绝：不发请求、不弹误导提示、不跳转
        expect(mockCreatePrompt).not.toHaveBeenCalled()
        expect(mockMessage.warning).not.toHaveBeenCalledWith('settings.skills.createNoWorkspace')
        expect(mockNavigate).not.toHaveBeenCalled()
    })
})
