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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startup } from '@anthropic-ai/claude-agent-sdk'
import { claudeRemote } from '../../src/claude/claudeRemote'
import { splitRemoteArgs } from './utils/splitRemoteArgs'

/**
 * 远程轮次的事件转发（回调白名单回归）：
 *
 * `claudeRemote` 把 `RemoteSessionEvents` 收集起来后，在 startOutputLoop 里**逐字段**转给
 * sdkOutputLoop（不是整体透传）。漏一行 = 该事实在真机永不落地，而只测 sdkOutputLoop 的
 * 单测依旧全绿——2026-10-27 实踩：`onFastModeState` 就漏在这一层，快速模式执行态在 E2E
 * 里怎么都不出现。所以这里从 claudeRemote 这一层进入验证。
 */

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    query: vi.fn(),
    startup: vi.fn(),
}))

vi.mock('@mobi/node-core/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), debugLargeJson: vi.fn() },
}))

const mockedStartup = vi.mocked(startup)

/** 产出指定的 SDK 消息后结束的 Query 替身 */
function queryYielding(msgs: unknown[]) {
    return {
        [Symbol.asyncIterator]() {
            let i = 0
            return {
                async next() {
                    if (i >= msgs.length) return { done: true, value: undefined }
                    return { done: false, value: msgs[i++] }
                },
            }
        },
        close: vi.fn(),
    }
}

function baseOpts() {
    return {
        sessionId: null as string | null,
        path: '/work/dir',
        allowedTools: [],
        hookSettings: '/tmp/hook.json',
        getSessionConfig: () => ({ permissionMode: 'default' as const }),
        canCallTool: vi.fn(),
        nextMessage: vi.fn().mockResolvedValue({
            message: 'hello', mode: { permissionMode: 'default' as const }, localIds: ['loc-1'],
        }),
        onMessagesBound: vi.fn(),
        onReady: vi.fn(),
        onSessionFound: vi.fn(),
        onMessage: vi.fn(),
        onSnapshot: vi.fn(),
        getConverter: () => ({ convertSnapshot: vi.fn() }) as never,
        onRunningChange: vi.fn(),
        onQueryReady: vi.fn(),
    }
}

/** turn 收尾的 result 帧（字段名是 SDK 的 snake_case） */
function successResult(extra: Record<string, unknown> = {}) {
    return {
        type: 'result',
        subtype: 'success',
        terminal_reason: undefined,
        duration_ms: 1,
        duration_api_ms: 1,
        num_turns: 1,
        stop_reason: null,
        total_cost_usd: 0,
        usage: {},
        modelUsage: {},
        permission_denials: [],
        uuid: 'result-uuid',
        session_id: 'cc-session',
        ...extra,
    }
}

describe('claudeRemote → sdkOutputLoop 事件转发', () => {
    beforeEach(() => {
        mockedStartup.mockReset()
    })

    it('result 帧的 fast_mode_state / fast_mode_disabled_reason 到达 onFastModeState', async () => {
        mockedStartup.mockResolvedValue({
            query: vi.fn().mockReturnValue(queryYielding([
                successResult({ fast_mode_state: 'cooldown', fast_mode_disabled_reason: 'extra_usage_disabled' }),
            ])),
            close: vi.fn(),
        } as never)

        const onFastModeState = vi.fn()
        await claudeRemote(...splitRemoteArgs({ ...baseOpts(), onFastModeState }))

        expect(onFastModeState).toHaveBeenCalledWith('cooldown', 'extra_usage_disabled')
    })
})
