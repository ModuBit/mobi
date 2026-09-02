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
import { logger } from '@/ui/logger'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    query: vi.fn(),
    startup: vi.fn(),
}))
vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), debugLargeJson: vi.fn() },
}))

const mockedStartup = vi.mocked(startup)

/** 构造空流 Query（立即完成） */
function emptyQuery() {
    return {
        [Symbol.asyncIterator]() {
            return { next: async () => ({ done: true as const, value: undefined }) }
        },
        close: vi.fn(),
    }
}

/** 常规轮最小 opts */
function minimalOpts() {
    return {
        sessionId: null as string | null,
        path: '/work/dir',
        allowedTools: [],
        hookSettingsPath: '/tmp/hook.json',
        getSessionConfig: () => ({ permissionMode: 'default' as const }),
        canCallTool: vi.fn(),
        // 提前激活后主流程在「等首条消息」处挂起，须 resolve null 走 `if (!msg) return`
        // 干净退出（永不 resolve 会令 claudeRemote 挂起、测试超时）
        nextMessage: vi.fn().mockResolvedValue(null),
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

describe('Options.stderr 实时捕获（spec 批次 G U-20）', () => {
    beforeEach(() => {
        mockedStartup.mockReset()
    })

    it('sdkOptions 携带 stderr callback，调用时落 debug 日志', async () => {
        const warmRef = { query: vi.fn().mockReturnValue(emptyQuery()), close: vi.fn() }
        mockedStartup.mockImplementation(async ({ options }) => {
            // 模拟 claude 进程启动阶段输出 stderr（如启动卡死的诊断线索）
            options?.stderr?.('[claude] boot warning: something odd')
            return warmRef as never
        })

        await claudeRemote(minimalOpts() as never)

        expect(logger.debug).toHaveBeenCalledWith('[claude stderr]', '[claude] boot warning: something odd')
    })
})
