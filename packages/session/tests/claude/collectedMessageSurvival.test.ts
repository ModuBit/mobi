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
 * pending #94 唤醒窗口入队消息悬空——已 collect 消息的存活不变量：
 *
 * 消息一旦被 nextMessage 内部 collectBatch shift（onBatchConsumed → pushed fact →
 * Hub lifecycle 推进为 pushed），就必须要么进入 SDK input stream，要么交回投递方
 * （onCollectedMessageAbandoned）暂存到下轮。任何「shift 完只存在于局部变量、随轮次
 * 收尾被静默丢弃」的路径都是永久悬空：lifecycle 已 pushed，Hub 不会补投，CLI 队列
 * 已无此消息。
 *
 * 两个已知丢弃窗口：
 * - userInputLoop 的 abort 竞争：nextMessage 拿到消息返回时轮次 abort 信号已触发
 * - claudeRemote initial 路径：消息 shift 后、pushUserMessage 前的 await（如 fallback
 *   冷启动 query() 抛错）走 catch，initial 随局部变量丢失
 */

import { describe, it, expect, vi } from 'vitest'
import { query, startup } from '@anthropic-ai/claude-agent-sdk'
import { userInputLoop, claudeRemote, type LoopContext } from '@/claude/claudeRemote'
import { splitRemoteArgs } from './utils/splitRemoteArgs'
import type { EnhancedMode } from '@/claude/types'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    query: vi.fn(),
    startup: vi.fn(),
}))
vi.mock('@mobi/node-core/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const mockedQuery = vi.mocked(query)
const mockedStartup = vi.mocked(startup)

const MODE: EnhancedMode = { permissionMode: 'default' }

function stubMessages(): { push: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> } {
    return { push: vi.fn(), end: vi.fn() }
}

const CTX: LoopContext = { isCompactCommand: false, compactStarted: false, hasInput: false }

describe('userInputLoop 已 collect 消息的存活', () => {
    it('abort 与消息同时到达：不得静默丢弃，须交回投递方暂存', async () => {
        const messages = stubMessages()
        const abandoned = vi.fn()
        const ac = new AbortController()

        // nextMessage 已 shift（消息到手），abort 紧随其后触发——窗口内消息只存在于返回值
        const nextMessage = vi.fn(async () => {
            ac.abort()
            return { message: 'hello', mode: MODE, localIds: ['m1'] }
        })

        await userInputLoop(messages as never, CTX, {
            nextMessage,
            specialCommandCtx: {} as never,
            signal: ac.signal,
            markInputPushed: vi.fn(),
            onCollectedMessageAbandoned: abandoned,
        })

        expect(abandoned).toHaveBeenCalledTimes(1)
        expect(abandoned).toHaveBeenCalledWith({ message: 'hello', mode: MODE, localIds: ['m1'] })
        // 丢弃路径不得再推入垂死的 SDK 输入流
        expect(messages.push).not.toHaveBeenCalled()
    })

    it('无 abort 的正常路径：照常推入 SDK input stream（回归护栏）', async () => {
        const messages = stubMessages()
        const abandoned = vi.fn()

        const nextMessage = vi.fn()
            .mockResolvedValueOnce({ message: 'hello', mode: MODE, localIds: ['m1'] })
            // 第二次调用（下一轮拉取）返回 null 结束循环
            .mockResolvedValueOnce(null)

        await userInputLoop(messages as never, CTX, {
            nextMessage,
            specialCommandCtx: {} as never,
            markInputPushed: vi.fn(),
            onCollectedMessageAbandoned: abandoned,
        })

        expect(abandoned).not.toHaveBeenCalled()
        expect(messages.push).toHaveBeenCalledTimes(1)
    })
})

/** claudeRemote 最小 opts（rewindLaunch.test.ts truncationOpts 同源，去掉截断字段走常规轮） */
function remoteOpts(extra: Record<string, unknown> = {}) {
    return {
        sessionId: null as string | null,
        path: '/work/dir',
        allowedTools: [],
        hookSettings: '/tmp/hook.json',
        getSessionConfig: () => MODE,
        canCallTool: vi.fn(),
        nextMessage: vi.fn(),
        onQueryReady: vi.fn(),
        onCacheStatus: vi.fn(),
        onSessionFound: vi.fn(),
        onSnapshot: vi.fn(),
        ...extra,
    }
}

describe('claudeRemote initial 路径已 collect 消息的存活', () => {
    it('initial shift 后 fallback 冷启动失败：消息不得随异常丢失，须交回暂存', async () => {
        // 预热失败 → 不提前激活；initial 取到后走 fallback 冷启动 → query() 抛错
        mockedStartup.mockRejectedValue(new Error('warm spawn failed'))
        mockedQuery.mockImplementation(() => {
            throw new Error('cold attach boom')
        })

        const abandoned = vi.fn()
        const opts = remoteOpts({
            nextMessage: vi.fn(async () => ({ message: 'wake-probe', mode: MODE, localIds: ['m1'] })),
            onCollectedMessageAbandoned: abandoned,
        })

        await expect(claudeRemote(...splitRemoteArgs(opts))).rejects.toThrow('cold attach boom')

        expect(abandoned).toHaveBeenCalledTimes(1)
        expect(abandoned).toHaveBeenCalledWith({ message: 'wake-probe', mode: MODE, localIds: ['m1'] })
    })
})
