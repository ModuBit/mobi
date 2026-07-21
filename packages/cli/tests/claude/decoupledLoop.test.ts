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
import {
    sdkOutputLoop,
    userInputLoop,
    type LoopContext,
} from '../../src/claude/claudeRemote'
import { PushableAsyncIterable } from '../../src/utils/PushableAsyncIterable'
import type { SpecialCommandContext } from '../../src/claude/claudeRemote'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

// ─── Helper 函数 ────────────────────────────────────────────────

/** 从消息数组创建 AsyncIterable */
function asyncIterableFrom<T>(messages: T[]): AsyncIterable<T> {
    return {
        [Symbol.asyncIterator]() {
            let i = 0
            return {
                async next() {
                    if (i < messages.length) {
                        return { done: false, value: messages[i++] }
                    }
                    return { done: true, value: undefined }
                },
            }
        },
    }
}

/** 可延迟推送的 AsyncIterable（模拟 SDK 后台消息） */
function createPushableAsyncIterable<T>(): {
    iterable: AsyncIterable<T>
    push: (value: T) => void
    end: () => void
} {
    const queue: T[] = []
    const waiters: Array<{
        resolve: (value: IteratorResult<T>) => void
    }> = []
    let done = false

    return {
        iterable: {
            [Symbol.asyncIterator]() {
                return {
                    async next() {
                        if (queue.length > 0) {
                            return { done: false, value: queue.shift()! }
                        }
                        if (done) {
                            return { done: true, value: undefined }
                        }
                        return new Promise<IteratorResult<T>>((resolve) => {
                            waiters.push({ resolve })
                        })
                    },
                }
            },
        },
        push(value: T) {
            const waiter = waiters.shift()
            if (waiter) {
                waiter.resolve({ done: false, value })
            } else {
                queue.push(value)
            }
        },
        end() {
            done = true
            while (waiters.length > 0) {
                waiters.shift()!.resolve({ done: true, value: undefined })
            }
        },
    }
}

/** 创建 mock SpecialCommandContext */
function createMockSpecialCommandCtx(): SpecialCommandContext & {
    _calls: { clear: number; compact: number; bash: string[]; ready: number }
} {
    const calls = { clear: 0, compact: 0, bash: [] as string[], ready: 0 }
    return {
        onClear: () => { calls.clear += 1 },
        onCompactStart: () => { calls.compact += 1 },
        executeBash: async (cmd: string) => { calls.bash.push(cmd) },
        onReady: () => { calls.ready += 1 },
        _calls: calls,
    }
}

/** 创建 sdkOutputLoop 的默认 opts */
function createOutputLoopOpts(overrides?: Record<string, unknown>) {
    return {
        initialModel: 'claude-sonnet-4-20250514',
        path: '/tmp/test',
        onMessage: vi.fn(),
        snapshotSender: {
            flush: vi.fn(),
            clearBuffers: vi.fn(),
            setSnapshotOpts: vi.fn(),
            startBlock: vi.fn(),
            append: vi.fn(),
            endBlock: vi.fn(),
            markFullDelivered: vi.fn(),
            consumePendingFull: vi.fn().mockReturnValue(null),
        } as any,
        onSessionFound: vi.fn(),
        onReady: vi.fn(),
        onRunningChange: vi.fn(),
        onCompletionEvent: vi.fn(),
        onAbortFlush: vi.fn(),
        ...overrides,
    }
}

/** 创建模拟的 assistant 消息 */
function mockAssistantMessage(content: string = 'hello') {
    return {
        type: 'assistant' as const,
        message: { id: 'msg-test', role: 'assistant' as const, content: [{ type: 'text' as const, text: content }] },
        parent_tool_use_id: null,
        session_id: 'test-session',
    }
}

/** 创建模拟的 system/init 消息 */
function mockSystemInitMessage(sessionId: string = 'test-session-id') {
    return {
        type: 'system' as const,
        subtype: 'init' as const,
        session_id: sessionId,
        tools: [],
        model: 'claude-sonnet-4-20250514',
    }
}

/** 创建模拟的 result 消息 */
function mockResultMessage(terminalReason?: string) {
    return {
        type: 'result' as const,
        subtype: 'success' as const,
        cost_usd: 0.01,
        duration_ms: 1000,
        duration_api_ms: 800,
        is_error: false,
        num_turns: 1,
        session_id: 'test-session',
        total_cost_usd: 0.01,
        usage: { input_tokens: 100, output_tokens: 50 },
        ...(terminalReason ? { terminal_reason: terminalReason } : {}),
    }
}

/** 创建模拟的 stream_event 消息 */
function mockStreamEventMessage() {
    return {
        type: 'stream_event' as const,
        event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'hi' } },
        parent_tool_use_id: null,
        uuid: 'test-uuid',
    }
}

// ─── Mock awaitFileExist ────────────────────────────────────────

vi.mock('@/modules/watcher/awaitFileExist', () => ({
    awaitFileExist: vi.fn().mockResolvedValue(true),
}))

// ─── sdkOutputLoop 测试 ─────────────────────────────────────────

describe('sdkOutputLoop', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('处理 assistant 消息时调用 onMessage', async () => {
        const msg = mockAssistantMessage()
        const opts = createOutputLoopOpts()
        const ctx: LoopContext = { isCompactCommand: false }

        await sdkOutputLoop(asyncIterableFrom([msg]), ctx, opts)

        expect(opts.onMessage).toHaveBeenCalledWith(msg)
        // assistant 消息也会 flush
        expect(opts.snapshotSender.flush).toHaveBeenCalled()
    })

    it('同一 turn 多条 assistant（共享 message.id、各自 uuid）原样透传，不合并不覆盖 uuid', async () => {
        // SDK 文档：一个 turn 可产生多条共享 message.id 的 SDKAssistantMessage，每条有独立 uuid。
        // mobi 必须原样透传每条（Hub 按 local_id=uuid 去重天然正确）。
        // 历史 bug：曾把所有 assistant 的 uuid 覆盖成同一个 snapshot uuid，导致同 turn 多条
        // assistant 在 Hub 互相 UPDATE 覆盖、丢失 thinking/tool_use。本测试锁定「不覆盖」行为。
        const assistant1 = {
            type: 'assistant' as const,
            uuid: 'uuid-assistant-1',
            message: { id: 'msg_shared', role: 'assistant' as const, content: [{ type: 'thinking' as const, thinking: '先思考' }] },
            parent_tool_use_id: null,
            session_id: 'test-session',
        } as SDKMessage
        const toolResult = {
            type: 'user' as const,
            uuid: 'uuid-user-result',
            message: { role: 'user' as const, content: [{ type: 'tool_result' as const, tool_use_id: 'toolu_1', content: 'done' }] },
            parent_tool_use_id: null,
            session_id: 'test-session',
        } as SDKMessage
        const assistant2 = {
            type: 'assistant' as const,
            uuid: 'uuid-assistant-2',
            message: { id: 'msg_shared', role: 'assistant' as const, content: [{ type: 'text' as const, text: '结果' }] },
            parent_tool_use_id: null,
            session_id: 'test-session',
        } as SDKMessage
        const opts = createOutputLoopOpts()
        const ctx: LoopContext = { isCompactCommand: false }

        await sdkOutputLoop(asyncIterableFrom([assistant1, toolResult, assistant2]), ctx, opts)

        // 3 条消息全部透传，未被合并
        expect(opts.onMessage).toHaveBeenCalledTimes(3)
        // 关键：每条 assistant 的 uuid 原样到达，未被覆盖成同一个值
        expect(opts.onMessage).toHaveBeenNthCalledWith(1, assistant1)
        expect(opts.onMessage).toHaveBeenNthCalledWith(3, assistant2)
    })

    it('收到 assistant 消息时调用 snapshotSender.markFullDelivered（标记 full 已到）', async () => {
        const msg = mockAssistantMessage()
        const opts = createOutputLoopOpts()
        const ctx: LoopContext = { isCompactCommand: false }
        await sdkOutputLoop(asyncIterableFrom([msg]), ctx, opts)
        expect(opts.snapshotSender.markFullDelivered).toHaveBeenCalled()
    })

    it('迭代结束时有 pending full（full 未到、有累积）→ 调用 onAbortFlush 补全落库', async () => {
        const pending = { blocks: [{ type: 'text', text: '残留' }], model: 'm' }
        const base = createOutputLoopOpts()
        const opts = createOutputLoopOpts({
            snapshotSender: { ...base.snapshotSender, consumePendingFull: vi.fn().mockReturnValue(pending) },
        })
        const ctx: LoopContext = { isCompactCommand: false }
        // 不发 assistant（full 未到），模拟中断/abort 在流式中
        await sdkOutputLoop(asyncIterableFrom([]), ctx, opts)
        expect(opts.onAbortFlush).toHaveBeenCalledWith(pending)
    })

    it('迭代结束时无 pending（full 已到）→ 不调用 onAbortFlush', async () => {
        const msg = mockAssistantMessage() // assistant 触发 markFullDelivered
        const opts = createOutputLoopOpts() // consumePendingFull mock 返回 null
        const ctx: LoopContext = { isCompactCommand: false }
        await sdkOutputLoop(asyncIterableFrom([msg]), ctx, opts)
        expect(opts.onAbortFlush).not.toHaveBeenCalled()
    })

    it('signal abort 中断后、有 pending → 仍调用 onAbortFlush', async () => {
        const pending = { blocks: [{ type: 'thinking', thinking: '中断' }] }
        const base = createOutputLoopOpts()
        const opts = createOutputLoopOpts({
            snapshotSender: { ...base.snapshotSender, consumePendingFull: vi.fn().mockReturnValue(pending) },
        })
        const controller = new AbortController()
        controller.abort()
        const ctx: LoopContext = { isCompactCommand: false }
        await sdkOutputLoop(asyncIterableFrom([mockAssistantMessage()]), ctx, { ...opts, signal: controller.signal })
        expect(opts.onAbortFlush).toHaveBeenCalledWith(pending)
    })

    it('处理 system/init 消息时调用 onRunningChange(true) + onSessionFound', async () => {
        const msg = mockSystemInitMessage('session-123')
        const opts = createOutputLoopOpts()
        const ctx: LoopContext = { isCompactCommand: false }

        await sdkOutputLoop(asyncIterableFrom([msg]), ctx, opts)

        expect(opts.onRunningChange).toHaveBeenCalledWith(true)
        expect(opts.onSessionFound).toHaveBeenCalledWith('session-123')
    })

    it('处理 result 消息时调用 onRunningChange(false) + onReady，不阻塞', async () => {
        const resultMsg = mockResultMessage()
        const opts = createOutputLoopOpts()
        const ctx: LoopContext = { isCompactCommand: false }

        // 核心验证：result 后不阻塞，函数立即返回
        const start = Date.now()
        await sdkOutputLoop(asyncIterableFrom([resultMsg]), ctx, opts)
        const elapsed = Date.now() - start

        expect(opts.onRunningChange).toHaveBeenCalledWith(false)
        expect(opts.onReady).toHaveBeenCalled()
        // 不阻塞，应该很快完成（< 100ms）
        expect(elapsed).toBeLessThan(100)
    })

    it('result 后 SDK 继续产出消息时在迭代结束聚合输出（后台消息经 assembler 延迟到 flushAll）', async () => {
        // assembler 聚合 assistant partial，flushAll 在非 assistant / 结束时输出。
        // 后台 complete message（无后续非 assistant 分隔）延迟到迭代结束才 onMessage。
        // 取舍见 assistantPartialAssembler.ts 类注释（暂时保留 assembler 的代价）。
        const { iterable, push, end } = createPushableAsyncIterable<any>()
        const opts = createOutputLoopOpts()
        const ctx: LoopContext = { isCompactCommand: false }

        const loopPromise = sdkOutputLoop(iterable, ctx, opts)

        // result（非 assistant）→ flushAll（空）+ emit result
        push(mockResultMessage())
        await new Promise((r) => setTimeout(r, 10))
        expect(opts.onReady).toHaveBeenCalled()

        // 后台消息（assistant）→ assembler 累积（不立即 onMessage）
        const bgMsg = mockAssistantMessage('background task result')
        push(bgMsg)

        // 结束迭代 → flushAll → 聚合输出 bgMsg
        end()
        await loopPromise

        expect(opts.onMessage).toHaveBeenCalledWith(bgMsg)
    })

    it('isCompactCommand 在 result 时被读取并重置', async () => {
        const resultMsg = mockResultMessage()
        const opts = createOutputLoopOpts()
        const ctx: LoopContext = { isCompactCommand: true }

        await sdkOutputLoop(asyncIterableFrom([resultMsg]), ctx, opts)

        expect(opts.onCompletionEvent).toHaveBeenCalledWith('Compaction completed')
        // 重置为 false
        expect(ctx.isCompactCommand).toBe(false)
    })

    it('迭代器耗尽时正常返回', async () => {
        const opts = createOutputLoopOpts()
        const ctx: LoopContext = { isCompactCommand: false }

        // 空迭代器
        await sdkOutputLoop(asyncIterableFrom([]), ctx, opts)

        // 不应该抛出异常，正常返回
        expect(opts.onMessage).not.toHaveBeenCalled()
    })

    it('处理 stream_event 消息时不调用 onMessage（continue 跳过）', async () => {
        const streamMsg = mockStreamEventMessage()
        const opts = createOutputLoopOpts()
        const ctx: LoopContext = { isCompactCommand: false }

        await sdkOutputLoop(asyncIterableFrom([streamMsg]), ctx, opts)

        // stream_event 被 continue 跳过，不调用 onMessage
        expect(opts.onMessage).not.toHaveBeenCalled()
    })

    it('非 isCompactCommand 的 result 不触发 onCompletionEvent', async () => {
        const resultMsg = mockResultMessage()
        const opts = createOutputLoopOpts()
        const ctx: LoopContext = { isCompactCommand: false }

        await sdkOutputLoop(asyncIterableFrom([resultMsg]), ctx, opts)

        expect(opts.onCompletionEvent).not.toHaveBeenCalled()
    })
})

// ─── userInputLoop 测试 ─────────────────────────────────────────

describe('userInputLoop', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('普通消息被推入 messages PushableAsyncIterable', async () => {
        const messages = new PushableAsyncIterable<any>()
        const ctx: LoopContext = { isCompactCommand: false }
        const specialCommandCtx = createMockSpecialCommandCtx()

        // nextMessage 先返回普通消息，再返回 null 结束
        let callCount = 0
        const nextMessage = vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) {
                return { message: 'Hello Claude', mode: {} }
            }
            return null
        })

        const loopPromise = userInputLoop(messages, ctx, {
            nextMessage,
            specialCommandCtx,
        })

        // 等待消息被推送
        await new Promise((r) => setTimeout(r, 10))

        // messages 应该收到一条用户消息
        const iterator = messages[Symbol.asyncIterator]()
        const first = await iterator.next()
        expect(first.done).toBe(false)
        expect(first.value.message.content).toBe('Hello Claude')
        expect(first.value.type).toBe('user')

        // 等待循环结束
        await loopPromise
        expect(messages.done).toBe(true)
    })

    it('null 返回时 messages.end() 被调用', async () => {
        const messages = new PushableAsyncIterable<any>()
        const ctx: LoopContext = { isCompactCommand: false }
        const specialCommandCtx = createMockSpecialCommandCtx()

        const nextMessage = vi.fn().mockResolvedValue(null)

        await userInputLoop(messages, ctx, {
            nextMessage,
            specialCommandCtx,
        })

        expect(messages.done).toBe(true)
    })

    it('/clear 命令时 messages.end() 被调用', async () => {
        const messages = new PushableAsyncIterable<any>()
        const ctx: LoopContext = { isCompactCommand: false }
        const specialCommandCtx = createMockSpecialCommandCtx()

        const nextMessage = vi.fn().mockResolvedValue({ message: '/clear', mode: {} })

        await userInputLoop(messages, ctx, {
            nextMessage,
            specialCommandCtx,
        })

        expect(messages.done).toBe(true)
        expect(specialCommandCtx._calls.clear).toBe(1)
    })

    it('/compact 命令设置 ctx.isCompactCommand 并推入 messages', async () => {
        const messages = new PushableAsyncIterable<any>()
        const ctx: LoopContext = { isCompactCommand: false }
        const specialCommandCtx = createMockSpecialCommandCtx()

        let callCount = 0
        const nextMessage = vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) {
                return { message: '/compact', mode: {} }
            }
            return null
        })

        const loopPromise = userInputLoop(messages, ctx, {
            nextMessage,
            specialCommandCtx,
        })

        // 等待 compact 消息被推送
        await new Promise((r) => setTimeout(r, 10))

        // isCompactCommand 应该被设置为 true
        expect(ctx.isCompactCommand).toBe(true)

        // compact 消息被推入 messages
        const iterator = messages[Symbol.asyncIterator]()
        const first = await iterator.next()
        expect(first.done).toBe(false)
        expect(first.value.message.content).toBe('/compact')

        await loopPromise
    })

    it('!bash 命令被处理后继续等待下一条', async () => {
        const messages = new PushableAsyncIterable<any>()
        const ctx: LoopContext = { isCompactCommand: false }
        const specialCommandCtx = createMockSpecialCommandCtx()

        let callCount = 0
        const nextMessage = vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 1) {
                return { message: '! echo hello', mode: {} }
            }
            if (callCount === 2) {
                return { message: 'normal message', mode: {} }
            }
            return null
        })

        const loopPromise = userInputLoop(messages, ctx, {
            nextMessage,
            specialCommandCtx,
        })

        // 等待两条消息处理完毕
        await new Promise((r) => setTimeout(r, 20))

        // bash 命令被执行
        expect(specialCommandCtx._calls.bash).toEqual(['echo hello'])

        // 第二条普通消息被推入 messages
        const iterator = messages[Symbol.asyncIterator]()
        const first = await iterator.next()
        expect(first.done).toBe(false)
        expect(first.value.message.content).toBe('normal message')

        await loopPromise
    })

    it('agent 运行时不拉消息，idle 后才拉（gated pump C-2）', async () => {
        const messages = new PushableAsyncIterable<any>()
        const ctx: LoopContext = { isCompactCommand: false }
        const specialCommandCtx = createMockSpecialCommandCtx()
        const ac = new AbortController()

        let running = true
        let idleR: (() => void) | null = null
        const waitForIdle = () => new Promise<void>(r => { idleR = r })

        let nextCalls = 0
        const nextMessage = vi.fn().mockImplementation(async () => {
            nextCalls++
            return null
        })

        const loopPromise = userInputLoop(messages, ctx, {
            nextMessage,
            specialCommandCtx,
            isRunning: () => running,
            waitForIdle,
            signal: ac.signal,
        })

        // 几轮 microtask 后，running=true → 门控生效，不应拉消息
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        expect(nextCalls).toBe(0)

        // 模拟 result → agent 闲置
        running = false
        idleR?.()

        // idle 后门控放行，应拉取一条消息
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        expect(nextCalls).toBe(1)

        // 清理
        ac.abort()
        messages.end()
        await loopPromise.catch(() => {})
    })
})

// ─── 取消机制测试 ────────────────────────────────────────────────

describe('取消机制 (AbortController)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('sdkOutputLoop 在 signal abort 后停止迭代', async () => {
        const { iterable, push, end } = createPushableAsyncIterable<any>()
        const opts = createOutputLoopOpts()
        const ctx: LoopContext = { isCompactCommand: false }
        const controller = new AbortController()

        const loopPromise = sdkOutputLoop(iterable, ctx, { ...opts, signal: controller.signal })

        // 推送 result 和一条后台消息
        push(mockResultMessage())
        await new Promise((r) => setTimeout(r, 10))

        expect(opts.onReady).toHaveBeenCalledTimes(1)

        // abort 后推送更多消息
        controller.abort()
        push(mockAssistantMessage('should not process'))
        await new Promise((r) => setTimeout(r, 10))

        // abort 后的消息不应被处理
        expect(opts.onMessage).toHaveBeenCalledTimes(1) // 只有 result 被处理

        end()
        await loopPromise
    })

    it('userInputLoop 在 signal abort 后退出，不再等待 nextMessage', async () => {
        const messages = new PushableAsyncIterable<any>()
        const ctx: LoopContext = { isCompactCommand: false }
        const specialCommandCtx = createMockSpecialCommandCtx()
        const controller = new AbortController()

        // nextMessage 永远不 resolve（模拟挂起）
        const neverResolve = () => new Promise<null>(() => {})
        const nextMessage = vi.fn().mockImplementation(neverResolve)

        const loopPromise = userInputLoop(messages, ctx, {
            nextMessage,
            specialCommandCtx,
            signal: controller.signal,
        })

        // 循环应挂起在 nextMessage 上
        await new Promise((r) => setTimeout(r, 20))
        expect(messages.done).toBe(false)

        // abort 后应退出
        controller.abort()
        await loopPromise

        expect(messages.done).toBe(true)
    })

    it('Promise.race + abort 协调：sdkOutputLoop 结束时 userInputLoop 不挂起', async () => {
        // 模拟 sdkOutputLoop 立即结束（空迭代器），userInputLoop 挂起在 nextMessage
        const messages = new PushableAsyncIterable<any>()
        const ctx: LoopContext = { isCompactCommand: false }
        const controller = new AbortController()

        const nextMessage = vi.fn().mockImplementation(() => new Promise<null>(() => {}))
        const specialCommandCtx = createMockSpecialCommandCtx()

        // sdkOutputLoop 用空迭代器立即结束
        const sdkDone = sdkOutputLoop(asyncIterableFrom([]), ctx, {
            ...createOutputLoopOpts(),
            signal: controller.signal,
        })
        // userInputLoop 会挂起
        const userDone = userInputLoop(messages, ctx, {
            nextMessage,
            specialCommandCtx,
            signal: controller.signal,
        })

        // sdkOutputLoop 先完成
        await Promise.race([sdkDone, userDone])
        // abort 通知 userInputLoop 退出
        controller.abort()

        // userInputLoop 应在 abort 后退出
        await userDone
        expect(messages.done).toBe(true)
    })

    it('门控等待 idle 时 abort 能打破等待并退出（C-2 gated pump）', async () => {
        const messages = new PushableAsyncIterable<any>()
        const ctx: LoopContext = { isCompactCommand: false }
        const controller = new AbortController()
        const specialCommandCtx = createMockSpecialCommandCtx()

        // agent 一直运行，waitForIdle 永不 resolve（模拟长时间运行）
        const waitForIdle = () => new Promise<void>(() => {})
        const nextMessage = vi.fn().mockImplementation(() => new Promise<null>(() => {}))

        const loopPromise = userInputLoop(messages, ctx, {
            nextMessage,
            specialCommandCtx,
            isRunning: () => true,
            waitForIdle,
            signal: controller.signal,
        })

        // 循环应挂起在 idle 等待上
        await new Promise((r) => setTimeout(r, 20))
        expect(nextMessage).not.toHaveBeenCalled()
        expect(messages.done).toBe(false)

        // abort 应打破 idle 等待
        controller.abort()
        await loopPromise

        expect(messages.done).toBe(true)
        expect(nextMessage).not.toHaveBeenCalled()
    })
})
