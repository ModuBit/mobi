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
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import type { SkillInfo } from '@mobi/shared'

/** vi.mock 工厂提升先于 const 声明，被工厂引用的桩须 vi.hoisted */
const { mockMessage, mockMutate, mockVisibility, mockModal, mockDeleteAsync, mockInstallAsync, mockUpdateMutate, mockBundled, mockNavigate, mockSaveDraftText, mockCreatePrompt } = vi.hoisted(() => {
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
    }
})
mockVisibility.mutate = mockMutate

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
    initReactI18next: { type: '3rd-party', init: () => {} },
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
    useBundledSkills: vi.fn(() => mockBundled),
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
import { useSkills, useSkillVisibility, useBundledSkills } from '@/core/data/hooks/queries/useSkills'
import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
    mockVisibility.isPending = false
    mockVisibility.variables = null
})

/** fixture：三来源 + 遮蔽/停用/只读各一（字段省略处走 schema 缺省） */
const GLOBAL_SKILLS = [
    {
        name: 'alpha', description: 'Alpha personal skill', source: 'personal',
        form: 'directory', path: '/x/alpha/SKILL.md', tracked: false, overrideable: true,
        effectiveState: null, effectiveFromLayer: null, ownState: null,
    },
    {
        name: 'beta', description: 'From skills CLI', source: 'personal',
        form: 'symlink', path: '/x/beta/SKILL.md', tracked: true, installSource: 'vercel-labs/skills',
        overrideable: true, effectiveState: null, effectiveFromLayer: null, ownState: null,
    },
    {
        name: 'plug', description: 'From plugin', source: 'plugin', pluginName: 'demo-plugin',
        form: 'directory', path: '/x/plug/SKILL.md', tracked: false, overrideable: false,
        effectiveState: null, effectiveFromLayer: null, ownState: null,
    },
    {
        name: 'shadowed-one', source: 'personal', form: 'directory', path: '/x/s/SKILL.md',
        tracked: false, overrideable: true,
        effectiveState: 'off', effectiveFromLayer: 'local', ownState: 'on',
    },
    {
        name: 'plain-off', source: 'personal', form: 'directory', path: '/x/o/SKILL.md',
        tracked: false, overrideable: true,
        effectiveState: 'off', effectiveFromLayer: 'user', ownState: 'off',
    },
] satisfies SkillInfo[]

const WS_SKILLS = [
    {
        name: 'proj-plain', description: 'Project skill', source: 'project',
        form: 'directory', path: '/w/p/SKILL.md', tracked: false, overrideable: true,
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
        // 插件行来源徽标
        expect(screen.getByText('settings.skills.source.plugin')).toBeTruthy()
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

        // alpha（personal，overrideable）有开关；plug（plugin，只读）没有
        expect(switchOf('alpha')).toBeTruthy()
        expect(switchOf('plug')).toBeNull()

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

describe('SkillsSection（票 04：删除）', () => {
    /** 找某 skill 行内的删除钮（data 属性定位，与 i18n mock 无关） */
    function deleteBtnOf(name: string): HTMLElement | null {
        const row = screen.getByText(name).closest('[data-skill-name]')!
        return row.querySelector(`[data-skill-delete="${name}"]`)
    }

    function setupGlobal() {
        vi.mocked(useWorkspaces).mockReturnValue({ data: [] } as never)
        vi.mocked(useSkills).mockImplementation(mockSkillsByScope)
        vi.mocked(useSkillVisibility).mockReturnValue(mockVisibility as never)
        render(<SkillsSection />)
    }

    it('personal/project 行有删除入口；plugin/synced 行没有', () => {
        setupGlobal()

        expect(deleteBtnOf('alpha')).not.toBeNull()
        expect(deleteBtnOf('plug')).toBeNull()
    })

    it('untracked：确认弹窗用直删文案；确认后发起删除 + 成功 toast', async () => {
        setupGlobal()
        mockDeleteAsync.mockResolvedValueOnce(undefined)

        deleteBtnOf('alpha')!.click()
        await waitFor(() => expect(mockDeleteAsync).toHaveBeenCalledWith({ name: 'alpha', workspaceId: 'global' }))

        const opts = mockModal.confirm.mock.calls[0]![0]!
        expect(opts.content).toBe('settings.skills.deleteConfirmUntracked')
        expect(mockMessage.success).toHaveBeenCalledWith('settings.skills.deleted')
    })

    it('tracked：确认弹窗用 CLI 卸载文案（带安装来源）', async () => {
        setupGlobal()
        mockDeleteAsync.mockResolvedValueOnce(undefined)

        deleteBtnOf('beta')!.click()
        await waitFor(() => expect(mockDeleteAsync).toHaveBeenCalled())

        const opts = mockModal.confirm.mock.calls[0]![0]!
        expect(opts.content).toBe('settings.skills.deleteConfirmTracked')
    })

    it('失败（无透传详情）：通用失败 toast', async () => {
        setupGlobal()
        mockDeleteAsync.mockRejectedValueOnce(new Error('network'))

        deleteBtnOf('alpha')!.click()
        await waitFor(() => expect(mockMessage.error).toHaveBeenCalledWith('settings.skills.deleteFailed'))
    })

    it('失败（daemon 透传 CLI 输出）：输出原样呈现', async () => {
        setupGlobal()
        mockDeleteAsync.mockRejectedValueOnce({ response: { data: { error: 'npm error: not found in lock' } } } as never)

        deleteBtnOf('alpha')!.click()
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

    it('更新入口只在 tracked 行出现；点击发起 update mutation + 成功 toast', async () => {
        setup()

        const betaRow = screen.getByText('beta').closest('[data-skill-name]')!
        const alphaRow = screen.getByText('alpha').closest('[data-skill-name]')!
        expect(betaRow.querySelector('[data-skill-update="beta"]')).not.toBeNull()
        expect(alphaRow.querySelector('[data-skill-update="alpha"]')).toBeNull()

        mockUpdateMutate.mockImplementationOnce((_vars, opts) => { opts?.onSuccess?.() })
        betaRow.querySelector('[data-skill-update="beta"]')!.click()
        await waitFor(() => {
            expect(mockUpdateMutate).toHaveBeenCalledWith(
                { name: 'beta', workspaceId: 'global' },
                expect.anything(),
            )
        })
        expect(mockMessage.success).toHaveBeenCalledWith('settings.skills.updated')
    })

    it('安装弹窗：输入来源提交 → installAsync(source, scope=当前 tab) + 成功 toast', async () => {
        setup()
        mockInstallAsync.mockResolvedValueOnce(undefined)

        screen.getByTestId('skills-install').click()
        const input = await screen.findByPlaceholderText('settings.skills.installSourcePlaceholder')
        fireEvent.change(input, { target: { value: 'vercel-labs/skills' } })

        // Modal 确认钮（okText=installSubmit）
        fireEvent.click(screen.getByText('settings.skills.installSubmit'))
        await waitFor(() =>
            expect(mockInstallAsync).toHaveBeenCalledWith({ source: 'vercel-labs/skills', scope: 'global' }))
        expect(mockMessage.success).toHaveBeenCalledWith('settings.skills.installed')
    })

    it('安装失败：弹窗保持开（可改来源重试）+ 失败 toast', async () => {
        setup()
        mockInstallAsync.mockRejectedValueOnce(new Error('x'))

        screen.getByTestId('skills-install').click()
        const input = await screen.findByPlaceholderText('settings.skills.installSourcePlaceholder')
        fireEvent.change(input, { target: { value: 'bad/repo' } })
        fireEvent.click(screen.getByText('settings.skills.installSubmit'))

        await waitFor(() => expect(mockMessage.error).toHaveBeenCalledWith('settings.skills.installFailed'))
        // 弹窗未关：输入框仍在
        expect(screen.getByPlaceholderText('settings.skills.installSourcePlaceholder')).toBeTruthy()
    })
})

describe('SkillsSection（票 06：内置分组）', () => {
    function setupGlobal(bundled: typeof mockBundled = { bundled: [], isLoading: false, error: null }) {
        vi.mocked(useWorkspaces).mockReturnValue({ data: [{ id: 'ws-1', name: 'Demo Workspace' }] } as never)
        vi.mocked(useSkills).mockImplementation(mockSkillsByScope)
        vi.mocked(useSkillVisibility).mockReturnValue(mockVisibility as never)
        vi.mocked(useBundledSkills).mockReturnValue(bundled)
        render(<SkillsSection />)
    }

    /** fixture：内置两行，其中 doctor 与个人 skill 同名（覆盖判定用）——GLOBAL_SKILLS 无 doctor，
     * 用 alpha 同名场景：内置行名 alpha → covered */
    const BUNDLED = [
        { name: 'alpha', description: 'Bundled alpha (shadowed by personal)' },
        { name: 'doctor', description: 'Health-check the setup' },
    ]

    it('全局 tab 渲染内置分组：分组标题 + 只读行（内置徽标、无开关/删除/更新）', () => {
        setupGlobal({ bundled: BUNDLED, isLoading: false, error: null })

        expect(screen.getByText('settings.skills.groupBundled')).toBeTruthy()
        expect(screen.getAllByText('settings.skills.source.bundled').length).toBe(2)

        const bundledRow = document.querySelector('[data-bundled="true"][data-skill-name="doctor"]')!
        expect(bundledRow.querySelector('[role="switch"]')).toBeNull()
        expect(bundledRow.querySelector('[data-skill-delete="doctor"]')).toBeNull()
        expect(bundledRow.querySelector('[data-skill-update="doctor"]')).toBeNull()
    })

    it('与个人 skill 同名的内置行显示覆盖徽标（用户胜）', () => {
        setupGlobal({ bundled: BUNDLED, isLoading: false, error: null })

        const covered = document.querySelector('[data-bundled="true"][data-skill-name="alpha"]')!
        expect(covered.textContent).toContain('settings.skills.coveredByLocal')
        const notCovered = document.querySelector('[data-bundled="true"][data-skill-name="doctor"]')!
        expect(notCovered.textContent).not.toContain('settings.skills.coveredByLocal')
    })

    it('工作区 tab 不渲染内置分组', () => {
        setupGlobal({ bundled: BUNDLED, isLoading: false, error: null })

        fireEvent.click(screen.getByText('Demo Workspace'))
        expect(screen.queryByText('settings.skills.groupBundled')).toBeNull()
    })

    it('内置名单加载失败：错误提示（不伪装空名单静默）', () => {
        setupGlobal({ bundled: [], isLoading: false, error: new Error('probe timeout') })

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
})
