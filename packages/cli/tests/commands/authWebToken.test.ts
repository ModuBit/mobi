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

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'

/**
 * auth web-token 命令走 hub HTTP API（远程部署语义）：
 * webApiToken 归 hub 所有，cli 不再读写本地 settings 文件，统一经 /cli/web-token。
 */

const fetchMock = vi.fn()

vi.mock('@/configuration', () => ({
    configuration: {
        apiUrl: 'http://hub.test:2222',
        cliApiToken: 'cli-token-xyz',
        settingsFile: '/tmp/settings.cli.json',
        _setCliApiToken: vi.fn(),
    },
}))

import { handleAuthCommand } from '@/commands/auth'

describe('mobi auth web-token / rotate-web-token（HTTP API 化）', () => {
    beforeEach(() => {
        fetchMock.mockReset()
        vi.stubGlobal('fetch', fetchMock)
        vi.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('web-token 调 GET /cli/web-token，带 cliApiToken 鉴权并回显 token', async () => {
        fetchMock.mockResolvedValue(new Response(
            JSON.stringify({ webToken: 'the-web-token', envOverride: false }),
            { status: 200 }
        ))

        await handleAuthCommand(['web-token'])

        expect(fetchMock).toHaveBeenCalledTimes(1)
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(url).toBe('http://hub.test:2222/cli/web-token')
        expect(init.method).toBe('GET')
        expect((init.headers as Record<string, string>).authorization).toBe('Bearer cli-token-xyz')
    })

    it('rotate-web-token 调 POST /cli/web-token，envOverride 时提示轮换会被覆盖', async () => {
        fetchMock.mockResolvedValue(new Response(
            JSON.stringify({ webToken: 'new-token', envOverride: true }),
            { status: 200 }
        ))
        const logSpy = vi.mocked(console.log)

        await handleAuthCommand(['rotate-web-token'])

        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
        expect(init.method).toBe('POST')
        const output = logSpy.mock.calls.map(c => c.join(' ')).join('\n')
        expect(output).toContain('new-token')
        expect(output).toContain('环境变量')
    })

    it('hub 401（凭证无效）时抛错并提示 login', async () => {
        fetchMock.mockResolvedValue(new Response('Unauthorized', { status: 401 }))

        await expect(handleAuthCommand(['web-token'])).rejects.toThrow('auth login')
    })
})
