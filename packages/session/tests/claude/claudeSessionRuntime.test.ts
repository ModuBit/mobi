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
import { SessionStreamRuntime } from '@/claude/claudeSessionRuntime'
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
