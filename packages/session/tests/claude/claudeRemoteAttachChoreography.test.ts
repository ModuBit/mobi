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
import { query, startup } from '@anthropic-ai/claude-agent-sdk'
import {
    claudeRemote,
    type RemoteRoundParams,
    type MessageSource,
    type RemoteSessionEvents,
    type RemoteRewindPlan,
} from '@/claude/claudeRemote'
import type { EnhancedMode } from '@/claude/types'

/**
 * attach 编舞测试（深化候选④票①）：interface 收窄为「轮次参数 + 消息源 + 事件汇」后，
 * 事件汇 fake + 可控消息源直驱 claudeRemote()——锁 attach 四路径（提前激活 / fallback /
 * rewind 截断 / fork 激活）的对外可观察行为：事件顺序、sink 就绪时点、sdkOptions 装配。
 * 不锁内部实现（双循环结构 / 内部状态）。
 */

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    query: vi.fn(),
    startup: vi.fn(),
}))
vi.mock('@mobi/node-core/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), debugLargeJson: vi.fn() },
}))

const mockedQuery = vi.mocked(query)
const mockedStartup = vi.mocked(startup)

const MODE: EnhancedMode = { permissionMode: 'default' }
type TurnMessage = { message: string; mode: EnhancedMode; localIds: string[] }

/** 构造空流 Query（立即完成，无 init/result） */
function emptyQuery() {
    return {
        [Symbol.asyncIterator]() {
            return { next: async () => ({ done: true as const, value: undefined }) }
        },
        close: vi.fn(),
    }
}

function makeWarmRef() {
    const fake = emptyQuery()
    return { query: vi.fn().mockReturnValue(fake), close: vi.fn(), fake }
}

/** 事件汇 fake：全回调记录型 + converter 结构替身 */
function makeEvents() {
    return {
        onSessionFound: vi.fn(),
        onRunningChange: vi.fn(),
        onMessage: vi.fn(),
        onSnapshot: vi.fn(),
        registerSnapshotReset: vi.fn(),
        getConverter: () => ({ convertSnapshot: vi.fn() }) as never,
        onCompletionEvent: vi.fn(),
        onCompactCompleted: vi.fn(),
        onCompactStart: vi.fn(),
        onContextCleared: vi.fn(),
        onConversationReset: vi.fn(),
        onAbortFlush: vi.fn(),
        onSessionReset: vi.fn(),
        onContextUsage: vi.fn(),
        onCompactBoundary: vi.fn(),
        onTurnOutput: vi.fn(),
        onQueryReady: vi.fn(),
        onSteerSinkReady: vi.fn(),
        onAgentMessageSinkReady: vi.fn(),
        onInboundPrompt: vi.fn(),
        onCacheStatus: vi.fn(),
        onMessagesBound: vi.fn(),
        onReady: vi.fn(),
    } satisfies RemoteSessionEvents
}

/** 可控消息源：resolveNext 按序结算挂起的 nextMessage 调用 */
function makeSource(log?: string[]) {
    const waiters: Array<(v: TurnMessage | null) => void> = []
    const nextMessage = vi.fn(() => {
        log?.push('nextMessage')
        return new Promise<TurnMessage | null>((resolve) => waiters.push(resolve))
    })
    const source: MessageSource = { nextMessage }
    return {
        source,
        nextMessage,
        resolveNext: (v: TurnMessage | null) => waiters.shift()?.(v),
    }
}

function makeRound(rewind?: RemoteRewindPlan): RemoteRoundParams {
    return {
        sessionId: null,
        path: '/work/dir',
        rewind,
        allowedTools: [],
        hookSettings: '/tmp/hook.json',
        getSessionConfig: () => MODE,
        canCallTool: vi.fn(),
        onElicitation: vi.fn(),
    }
}

function startupOptions(): Record<string, unknown> {
    const [arg] = mockedStartup.mock.calls[0] as [{ options: Record<string, unknown> }]
    return arg.options
}

beforeEach(() => {
    mockedQuery.mockReset()
    mockedStartup.mockReset()
})

describe('attach 编舞：预热成功 → 提前激活（spec 2026-08-28 ①）', () => {
    it('onQueryReady 与跨会话 sink 先于首条消息就绪；消息 push 后上报绑定', async () => {
        const warm = makeWarmRef()
        mockedStartup.mockResolvedValue(warm as never)
        const events = makeEvents()
        const { source, resolveNext } = makeSource()

        const p = claudeRemote(makeRound(), source, events)

        // 提前激活：不等首条消息即 attach + 启动输出循环
        await vi.waitFor(() => expect(events.onQueryReady).toHaveBeenCalledTimes(1))
        // 跨会话 sink 与 attach 同机接通（新建会话「建完即可发消息」的地基）
        expect(events.onAgentMessageSinkReady).toHaveBeenCalledTimes(1)
        expect(typeof (events.onAgentMessageSinkReady.mock.calls[0] as unknown[])[0]).toBe('function')
        expect(events.onMessagesBound).not.toHaveBeenCalled()

        await vi.waitFor(() => expect(source.nextMessage).toHaveBeenCalledTimes(1))
        resolveNext({ message: 'hello', mode: MODE, localIds: ['l1'] })
        // 空流输出循环随即结束，race 胜出 → finally 中止输入循环并收尾（无需第二拉）
        await p

        // push 预设 uuid 并上报 localIds → nativeId 绑定
        expect(events.onMessagesBound).toHaveBeenCalledWith(
            [{ localId: 'l1', nativeId: expect.any(String) }],
            undefined,
        )
        // 提前激活复用预热进程，不冷启动
        expect(mockedQuery).not.toHaveBeenCalled()
    })
})

describe('attach 编舞：预热失败 → fallback 冷启动', () => {
    it('onQueryReady 晚于首条消息（不提前激活）；冷启动 query 的 prompt 是消息流', async () => {
        mockedStartup.mockRejectedValue(new Error('warm spawn failed'))
        mockedQuery.mockReturnValue(emptyQuery() as never)
        const events = makeEvents()
        const { source, resolveNext } = makeSource()

        const p = claudeRemote(makeRound(), source, events)

        await vi.waitFor(() => expect(source.nextMessage).toHaveBeenCalledTimes(1))
        // 首条消息未到不 attach（fallback 语义）
        expect(events.onQueryReady).not.toHaveBeenCalled()

        resolveNext({ message: 'hello', mode: MODE, localIds: ['l1'] })
        await vi.waitFor(() => expect(events.onQueryReady).toHaveBeenCalledTimes(1))
        await p

        const [arg] = mockedQuery.mock.calls[0] as [{ prompt: unknown }]
        expect(typeof arg.prompt).not.toBe('string')
    })
})

describe('attach 编舞：rewind 截断轮', () => {
    it('onTruncated 先于 nextMessage（回报死锁防线）；不提前激活；sdkOptions 配对传参', async () => {
        const warm = makeWarmRef()
        mockedStartup.mockResolvedValue(warm as never)
        const events = makeEvents()
        const log: string[] = []
        const { source, resolveNext } = makeSource(log)
        const onTruncated = vi.fn(async () => { log.push('onTruncated') })
        const onRefusal = vi.fn()

        const p = claudeRemote(
            makeRound({ resumeAt: 'anchor-a1', dropsTurn: 'user-u1', onTruncated, onRefusal }),
            source,
            events,
        )

        // 截断完成回报先于等用户消息（用户消息依赖 Web 回填、回填依赖回报，反序会死锁）
        await vi.waitFor(() => expect(onTruncated).toHaveBeenCalledTimes(1))
        expect(log.indexOf('onTruncated')).toBeLessThan(log.indexOf('nextMessage'))
        // 截断轮不提前激活：回报后等首条消息，未 attach
        expect(events.onQueryReady).not.toHaveBeenCalled()

        resolveNext({ message: 'hello', mode: MODE, localIds: ['l1'] })
        await vi.waitFor(() => expect(events.onQueryReady).toHaveBeenCalledTimes(1))
        await p

        const options = startupOptions()
        expect(options.resumeSessionAt).toBe('anchor-a1')
        expect(options.resumeDropsTurn).toBe('user-u1')
        expect(options.enableFileCheckpointing).toBe(true)
    })
})

describe('attach 编舞：fork 激活轮 sdkOptions 三件套', () => {
    it('forkSession/resumeSessionAt/sessionId 按 fork-session spec §5.2 装配；bypass 意图声明恒携带', async () => {
        const warm = makeWarmRef()
        mockedStartup.mockResolvedValue(warm as never)
        const events = makeEvents()
        const { source, resolveNext } = makeSource()

        const round = makeRound()
        round.forkActivation = {
            parentNativeId: 'parent-p1',
            anchorNativeId: 'anchor-a1',
            forkNativeId: 'fork-f1',
        } as never

        const p = claudeRemote(round, source, events)
        await vi.waitFor(() => expect(source.nextMessage).toHaveBeenCalledTimes(1))
        resolveNext({ message: 'hello', mode: MODE, localIds: ['l1'] })
        await p

        const options = startupOptions()
        expect(options.forkSession).toBe(true)
        expect(options.resumeSessionAt).toBe('anchor-a1')
        expect(options.sessionId).toBe('fork-f1')
        expect(options.resume).toBe('parent-p1')
        // bypass 意图声明（CC 2.1.283 起强制配套，缺省即掉回 default 弹审批）
        expect(options.allowDangerouslySkipPermissions).toBe(true)
        expect(options.includePartialMessages).toBe(true)
    })
})

describe('attach 编舞：轮次收尾清理', () => {
    it('无消息可投（nextMessage null）→ 干净返回：query.close 被调、不 reject', async () => {
        const warm = makeWarmRef()
        mockedStartup.mockResolvedValue(warm as never)
        const events = makeEvents()
        const { source, resolveNext } = makeSource()

        const p = claudeRemote(makeRound(), source, events)
        await vi.waitFor(() => expect(events.onQueryReady).toHaveBeenCalledTimes(1))
        resolveNext(null)
        await expect(p).resolves.toBeUndefined()

        expect(warm.fake.close).toHaveBeenCalledTimes(1)
        // warm 已消费，finally 不重复关 warm
        expect(warm.close).not.toHaveBeenCalled()
    })
})
