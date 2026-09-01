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
import { claudeRemote, isReplayUserMessage } from '../../src/claude/claudeRemote'
import { reportRewindCompletion, type RewindReportClient } from '../../src/claude/utils/rewindReport'
import type { PendingRewind } from '../../src/claude/types'

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
    query: vi.fn(),
    startup: vi.fn(),
}))
vi.mock('@/ui/logger', () => ({
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}))

const mockedQuery = vi.mocked(query)
const mockedStartup = vi.mocked(startup)

/** 构造空流 Query（立即完成，无 init/result） */
function emptyQuery() {
    return {
        [Symbol.asyncIterator]() {
            return {
                async next(): Promise<IteratorResult<never>> {
                    return { done: true, value: undefined }
                },
            }
        },
        close: vi.fn(),
    }
}

/** claudeRemote 截断空跑轮的最小 opts（getConverter 用结构子集替身） */
function truncationOpts() {
    return {
        sessionId: null as string | null,
        resumeSessionAt: 'anchor-assistant-1',
        path: '/work/dir',
        allowedTools: [],
        hookSettingsPath: '/tmp/hook.json',
        getSessionConfig: () => ({ permissionMode: 'default' as const }),
        canCallTool: vi.fn(),
        nextMessage: vi.fn(() => new Promise<never>(() => { /* 永不 resolve：证明截断轮不等用户消息 */ })),
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

/**
 * launcher rewind 接线的单元覆盖：claudeRemote 截断空跑轮（resumeSessionAt 启动参数）
 * 与两段回报（reportRewindCompletion）。launcher while 循环的 pendingRewind 消费
 * 为薄接线（读字段 → 透传 → 清空），完整链路由 E2E 验证。
 * @see packages/cli/src/claude/claudeRemote.ts（resumeSessionAt 分支）
 * @see packages/cli/src/claude/utils/rewindReport.ts
 */
describe('claudeRemote rewind 截断空跑轮', () => {
    beforeEach(() => {
        mockedQuery.mockReset()
        mockedStartup.mockReset()
    })

    it('resumeSessionAt 携带时：经 startup 预热加载到锚点（不走空 prompt 空跑轮）', async () => {
        const fake = emptyQuery()
        // startup 预热返回 warmRef，后续用户消息经 warmRef.query 继续
        const warmRef = { query: vi.fn().mockReturnValue(fake), close: vi.fn() }
        mockedStartup.mockResolvedValue(warmRef as never)
        const nextMessage = vi.fn().mockResolvedValue({
            message: 'hello', mode: { permissionMode: 'default' as const }, localIds: ['loc-1'],
        })
        const opts = { ...truncationOpts(), nextMessage }

        await claudeRemote(opts)

        // 截断由 startup 预热承载：options 携带 resumeSessionAt + file checkpointing
        expect(mockedStartup).toHaveBeenCalledTimes(1)
        const [startupArg] = mockedStartup.mock.calls[0] as [{ options: Record<string, unknown> }]
        expect(startupArg.options.resumeSessionAt).toBe('anchor-assistant-1')
        expect(startupArg.options.enableFileCheckpointing).toBe(true)
        // isReplay 回显开关：CC 把 stdin 用户消息回显（带预设 uuid），CLI 拦截后作接收确认
        expect(startupArg.options.extraArgs).toEqual({ 'replay-user-messages': null })
        // 等用户消息（不再以空 prompt 空跑）
        expect(nextMessage).toHaveBeenCalled()
        // 用户消息经 warmRef.query 继续，而非直接 query 空 prompt
        expect(warmRef.query).toHaveBeenCalled()
        expect(mockedQuery).not.toHaveBeenCalled()
    })

    it('resumeDropsTurn 与 resumeSessionAt 配对传入 sdkOptions（spec E1 截断护栏）', async () => {
        const fake = emptyQuery()
        const warmRef = { query: vi.fn().mockReturnValue(fake), close: vi.fn() }
        mockedStartup.mockResolvedValue(warmRef as never)
        const nextMessage = vi.fn().mockResolvedValue({
            message: 'hello', mode: { permissionMode: 'default' as const }, localIds: ['loc-1'],
        })
        // 截断轮同时携带 resumeSessionAt（保留锚）+ resumeDropsTurn（丢弃的 turn prompt UUID）
        const opts = { ...truncationOpts(), resumeDropsTurn: 'user-msg-uuid', nextMessage }

        await claudeRemote(opts)

        // SDK startup 收到配对的 resumeSessionAt + resumeDropsTurn，
        // fork 时校验截断区间只含该 turn；含其他则 refusal（T3 只验传参，refusal 处理在 T4）
        expect(mockedStartup).toHaveBeenCalledTimes(1)
        const [startupArg] = mockedStartup.mock.calls[0] as [{ options: Record<string, unknown> }]
        expect(startupArg.options.resumeSessionAt).toBe('anchor-assistant-1')
        expect(startupArg.options.resumeDropsTurn).toBe('user-msg-uuid')
    })

    it('不携带 resumeSessionAt 时走常规轮（不进入截断分支）', async () => {
        const fake = emptyQuery()
        mockedQuery.mockReturnValue(fake as never)
        // 常规轮在 Promise.allSettled 门等待首条消息；给一条普通消息使其走完
        const nextMessage = vi.fn().mockResolvedValue({
            message: 'hello', mode: { permissionMode: 'default' as const }, localIds: ['loc-1'],
        })
        const opts = { ...truncationOpts(), resumeSessionAt: undefined, nextMessage }

        await claudeRemote(opts)

        // 常规轮 query 的 prompt 是 messages iterable（非空字符串）
        const [arg] = mockedQuery.mock.calls[0] as [{ prompt: unknown; options: Record<string, unknown> }]
        expect(typeof arg.prompt).not.toBe('string')
        expect(arg.options.resumeSessionAt).toBeUndefined()
    })
})

describe('reportRewindCompletion（两段回报）', () => {
    function fakeClient(boundary: number | Error): RewindReportClient & {
        truncated: ReturnType<typeof vi.fn>
        completed: ReturnType<typeof vi.fn>
    } {
        const truncated = vi.fn()
        const completed = vi.fn()
        return {
            truncated,
            completed,
            fetchRewindBoundary: vi.fn(() =>
                boundary instanceof Error ? Promise.reject(boundary) : Promise.resolve(boundary)
            ),
            emitRewoundTruncated: truncated,
            emitRewindCompleted: completed,
        }
    }

    const rewind: PendingRewind = { nativeId: 'u1', resumeAt: 'a1', filesRestored: true }

    beforeEach(() => {
        //
    })

    it('边界可达 → 先 rewound-truncated（含批首行 seq）再 rewind-completed', async () => {
        const client = fakeClient(5)

        await reportRewindCompletion(client, rewind)

        expect(client.truncated).toHaveBeenCalledWith('u1', 5)
        expect(client.completed).toHaveBeenCalledTimes(1)
        expect(client.completed).toHaveBeenCalledWith(true, undefined)
        // 顺序：truncated 必须先于 completed
        const order: string[] = []
        client.truncated.mock.calls.forEach(() => order.push('t'))
        client.completed.mock.calls.forEach(() => order.push('c'))
        expect(order).toEqual(['t', 'c'])
    })

    it('边界为 0（Hub 行缺失 / DTO 未含 metadata）→ 跳过 truncated，completed 带 error', async () => {
        const client = fakeClient(0)

        await reportRewindCompletion(client, rewind)

        expect(client.truncated).not.toHaveBeenCalled()
        expect(client.completed).toHaveBeenCalledWith(true, expect.stringContaining('boundary not found'))
    })

    it('边界反查抛错 → 跳过 truncated，completed 带 error', async () => {
        const client = fakeClient(new Error('network down'))

        await reportRewindCompletion(client, rewind)

        expect(client.truncated).not.toHaveBeenCalled()
        expect(client.completed).toHaveBeenCalledWith(true, expect.stringContaining('lookup failed'))
    })

    it('文件未回滚（restoreFiles false）→ completed filesRestored false', async () => {
        const client = fakeClient(3)
        const noFiles: PendingRewind = { nativeId: 'u1', resumeAt: 'a1', filesRestored: false }

        await reportRewindCompletion(client, noFiles)

        expect(client.completed).toHaveBeenCalledWith(false, undefined)
    })
})

describe('isReplayUserMessage（isReplay 回显判别）', () => {
    it('isReplay:true 的 user 消息 → true', () => {
        expect(isReplayUserMessage({ type: 'user', isReplay: true, uuid: 'x' } as never)).toBe(true)
    })

    it('普通 user 消息（无 isReplay）→ false', () => {
        expect(isReplayUserMessage({ type: 'user', uuid: 'x' } as never)).toBe(false)
    })

    it('非 user 消息（assistant/result）→ false', () => {
        expect(isReplayUserMessage({ type: 'assistant' } as never)).toBe(false)
        expect(isReplayUserMessage({ type: 'result' } as never)).toBe(false)
    })
})
