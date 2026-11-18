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
 * `mobi sessions list` 的输出契约（tui-fork 票 03）：默认人类可读文本；
 * `--json` 恢复机器可读 JSON 通道（脚本消费契约——旧版进程列表曾被 JSON 消费，
 * 换 SQLite 投影后不能让脚本解析端断裂）。数据源全 mock，不碰数据库与 daemon。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const listForkableSessions = vi.fn()

vi.mock('@mobi/daemon/store/sessionListing', () => ({
    listForkableSessions: (...args: unknown[]) => listForkableSessions(...args),
    SessionListingError: class SessionListingError extends Error {
        constructor(message: string) {
            super(message)
            this.name = 'SessionListingError'
        }
    },
}))
vi.mock('@mobi/daemon/executor/controlClient', () => ({
    stopExecutorSession: vi.fn(),
}))
vi.mock('@mobi/node-core/dbPath', () => ({
    resolveMobiDbPath: () => '/tmp/mobi-test.db',
}))
vi.mock('@/commands/namespace', () => ({
    resolveCliNamespace: async () => 'default',
}))

import { sessionsCommand } from '@/commands/sessions'
import type { ForkableSession } from '@mobi/shared'

function session(overrides: Partial<ForkableSession> & { id: string }): ForkableSession {
    return {
        title: `会话 ${overrides.id}`,
        path: `/work/${overrides.id}`,
        nativeSessionId: `native-${overrides.id}`,
        updatedAt: 1000,
        status: 'dormant',
        ...overrides
    }
}

describe('sessions list 输出契约', () => {
    let logSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
        listForkableSessions.mockReset()
    })

    afterEach(() => {
        logSpy.mockRestore()
    })

    it('默认档输出人类可读文本（不输出 JSON）', async () => {
        listForkableSessions.mockReturnValue([session({ id: 'a' })])

        await sessionsCommand.run({ args: [], commandArgs: ['list'] })

        const output = logSpy.mock.calls.map(call => call.join(' ')).join('\n')
        expect(output).toContain('托管会话')
        expect(() => JSON.parse(output)).toThrow()
    })

    it('--json 输出机器可读 JSON：可解析且承载完整清单', async () => {
        const rows = [session({ id: 'a' }), session({ id: 'b', nativeSessionId: null })]
        listForkableSessions.mockReturnValue(rows)

        await sessionsCommand.run({ args: [], commandArgs: ['list', '--json'] })

        expect(logSpy).toHaveBeenCalledTimes(1)
        const parsed = JSON.parse(logSpy.mock.calls[0].join(' ')) as ForkableSession[]
        expect(parsed).toHaveLength(2)
        expect(parsed.map(s => s.id)).toEqual(['a', 'b'])
        // native id 未就绪的行保留在 JSON 里（null 原样可辨），脚本可自行过滤
        expect(parsed[1].nativeSessionId).toBeNull()
    })

    it('空清单 + --json 输出空数组（脚本能区分「空」与「失败」）', async () => {
        listForkableSessions.mockReturnValue([])

        await sessionsCommand.run({ args: [], commandArgs: ['list', '--json'] })

        expect(JSON.parse(logSpy.mock.calls[0].join(' '))).toEqual([])
    })
})
