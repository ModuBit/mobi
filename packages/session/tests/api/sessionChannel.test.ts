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

/**
 * SessionChannel（深化候选③票①）的测试面 = 它自己的接口：report 单一事件出口的
 * wire 映射、入站分流（用户消息入队 / seq 去重 / 非用户冒泡）、连接反应
 * （session-alive 上报 + snapshot 重基线 + 断窗补拉）。传输用 fake——协议语义不需要真连接。
 */

vi.mock('@mobi/node-core/logger', () => ({
    logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('@mobi/node-core/configuration', () => ({
    configuration: { apiUrl: 'http://127.0.0.1:2222' },
}))

const axiosGet = vi.hoisted(() => vi.fn(async () => ({ data: { messages: [] } })))
vi.mock('axios', () => ({ default: { get: axiosGet } }))

import { SessionChannel } from '@/api/sessionChannel'
import type { SessionTransport } from '@/api/sessionTransport'
import type { Update } from '@mobi/shared'

/** 传输 fake：只实现 channel 消费的发送面，emit 全捕获 */
function makeHarness() {
    const emitted: { event: string; payload: unknown }[] = []
    const transport = {
        connected: true,
        emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
        emitWithAck: vi.fn(async () => ({ ok: true })),
        emitAckCallback: vi.fn((_e: string, _b: unknown, _t: number, cb: (err: unknown) => void) => cb(null, { ok: true })),
    } as unknown as SessionTransport

    const onMessage = vi.fn()
    const onActivity = vi.fn()
    const channel = new SessionChannel({
        token: 'token',
        session: {
            id: 'session-1',
            metadata: null,
            metadataVersion: 0,
            agentState: null,
            agentStateVersion: 0,
        } as never,
        transport,
        onMessage,
        onActivity,
    })
    return { channel, transport, emitted, onMessage, onActivity }
}

const userUpdate = (seq: number, text = 'hi'): Update => ({
    body: {
        t: 'new-message',
        message: {
            seq,
            content: { role: 'user', content: { type: 'text', text }, meta: { sentFrom: 'web' } },
        },
    },
} as never)

beforeEach(() => {
    axiosGet.mockClear()
})

describe('SessionChannel：report 单一出口的 wire 映射（协议不变锁）', () => {
    it('六类 report 各映射回既有 socket 事件名与负载形状', () => {
        const { channel, emitted } = makeHarness()

        channel.report({ kind: 'facts', facts: [{ kind: 'pushed', localIds: ['a'], at: 1 }] })
        channel.report({ kind: 'context-usage', contextUsage: { used: 10 } as never })
        channel.report({ kind: 'run-started', runStartedAt: 123 })
        channel.report({ kind: 'receive-readiness', canReceive: true })
        channel.report({ kind: 'goal-status', goalStatus: null })
        channel.report({ kind: 'cache-status', cacheStatus: null })

        expect(emitted).toEqual([
            { event: 'messages-facts', payload: { sid: 'session-1', facts: [{ kind: 'pushed', localIds: ['a'], at: 1 }] } },
            { event: 'context-usage', payload: { sid: 'session-1', contextUsage: { used: 10 } } },
            { event: 'run-started', payload: { sid: 'session-1', runStartedAt: 123 } },
            { event: 'receive-readiness', payload: { sid: 'session-1', canReceive: true } },
            { event: 'goal-status', payload: { sid: 'session-1', goalStatus: null } },
            { event: 'cache-status', payload: { sid: 'session-1', cacheStatus: null } },
        ])
    })

    it('空 facts 批不上报', () => {
        const { channel, emitted } = makeHarness()
        channel.report({ kind: 'facts', facts: [] })
        expect(emitted).toEqual([])
    })
})

describe('SessionChannel：入站分流', () => {
    it('new-message 用户消息经 onUserMessage 接收；非用户内容冒泡 onMessage', () => {
        const { channel, onMessage } = makeHarness()
        const received: string[] = []
        channel.onUserMessage((m) => received.push(m.content.type === 'text' ? m.content.text : '?'))

        channel.handleSessionUpdate(userUpdate(1))
        channel.handleSessionUpdate({
            body: { t: 'runtime-state', whatever: true },
        } as never)

        expect(received).toEqual(['hi'])
        expect(onMessage).toHaveBeenCalledWith({ t: 'runtime-state', whatever: true })
    })

    it('先到后订阅：pending 队列在 onUserMessage 时排空', () => {
        const { channel } = makeHarness()
        channel.handleSessionUpdate(userUpdate(1, 'early'))
        const received: string[] = []
        channel.onUserMessage((m) => received.push(m.content.type === 'text' ? m.content.text : '?'))
        expect(received).toEqual(['early'])
    })

    it('seq 去重：重复/回退的 seq 不再入队（断线补拉幂等的地基）', () => {
        const { channel } = makeHarness()
        const received: number[] = []
        channel.onUserMessage(() => received.push(1))

        channel.handleSessionUpdate(userUpdate(3))
        channel.handleSessionUpdate(userUpdate(3))
        channel.handleSessionUpdate(userUpdate(2))
        expect(received).toHaveLength(1)
    })
})

describe('SessionChannel：连接反应', () => {
    it('handleConnected 上报存活并触发 snapshot 重基线', () => {
        const { channel, emitted } = makeHarness()
        const reset = vi.fn()
        channel.setSnapshotTransportReset(reset)

        channel.handleConnected(true)

        expect(reset).toHaveBeenCalledTimes(1)
        expect(emitted.some((e) => e.event === 'session-alive')).toBe(true)
    })

    it('断线后重连触发断窗补拉（afterSeq 从已见 seq 起步）', async () => {
        const { channel } = makeHarness()
        channel.onUserMessage(() => {})
        channel.handleSessionUpdate(userUpdate(7))

        channel.handleDisconnected()
        channel.handleConnected(false)

        await vi.waitFor(() => expect(axiosGet).toHaveBeenCalledTimes(1))
        const [url, config] = axiosGet.mock.calls[0]
        expect(String(url)).toContain('/cli/sessions/session-1/messages')
        expect(config.params).toEqual({ afterSeq: 7, limit: 200 })
    })

    it('首连不补拉（无断窗）', async () => {
        const { channel } = makeHarness()
        channel.handleConnected(true)
        await new Promise((r) => setTimeout(r, 0))
        expect(axiosGet).not.toHaveBeenCalled()
    })
})

describe('SessionChannel：版本化更新', () => {
    it('updateMetadata 走 ack 咽喉并通知活动（门面据此重置空闲计时）', async () => {
        const { channel, transport, onActivity } = makeHarness()
        channel.updateMetadata((m) => ({ ...m, name: '新名字' }))

        await vi.waitFor(() => expect(onActivity).toHaveBeenCalled())
        const fake = transport as unknown as { emitWithAck: ReturnType<typeof vi.fn> }
        expect(fake.emitWithAck).toHaveBeenCalledWith(
            'update-metadata',
            expect.objectContaining({ sid: 'session-1', expectedVersion: 0, metadata: { name: '新名字' } }),
            5_000,
        )
    })

    it('updateAgentState 对称走 update-state 咽喉（票②参数化后的行为锁）', async () => {
        const { channel, transport, onActivity } = makeHarness()
        channel.updateAgentState((s) => ({ ...s, paused: true }))

        await vi.waitFor(() => expect(onActivity).toHaveBeenCalled())
        const fake = transport as unknown as { emitWithAck: ReturnType<typeof vi.fn> }
        expect(fake.emitWithAck).toHaveBeenCalledWith(
            'update-state',
            expect.objectContaining({ sid: 'session-1', expectedVersion: 0, agentState: { paused: true } }),
            5_000,
        )
    })
})
