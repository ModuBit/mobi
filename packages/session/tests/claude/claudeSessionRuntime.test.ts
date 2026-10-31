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
import { SessionStreamRuntime, isEmptyShellResult } from '@/claude/claudeSessionRuntime'
import type { RawJSONLines } from '@/claude/types'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

/**
 * 转换链 runtime（深化候选④票③）的测试面 = dispatch 的顺序契约与回填语义：
 * 「result 先入列再触发合成」两行顺序不可换（FIFO 时间线，曾靠跨文件注释维持），
 * 撤回抑制短路、tool_use 延迟配对、权限回填写入。
 */

function makeRuntime() {
    const sent: RawJSONLines[] = []
    const runtime = new SessionStreamRuntime({
        context: { sessionId: 's1', cwd: '/work', version: '0.0.0-test' },
        permissionResponses: new Map(),
        send: (m) => sent.push(m),
    })
    return { runtime, sent }
}

function makeHooks() {
    const order: string[] = []
    return {
        order,
        hooks: {
            observeTurnDiff: () => order.push('observe'),
            consumeResultFlags: () => { order.push('consumeResultFlags'); return false },
            onResultEnqueued: () => order.push('onResultEnqueued'),
        },
    }
}

const resultLog = { type: 'result', subtype: 'success', uuid: 'r1' } as unknown as RawJSONLines
const RESULT_MSG = { type: 'result' } as unknown as SDKMessage

describe('SessionStreamRuntime.dispatch 顺序契约', () => {
    it('result 帧严格按 observe → 入列 → 合成触发 的顺序（两行不可换的锁）', () => {
        const { runtime } = makeRuntime()
        const { order, hooks } = makeHooks()
        const enqueueSpy = vi.spyOn(runtime.queue, 'enqueue')

        runtime.dispatch(resultLog, RESULT_MSG, hooks)

        // result 必须先入列、合成触发在后：反转会让合成卡片抢在 result 之前注册（FIFO 时间线错乱）
        expect(order).toEqual(['observe', 'consumeResultFlags', 'onResultEnqueued'])
        expect(enqueueSpy).toHaveBeenCalledWith(resultLog)
    })

    it('consumeResultFlags 返回 true（撤回抑制）→ 不入列不触发合成', () => {
        const { runtime } = makeRuntime()
        const order: string[] = []
        runtime.dispatch(resultLog, RESULT_MSG, {
            observeTurnDiff: () => order.push('observe'),
            consumeResultFlags: () => true,
            onResultEnqueued: () => order.push('onResultEnqueued'),
        })

        expect(order).toEqual(['observe'])
    })

    it('discard 类消息不出链（observe 后即返回，不入列）', () => {
        const { runtime } = makeRuntime()
        const enqueueSpy = vi.spyOn(runtime.queue, 'enqueue')
        const { hooks } = makeHooks()

        // commands_changed 等控制帧由 classifyMessage 归 discard
        runtime.dispatch({ type: 'system', subtype: 'commands_changed' } as unknown as RawJSONLines, RESULT_MSG, hooks)

        expect(enqueueSpy).not.toHaveBeenCalled()
    })

    it('主线 assistant 带 tool_use → 延迟入列（delay 250 + toolCallIds 等配对）', () => {
        const { runtime } = makeRuntime()
        const enqueueSpy = vi.spyOn(runtime.queue, 'enqueue')
        const { hooks } = makeHooks()

        // 主线 = parent_tool_use_id 字段缺省（判据 !== undefined：null 同样算 sidechain）
        const message = {
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] },
        } as unknown as SDKMessage
        runtime.dispatch({ type: 'assistant' } as unknown as RawJSONLines, message, hooks)

        expect(enqueueSpy).toHaveBeenCalledTimes(1)
        expect(enqueueSpy).toHaveBeenCalledWith(
            { type: 'assistant' },
            { delay: 250, toolCallIds: ['t1'] },
        )
    })

    it('sidechain（子代理）tool_use 不延迟——照常统一入列', () => {
        const { runtime } = makeRuntime()
        const enqueueSpy = vi.spyOn(runtime.queue, 'enqueue')
        const { hooks } = makeHooks()

        const message = {
            type: 'assistant',
            parent_tool_use_id: 'parent-1',
            message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] },
        } as unknown as SDKMessage
        runtime.dispatch({ type: 'assistant' } as unknown as RawJSONLines, message, hooks)

        expect(enqueueSpy).toHaveBeenCalledTimes(1)
        expect(enqueueSpy).toHaveBeenCalledWith({ type: 'assistant' })
    })
})

describe('SessionStreamRuntime.dispatch 空壳 result 过滤', () => {
    /**
     * 空壳 result 形状按 2026-10-31 真实事故行实证（mobi.db seq 1055）：CC 对被合并的
     * task-notification 唤醒各发一条零信息回执，落库即被 web 渲染成「42ms」幽灵轮次行。
     * 注意 duration_ms（墙钟 42ms）非零——谓词只看 duration_api_ms，此字段是活锁。
     */
    function makeShellResult(overrides: Record<string, unknown> = {}): RawJSONLines {
        return {
            type: 'result',
            subtype: 'success',
            is_error: false,
            duration_api_ms: 0,
            num_turns: 0,
            stop_reason: null,
            result: '',
            usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 },
            duration_ms: 42,
            ...overrides,
        } as unknown as RawJSONLines
    }

    it('空壳 result → 不入列、不触发合成、不消费 result 标志（标志留给真 result）', () => {
        const { runtime } = makeRuntime()
        const { order, hooks } = makeHooks()
        const enqueueSpy = vi.spyOn(runtime.queue, 'enqueue')

        runtime.dispatch(makeShellResult(), RESULT_MSG, hooks)

        expect(enqueueSpy).not.toHaveBeenCalled()
        // 未走到 consumeResultFlags：撤回抑制 / pendingAbortInfo 只应绑在会被转发的行上
        expect(order).toEqual(['observe'])
    })

    it('零回合但带非空文本（fork code-review 报告等真内容）→ 照常入列', () => {
        const { runtime } = makeRuntime()
        const { order, hooks } = makeHooks()
        const enqueueSpy = vi.spyOn(runtime.queue, 'enqueue')

        runtime.dispatch(makeShellResult({ result: '评审范围：…8 项 findings' }), RESULT_MSG, hooks)

        expect(enqueueSpy).toHaveBeenCalledTimes(1)
        expect(order).toEqual(['observe', 'consumeResultFlags', 'onResultEnqueued'])
    })

    it.each([
        ['is_error 报错', { is_error: true }],
        ['stop_reason 终止', { stop_reason: 'end_turn' }],
        ['terminal_reason 中断回执', { terminal_reason: 'interrupted' }],
        ['duration_api_ms 有 API 耗时', { duration_api_ms: 123 }],
        ['usage.output_tokens 有产出', { usage: { output_tokens: 7 } }],
    ])('零回合空文本但 %s → 照常入列（谓词 fail-safe：拿不准就保留）', (_label, override) => {
        const { runtime } = makeRuntime()
        const { hooks } = makeHooks()
        const enqueueSpy = vi.spyOn(runtime.queue, 'enqueue')

        runtime.dispatch(makeShellResult(override), RESULT_MSG, hooks)

        expect(enqueueSpy).toHaveBeenCalledTimes(1)
    })

    it('isEmptyShellResult：正常 result 与非 result 行恒 false', () => {
        expect(isEmptyShellResult(makeShellResult({ num_turns: 5 }))).toBe(false)
        expect(isEmptyShellResult({ type: 'assistant' } as unknown as RawJSONLines)).toBe(false)
    })
})

describe('SessionStreamRuntime.dispatch 权限回填', () => {
    it('user tool_result 命中审批回执 → 写入 permissions（approved/denied + mode + allowTools）', () => {
        const responses = new Map([
            ['t1', { approved: true, receivedAt: 111, mode: 'acceptEdits', allowTools: ['Bash'] } as never],
            ['t2', { approved: false } as never],
        ])
        const runtime = new SessionStreamRuntime({
            context: { sessionId: 's1', cwd: '/work' },
            permissionResponses: responses,
            send: () => {},
        })

        const log = {
            type: 'user',
            message: {
                content: [
                    { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
                    { type: 'tool_result', tool_use_id: 't2', content: 'nope' },
                    { type: 'tool_result', tool_use_id: 't3', content: '未审批' },
                ],
            },
        } as unknown as RawJSONLines
        const { hooks } = makeHooks()
        runtime.dispatch(log, { type: 'user' } as unknown as SDKMessage, hooks)

        const blocks = log.message!.content as Array<{ tool_use_id?: string; permissions?: { result: string; mode?: string; allowedTools?: string[]; date: number } }>
        expect(blocks[0].permissions).toEqual({ date: 111, result: 'approved', mode: 'acceptEdits', allowedTools: ['Bash'] })
        expect(blocks[1].permissions).toEqual({ date: expect.any(Number), result: 'denied' })
        expect(blocks[2].permissions).toBeUndefined()
    })
})

describe('SessionStreamRuntime 转换链装配', () => {
    it('converter / queue / sender 工厂三件齐备，sender 与 converter 同源', () => {
        const { runtime } = makeRuntime()
        expect(runtime.converter).toBeDefined()
        expect(runtime.queue).toBeDefined()

        const onSnapshot = vi.fn()
        const sender = runtime.createSnapshotSender(onSnapshot)
        expect(sender).toBeDefined()
        expect(typeof sender.start).toBe('function')
    })
})
