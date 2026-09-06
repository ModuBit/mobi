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

import { describe, it, expect, vi } from 'vitest'
import { buildSessionMcpServers, buildRemoteInlineHookSettings } from '@/mcp/sessionTransports'
import type { ApiSessionClient } from '@/api/apiSession'
import type { Settings } from '@anthropic-ai/claude-agent-sdk'

const fakeClient = { sendClaudeSessionMessage: vi.fn() } as unknown as ApiSessionClient

describe('buildSessionMcpServers', () => {
    it('remote 模式挂载 SDK 进程内 mobi server（工具名前缀 mcp__mobi__ 不变）', () => {
        const servers = buildSessionMcpServers({
            startingMode: 'remote',
            httpMcpUrl: null,
            client: fakeClient,
            getAgentLocator: () => null,
        })

        const mobi = servers.mobi as { type: string; name?: string }
        expect(mobi.type).toBe('sdk')
        expect(mobi.name).toBe('mobi')
        // mobi-web 两种模式都在
        expect(servers['mobi-web']).toBeDefined()
    })

    it('local 模式 mobi 走 HTTP server（url 透传），mobi-web 照常挂载', () => {
        const servers = buildSessionMcpServers({
            startingMode: 'local',
            httpMcpUrl: 'http://127.0.0.1:12345',
            client: fakeClient,
            getAgentLocator: () => null,
        })

        expect(servers.mobi).toEqual({ type: 'http', url: 'http://127.0.0.1:12345' })
        expect(servers['mobi-web']).toBeDefined()
    })

    it('local 模式缺 httpMcpUrl 属装配 bug，显式报错而非静默空串', () => {
        expect(() => buildSessionMcpServers({
            startingMode: 'local',
            httpMcpUrl: null,
            client: fakeClient,
            getAgentLocator: () => null,
        })).toThrow(/httpMcpUrl/)
    })
})

describe('buildRemoteInlineHookSettings', () => {
    it('仅含 crossSessionInbound（官方 settings 键），不含 env 与 hook 条目', () => {
        const settings: Settings = buildRemoteInlineHookSettings()

        expect(settings).toEqual({ crossSessionInbound: 'accept' })
        expect(Object.keys(settings)).toEqual(['crossSessionInbound'])
    })
})
