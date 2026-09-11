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
import { buildSessionMcpServers, REMOTE_INLINE_HOOK_SETTINGS } from '@/mcp/sessionTransports'
import type { ApiSessionClient } from '@/api/apiSession'
import type { Settings } from '@anthropic-ai/claude-agent-sdk'

const fakeClient = { sendClaudeSessionMessage: vi.fn() } as unknown as ApiSessionClient

describe('buildSessionMcpServers', () => {
    it('remote 模式挂载 mobi-apps + mobi-core 两个 SDK 进程内 server（按职责拆分）', () => {
        const servers = buildSessionMcpServers({
            startingMode: 'remote',
            httpMcpUrl: null,
            client: fakeClient,
            getAgentLocator: () => null,
        })

        const apps = servers['mobi-apps'] as { type: string; name?: string }
        const core = servers['mobi-core'] as { type: string; name?: string }
        expect(apps.type).toBe('sdk')
        expect(apps.name).toBe('mobi-apps')
        expect(core.type).toBe('sdk')
        expect(core.name).toBe('mobi-core')
        expect(Object.keys(servers).sort()).toEqual(['mobi-apps', 'mobi-core'])
    })

    it('local 模式仅挂 mobi-core（HTTP url 透传）；mobi-apps 不存在（D1），web 工具不挂（local 从未生效）', () => {
        const servers = buildSessionMcpServers({
            startingMode: 'local',
            httpMcpUrl: 'http://127.0.0.1:12345',
            client: fakeClient,
            getAgentLocator: () => null,
        })

        expect(servers['mobi-core']).toEqual({ type: 'http', url: 'http://127.0.0.1:12345' })
        expect(servers['mobi-apps']).toBeUndefined()
        expect(Object.keys(servers)).toEqual(['mobi-core'])
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

describe('REMOTE_INLINE_HOOK_SETTINGS', () => {
    it('仅含 crossSessionInbound（官方 settings 键），不含 env 与 hook 条目', () => {
        const settings: Settings = REMOTE_INLINE_HOOK_SETTINGS

        expect(settings).toEqual({ crossSessionInbound: 'accept' })
        expect(Object.keys(settings)).toEqual(['crossSessionInbound'])
    })
})
