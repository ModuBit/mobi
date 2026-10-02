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
import { MOBI_PREAUTHORIZED_TOOLS, buildSessionMcpServers, REMOTE_INLINE_HOOK_SETTINGS } from '@/mcp/sessionTransports'
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

/**
 * 这份清单由各 server 的工具表**派生**（不是手抄），所以这里钉的不是「有哪些工具」，
 * 而是**派生出来的格式**：`mcp__<server>__<tool>` 是 SDK 的命名法，不是 mobi 的——
 * 写错不会报错，只会静默失效，症状是该工具每次调用弹审批（B 类那样等于编排不可用）。
 */
describe('MOBI_PREAUTHORIZED_TOOLS', () => {
    it('是 SDK 认的那八个前缀', () => {
        expect([...MOBI_PREAUTHORIZED_TOOLS].sort()).toEqual([
            'mcp__mobi-apps__create_session',
            'mcp__mobi-apps__list_machines',
            'mcp__mobi-apps__list_sessions',
            'mcp__mobi-apps__open_in_mobi',
            'mcp__mobi-apps__send_message_to_session',
            'mcp__mobi-core__change_title',
            'mcp__mobi-core__web_fetch',
            'mcp__mobi-core__web_search',
        ])
    })
})
