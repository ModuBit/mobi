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
 * - hub/runner 都经 ensureSupervisorRunning + 控制指令拉起，不再直接 spawn start-sync
 * - 既有触发条件语义不变（MOBI_API_URL / apiUrl / cliApiToken / hub 已在运行）
 * - runner 拉起失败静默降级，不向上抛错
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockReadSettings = vi.fn()
const mockEnsureSupervisorRunning = vi.fn()
const mockSendControlCommand = vi.fn()
const mockIsRunnerRunning = vi.fn()

vi.mock('@/persistence', () => ({
    readSettings: mockReadSettings,
}))

vi.mock('@/supervisor/control', () => ({
    ensureSupervisorRunning: mockEnsureSupervisorRunning,
    sendControlCommand: mockSendControlCommand,
}))

vi.mock('@/runner/controlClient', () => ({
    isRunnerRunningCurrentlyInstalledMobiVersion: mockIsRunnerRunning,
}))

vi.mock('@/configuration', () => ({
    configuration: { apiUrl: 'http://localhost:2222', supervisorSocketFile: '/tmp/mobi-test.sock' },
}))

vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn() },
}))

import { maybeAutoStartServer, maybeAutoStartRunner } from './autoStartServer'

/** 默认满足全部触发条件（无 MOBI_API_URL、无 apiUrl、有 token、hub 未运行） */
function resetHappyPathPreconditions(): void {
    delete process.env.MOBI_API_URL
    mockReadSettings.mockResolvedValue({ apiUrl: undefined, serverUrl: undefined, cliApiToken: 'token' })
    // hub health 探测失败（未运行）
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
}

describe('maybeAutoStartServer', () => {
    let consoleLog: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        vi.clearAllMocks()
        consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {})
        resetHappyPathPreconditions()
        mockEnsureSupervisorRunning.mockResolvedValue(undefined)
        mockSendControlCommand.mockResolvedValue({ pid: 1 })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        consoleLog.mockRestore()
    })

    it('条件满足时经 supervisor 拉起 hub（start 指令 + 60s 超时）', async () => {
        await maybeAutoStartServer()

        expect(mockEnsureSupervisorRunning).toHaveBeenCalledTimes(1)
        expect(mockSendControlCommand).toHaveBeenCalledWith(
            '/tmp/mobi-test.sock',
            { cmd: 'start', scope: 'hub' },
            60_000
        )
    })

    it('MOBI_API_URL 已设置则跳过', async () => {
        process.env.MOBI_API_URL = 'https://remote.example.com'

        await maybeAutoStartServer()

        expect(mockEnsureSupervisorRunning).not.toHaveBeenCalled()
        expect(mockSendControlCommand).not.toHaveBeenCalled()
    })

    it('settings.json 配置了 apiUrl 则跳过', async () => {
        mockReadSettings.mockResolvedValue({ apiUrl: 'https://remote.example.com' })

        await maybeAutoStartServer()

        expect(mockEnsureSupervisorRunning).not.toHaveBeenCalled()
    })

    it('settings.json 无 cliApiToken 则跳过', async () => {
        mockReadSettings.mockResolvedValue({})

        await maybeAutoStartServer()

        expect(mockEnsureSupervisorRunning).not.toHaveBeenCalled()
    })

    it('hub 已在运行（health 探测通过）则跳过', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))

        await maybeAutoStartServer()

        expect(mockEnsureSupervisorRunning).not.toHaveBeenCalled()
        expect(mockSendControlCommand).not.toHaveBeenCalled()
    })

    it('supervisor 拉起失败不抛错，仅打印警告', async () => {
        mockEnsureSupervisorRunning.mockRejectedValue(new Error('spawn failed'))

        await expect(maybeAutoStartServer()).resolves.toBeUndefined()
        expect(mockSendControlCommand).not.toHaveBeenCalled()
    })
})

describe('maybeAutoStartRunner', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(console, 'log').mockImplementation(() => {})
        mockEnsureSupervisorRunning.mockResolvedValue(undefined)
        mockSendControlCommand.mockResolvedValue({ pid: 1 })
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('runner 已在跑（当前版本）则不拉起', async () => {
        mockIsRunnerRunning.mockResolvedValue(true)

        await maybeAutoStartRunner()

        expect(mockEnsureSupervisorRunning).not.toHaveBeenCalled()
    })

    it('runner 未跑则经 supervisor 拉起（start 指令 + 60s 超时）', async () => {
        mockIsRunnerRunning.mockResolvedValue(false)

        await maybeAutoStartRunner()

        expect(mockEnsureSupervisorRunning).toHaveBeenCalledTimes(1)
        expect(mockSendControlCommand).toHaveBeenCalledWith(
            '/tmp/mobi-test.sock',
            { cmd: 'start', scope: 'runner' },
            60_000
        )
    })

    it('拉起失败静默降级：不抛错、不中断会话启动', async () => {
        mockIsRunnerRunning.mockResolvedValue(false)
        mockSendControlCommand.mockRejectedValue(new Error('hub is not healthy, refusing to start runner'))

        await expect(maybeAutoStartRunner()).resolves.toBeUndefined()
    })
})
