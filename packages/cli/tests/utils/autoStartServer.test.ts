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
 * 自动拉起收编 supervisor 后的行为锁定：
 * - daemon 经 ensureSupervisorRunning + 控制指令拉起，不再直接 spawn start-sync
 * - 既有触发条件语义不变（MOBI_API_URL / cliApiToken / daemon 已在运行）；
 *   settings.cli.json 的 apiUrl 是 ADR 0009 删除的死字段，不构成跳过守卫
 * - 拉起失败静默降级，不向上抛错
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// vi.hoisted 保证 vi.mock 工厂（会被提升到文件顶部）能引用这些 mock
const {
    mockReadSettings,
    mockReadDaemonState,
    mockIsProcessAlive,
    mockEnsureSupervisorRunning,
    mockSendControlCommand,
} = vi.hoisted(() => ({
    mockReadSettings: vi.fn(),
    mockReadDaemonState: vi.fn(),
    mockIsProcessAlive: vi.fn(),
    mockEnsureSupervisorRunning: vi.fn(),
    mockSendControlCommand: vi.fn(),
}))

vi.mock('@mobi/node-core/persistence', () => ({
    readSettings: mockReadSettings,
    readDaemonState: mockReadDaemonState,
}))

vi.mock('@/supervisor/control', () => ({
    ensureSupervisorRunning: mockEnsureSupervisorRunning,
    sendControlCommand: mockSendControlCommand,
}))

vi.mock('@mobi/node-core/utils/process', () => ({
    isProcessAlive: mockIsProcessAlive,
}))

vi.mock('@mobi/node-core/configuration', () => ({
    configuration: { apiUrl: 'http://localhost:2222', supervisorSocketFile: '/tmp/mobi-test.sock' },
}))

vi.mock('@mobi/node-core/logger', () => ({
    logger: { debug: vi.fn() },
}))

import { ensureDaemonRunning } from '@/utils/autoStartServer'

/** 默认满足全部触发条件（无 MOBI_API_URL、有 token、daemon 未运行） */
function resetHappyPathPreconditions(): void {
    delete process.env.MOBI_API_URL
    mockReadSettings.mockResolvedValue({ cliApiToken: 'token' })
    mockReadDaemonState.mockResolvedValue(null)
    mockIsProcessAlive.mockReturnValue(false)
    // daemon health 探测失败（未运行）
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
}

describe('ensureDaemonRunning', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(console, 'log').mockImplementation(() => {})
        resetHappyPathPreconditions()
        mockEnsureSupervisorRunning.mockResolvedValue(undefined)
        mockSendControlCommand.mockResolvedValue({ pid: 1 })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('条件满足时经 supervisor 拉起 daemon（start 指令 + 60s 超时）', async () => {
        await ensureDaemonRunning()

        expect(mockEnsureSupervisorRunning).toHaveBeenCalledTimes(1)
        expect(mockSendControlCommand).toHaveBeenCalledWith(
            '/tmp/mobi-test.sock',
            { cmd: 'start', scope: 'daemon' },
            60_000
        )
    })

    it('MOBI_API_URL 已设置则跳过', async () => {
        process.env.MOBI_API_URL = 'https://remote.example.com'

        await ensureDaemonRunning()

        expect(mockEnsureSupervisorRunning).not.toHaveBeenCalled()
        expect(mockSendControlCommand).not.toHaveBeenCalled()
    })

    it('settings.json 残留历史 apiUrl 不再挡自动拉起（死字段不复活守卫）', async () => {
        mockReadSettings.mockResolvedValue({ apiUrl: 'https://remote.example.com', cliApiToken: 'token' })

        await ensureDaemonRunning()

        expect(mockEnsureSupervisorRunning).toHaveBeenCalledTimes(1)
    })

    it('settings.json 无 cliApiToken 则跳过', async () => {
        mockReadSettings.mockResolvedValue({})

        await ensureDaemonRunning()

        expect(mockEnsureSupervisorRunning).not.toHaveBeenCalled()
    })

    it('daemon 已在运行（pid 存活 + health 探测通过）则跳过', async () => {
        mockReadDaemonState.mockResolvedValue({ pid: 4321, httpPort: 2222, hostPort: 12222, controlPort: 3000, startTime: 'now' })
        mockIsProcessAlive.mockReturnValue(true)
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

        await ensureDaemonRunning()

        expect(mockEnsureSupervisorRunning).not.toHaveBeenCalled()
        expect(mockSendControlCommand).not.toHaveBeenCalled()
    })

    it('state 文件缺失（无 daemon.state.json）也满足拉起条件', async () => {
        mockReadDaemonState.mockResolvedValue(null)

        await ensureDaemonRunning()

        expect(mockEnsureSupervisorRunning).toHaveBeenCalledTimes(1)
    })

    it('supervisor 拉起失败不抛错，仅打印警告', async () => {
        mockEnsureSupervisorRunning.mockRejectedValue(new Error('spawn failed'))

        await expect(ensureDaemonRunning()).resolves.toBeUndefined()
        expect(mockSendControlCommand).not.toHaveBeenCalled()
    })

    it('控制指令失败静默降级：不抛错、不中断会话启动', async () => {
        mockSendControlCommand.mockRejectedValue(new Error('daemon started but health check failed'))

        await expect(ensureDaemonRunning()).resolves.toBeUndefined()
    })
})
