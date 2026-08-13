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
 * 验证 bootstrapSession 的项目归属语义（项目实体化 Task 6）：
 * - 带 projectId：machineId 匹配 + folders 存在性校验，过滤后冻结进 metadata
 * - machineId 不匹配 / primary 缺失 → 硬失败
 * - 不带 projectId：游离会话，additionalDirectories 为空、不冻结
 * - resume：回放创建时冻结的 metadata.additionalDirectories
 *
 * @see packages/cli/src/agent/sessionFactory.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// 共享 mock 状态（vi.hoisted 保证 vi.mock 工厂可引用）
const h = vi.hoisted(() => ({
    getOrCreateSession: vi.fn(),
    getSessionByClaudeSessionId: vi.fn(),
    updateMetadata: vi.fn(),
    access: vi.fn()
}))

vi.mock('@/api/api', () => ({
    ApiClient: {
        create: async () => ({
            getOrCreateSession: h.getOrCreateSession,
            getSessionByClaudeSessionId: h.getSessionByClaudeSessionId,
            getOrCreateMachine: async () => ({}),
            sessionSyncClient: () => ({ updateMetadata: h.updateMetadata })
        })
    }
}))

vi.mock('@/persistence', () => ({
    readSettings: async () => ({ machineId: 'm1' })
}))

vi.mock('@/runner/controlClient', () => ({
    notifyRunnerSessionStarted: async () => null
}))

vi.mock('@/configuration', () => ({
    configuration: { mobiHomeDir: '/tmp/mobi-home', apiUrl: 'http://hub.test' }
}))

vi.mock('@/projectPath', () => ({
    runtimePath: () => '/tmp/mobi-runtime'
}))

vi.mock('@/utils/worktreeEnv', () => ({
    readWorktreeEnv: () => null,
    readGitBranch: () => null
}))

vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn(), infoDeveloper: vi.fn(), debugLargeJson: vi.fn() }
}))

// mock fs.access：按 exists 集合判定路径存在性
vi.mock('node:fs/promises', () => ({
    access: h.access
}))

import { bootstrapSession } from '@/agent/sessionFactory'

const MACHINE_ID = 'm1'

function baseProject(overrides: Record<string, unknown> = {}) {
    return {
        id: 'p1',
        namespace: 'default',
        machineId: MACHINE_ID,
        name: 'mobi',
        folders: [
            { path: '/a/mobi', primary: true },
            { path: '/a/shared', primary: false },
            { path: '/gone', primary: false }
        ],
        createdAt: 1,
        updatedAt: 1,
        seq: 0,
        ...overrides
    }
}

function mockSession(overrides: Record<string, unknown> = {}) {
    return {
        id: 's1',
        namespace: 'default',
        seq: 0,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: null,
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        running: false,
        runningAt: 0,
        tag: 'tag1',
        projectId: null,
        ...overrides
    }
}

/** 设定存在的路径集合（其余 fs.access 全部失败） */
function stubExists(paths: string[]) {
    const set = new Set(paths)
    h.access.mockImplementation((p: string) =>
        set.has(p) ? Promise.resolve() : Promise.reject(new Error('ENOENT'))
    )
}

beforeEach(() => {
    vi.clearAllMocks()
    h.getSessionByClaudeSessionId.mockResolvedValue(null)
})

describe('bootstrapSession 项目归属', () => {
    it('带 projectId：校验通过后冻结 additionalDirectories 并写入 metadata', async () => {
        stubExists(['/a/mobi', '/a/shared'])
        h.getOrCreateSession.mockResolvedValue({
            ...mockSession({ projectId: 'p1' }),
            project: baseProject()
        })

        const result = await bootstrapSession({
            flavor: 'claude',
            startedBy: 'terminal',
            workingDirectory: '/a/mobi',
            projectId: 'p1'
        })

        // projectId 透传到 POST /cli/sessions body
        expect(h.getOrCreateSession).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p1' }))
        // 只保留存在的非 primary 文件夹（/gone 被跳过）
        expect(result.additionalDirectories).toEqual(['/a/shared'])
        // 冻结写入 metadata
        expect(h.updateMetadata).toHaveBeenCalledTimes(1)
        const handler = h.updateMetadata.mock.calls[0][0] as (cur: Record<string, unknown>) => Record<string, unknown>
        expect(handler({ path: '/a/mobi' })).toEqual({
            path: '/a/mobi',
            additionalDirectories: ['/a/shared']
        })
    })

    it('machineId 不匹配 → 抛错且不冻结', async () => {
        stubExists(['/a/mobi', '/a/shared'])
        h.getOrCreateSession.mockResolvedValue({
            ...mockSession({ projectId: 'p1' }),
            project: baseProject({ machineId: 'm-other' })
        })

        await expect(bootstrapSession({
            flavor: 'claude',
            startedBy: 'terminal',
            workingDirectory: '/a/mobi',
            projectId: 'p1'
        })).rejects.toThrow(/different machine/i)
        expect(h.updateMetadata).not.toHaveBeenCalled()
    })

    it('primary 缺失（且非进程 cwd）→ 抛错', async () => {
        stubExists([])
        h.getOrCreateSession.mockResolvedValue({
            ...mockSession({ projectId: 'p1' }),
            project: baseProject({
                folders: [{ path: '/a/missing-primary', primary: true }]
            })
        })

        await expect(bootstrapSession({
            flavor: 'claude',
            startedBy: 'terminal',
            workingDirectory: '/a/mobi',
            projectId: 'p1'
        })).rejects.toThrow(/primary/i)
        expect(h.updateMetadata).not.toHaveBeenCalled()
    })

    it('不带 projectId：不冻结、additionalDirectories 为空', async () => {
        stubExists(['/a/mobi'])
        h.getOrCreateSession.mockResolvedValue({
            ...mockSession(),
            project: null
        })

        const result = await bootstrapSession({
            flavor: 'claude',
            startedBy: 'terminal',
            workingDirectory: '/a/mobi'
        })

        expect(h.getOrCreateSession).toHaveBeenCalledWith(expect.objectContaining({ projectId: undefined }))
        expect(result.additionalDirectories).toEqual([])
        expect(h.updateMetadata).not.toHaveBeenCalled()
    })

    it('resume 已绑项目的会话（响应带 project）：冻结列表优先回放，忽略 project、不做 folders 校验、不冻结', async () => {
        // access 全部失败也无所谓——回放分支不读 folders
        stubExists([])
        h.getOrCreateSession.mockResolvedValue({
            ...mockSession({
                projectId: 'p1',
                metadata: { path: '/a/mobi', additionalDirectories: ['/frozen'] }
            }),
            project: baseProject({ machineId: 'm-other' })
        })

        const result = await bootstrapSession({
            flavor: 'claude',
            startedBy: 'terminal',
            workingDirectory: '/a/mobi',
            claudeArgs: ['--resume', 'cs1']
        })

        expect(result.additionalDirectories).toEqual(['/frozen'])
        expect(h.access).not.toHaveBeenCalled()
        expect(h.updateMetadata).not.toHaveBeenCalled()
    })

    it('resume 已绑会话但无冻结列表且项目机器不匹配（迁移存量 unknown/众数机器）：容忍降级，不抛错不冻结', async () => {
        stubExists(['/a/mobi', '/a/shared'])
        h.getOrCreateSession.mockResolvedValue({
            ...mockSession({ projectId: 'p1', metadata: { path: '/a/mobi' } }),
            // 迁移兜底 'unknown' 或组内众数机器 ≠ 当前机器
            project: baseProject({ machineId: 'unknown' })
        })

        // 迁移前该会话可正常 resume；machineId 门禁只应约束显式 --project，不应阻断历史会话恢复
        const result = await bootstrapSession({
            flavor: 'claude',
            startedBy: 'terminal',
            workingDirectory: '/a/mobi',
            claudeArgs: ['--resume', 'cs1']
        })

        expect(result.additionalDirectories).toEqual([])
        expect(h.access).not.toHaveBeenCalled()
        // 不冻结：留待在正确机器上 resume 时再派生
        expect(h.updateMetadata).not.toHaveBeenCalled()
    })

    it('resume 已绑会话但无冻结列表（迁移存量）：按当前 project folders 派生并冻结', async () => {
        stubExists(['/a/mobi', '/a/shared'])
        h.getOrCreateSession.mockResolvedValue({
            ...mockSession({ projectId: 'p1', metadata: { path: '/a/mobi' } }),
            project: baseProject()
        })

        const result = await bootstrapSession({
            flavor: 'claude',
            startedBy: 'terminal',
            workingDirectory: '/a/mobi',
            claudeArgs: ['--resume', 'cs1']
        })

        expect(result.additionalDirectories).toEqual(['/a/shared'])
        expect(h.updateMetadata).toHaveBeenCalledTimes(1)
        const handler = h.updateMetadata.mock.calls[0][0] as (cur: Record<string, unknown>) => Record<string, unknown>
        expect(handler({ path: '/a/mobi' })).toEqual({
            path: '/a/mobi',
            additionalDirectories: ['/a/shared']
        })
    })

    it('单文件夹项目（仅 primary=cwd）：派生为空也要冻结 []', async () => {
        stubExists(['/a/mobi'])
        h.getOrCreateSession.mockResolvedValue({
            ...mockSession({ projectId: 'p1' }),
            project: baseProject({ folders: [{ path: '/a/mobi', primary: true }] })
        })

        const result = await bootstrapSession({
            flavor: 'claude',
            startedBy: 'terminal',
            workingDirectory: '/a/mobi',
            projectId: 'p1'
        })

        expect(result.additionalDirectories).toEqual([])
        // 空列表同样冻结：resume 不再重读项目、不受后续变更影响
        expect(h.updateMetadata).toHaveBeenCalledTimes(1)
        const handler = h.updateMetadata.mock.calls[0][0] as (cur: Record<string, unknown>) => Record<string, unknown>
        expect(handler({ path: '/a/mobi' })).toEqual({
            path: '/a/mobi',
            additionalDirectories: []
        })
    })

    it('resume 冻结空列表的会话（键存在为 []）：回放空、不读项目、不重写', async () => {
        stubExists([])
        h.getOrCreateSession.mockResolvedValue({
            ...mockSession({
                projectId: 'p1',
                metadata: { path: '/a/mobi', additionalDirectories: [] }
            }),
            // 故意 machineId 不匹配也无所谓——回放分支不读 project
            project: baseProject({ machineId: 'm-other' })
        })

        const result = await bootstrapSession({
            flavor: 'claude',
            startedBy: 'terminal',
            workingDirectory: '/a/mobi',
            claudeArgs: ['--resume', 'cs1']
        })

        expect(result.additionalDirectories).toEqual([])
        expect(h.access).not.toHaveBeenCalled()
        expect(h.updateMetadata).not.toHaveBeenCalled()
    })

    it('worktree 形态（cwd≠primary）：primary 进入 add-dir 列表并冻结', async () => {
        stubExists(['/a/mobi', '/a/shared'])
        h.getOrCreateSession.mockResolvedValue({
            ...mockSession({ projectId: 'p1' }),
            project: baseProject()
        })

        // worktree 会话：spawn cwd 是 worktree 路径，primary 是 base 仓库
        const result = await bootstrapSession({
            flavor: 'claude',
            startedBy: 'runner',
            workingDirectory: '/a/mobi/.git/worktrees/wt1',
            projectId: 'p1'
        })

        // primary（base 仓库）≠ cwd → 加入；agent 可同时访问 base + worktree
        expect(result.additionalDirectories).toEqual(['/a/mobi', '/a/shared'])
        expect(h.updateMetadata).toHaveBeenCalledTimes(1)
    })

    it('前缀误配回归：/a/mobic 不因前缀匹配 /a/mobi 被当作 cwd', async () => {
        stubExists([])
        h.getOrCreateSession.mockResolvedValue({
            ...mockSession({ projectId: 'p1' }),
            project: baseProject({ folders: [{ path: '/a/mobic', primary: true }] })
        })

        // 旧 startsWith 启发式会误判 '/a/mobic' 匹配 cwd '/a/mobi' 而放行；
        // 新规则按路径解析精确比较 → primary 非 cwd 且缺失 → 硬失败
        await expect(bootstrapSession({
            flavor: 'claude',
            startedBy: 'terminal',
            workingDirectory: '/a/mobi',
            projectId: 'p1'
        })).rejects.toThrow(/primary/i)
    })
})
