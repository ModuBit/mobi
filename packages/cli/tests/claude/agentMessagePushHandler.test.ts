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
 * push-agent-message handler 的契约测试。
 *
 * 锁的是**本特性与既有投递路径的分界**：消息一步进 SDK input stream，中间没有投递队列。
 * 「没有队列」在本模块里是构造上的事实（工厂只收一个 sink getter，拿不到 session/queue），
 * 所以这里断言的是行为面：一次推送、只带 payload、载荷已含信封。
 *
 * sink 本体（claudeRemote 里那三行 pushUserMessage）与 launcher 的接线不在单测范围内，
 * 由 E2E 覆盖。
 */

import { describe, it, expect, vi } from 'vitest'
import { createAgentMessagePushHandler, parseAgentMessagePush } from '@/claude/utils/agentMessagePushHandler'
import type { AgentMessageDelivery } from '@mobi/shared'

const delivery: AgentMessageDelivery = {
    blocks: [{ type: 'text', text: 'hello there' }],
    messageId: 'm1',
    fromName: 'Sender',
    fromSessionId: 'A',
}

describe('createAgentMessagePushHandler', () => {
    it('投递成功：sink 收到一个参数——已插好信封、可直接 push 的 payload', async () => {
        const sink = vi.fn().mockReturnValue(true)
        const handler = createAgentMessagePushHandler(() => sink)

        const result = await handler(delivery)

        expect(result).toEqual({ status: 'delivered' })
        expect(sink).toHaveBeenCalledTimes(1)
        // 只带 payload：**没有第二个 localId 参数**（本路径不绑定 native_id，
        // 消息身份由信封携带）——这正是与 steer sink 的差别所在
        expect(sink.mock.calls[0]).toHaveLength(1)
        const payload = sink.mock.calls[0][0] as string
        expect(payload).toContain('<cross-session-message')
        expect(payload).toContain('from-session-id="A"')
        expect(payload).toContain('message-id="m1"')
        expect(payload).toContain('hello there')
    })

    it('sink 未就绪 → 明确拒绝，且不假装收下', async () => {
        const handler = createAgentMessagePushHandler(() => null)

        const result = await handler(delivery)

        // 本路径没有队列可放：收下就再也没人会处理这条消息
        expect(result.status).toBe('rejected')
        expect(result.status === 'rejected' && result.reason).toContain('not accepting input')
    })

    it('sink 返回 false（input stream 已关）→ 拒绝', async () => {
        const sink = vi.fn().mockReturnValue(false)
        const handler = createAgentMessagePushHandler(() => sink)

        const result = await handler(delivery)

        expect(result.status).toBe('rejected')
        expect(result.status === 'rejected' && result.reason).toContain('closed its input stream')
    })

    it('惰性取 sink：每一轮 launch 注入的 sink 都被用上，不是捕获第一次的', async () => {
        const first = vi.fn().mockReturnValue(true)
        const second = vi.fn().mockReturnValue(true)
        let current = first
        const handler = createAgentMessagePushHandler(() => current)

        await handler(delivery)
        current = second
        await handler(delivery)

        expect(first).toHaveBeenCalledTimes(1)
        expect(second).toHaveBeenCalledTimes(1)
    })

    it('载荷形状不对 → 拒绝，且完全不碰 sink', async () => {
        const sink = vi.fn().mockReturnValue(true)
        const handler = createAgentMessagePushHandler(() => sink)

        const results = await Promise.all([
            handler(null),
            handler({}),
            handler({ ...delivery, blocks: [] }),
            handler({ ...delivery, blocks: [{ type: 'nope' }] }),
            handler({ ...delivery, messageId: '' }),
            handler({ ...delivery, fromSessionId: '' }),
            handler({ ...delivery, fromName: undefined }),
        ])

        for (const result of results) {
            expect(result.status).toBe('rejected')
        }
        expect(sink).not.toHaveBeenCalled()
    })

    it('发送方会话未命名（fromName 空串）是合法输入', async () => {
        const sink = vi.fn().mockReturnValue(true)
        const handler = createAgentMessagePushHandler(() => sink)

        const result = await handler({ ...delivery, fromName: '' })

        expect(result).toEqual({ status: 'delivered' })
        expect(sink.mock.calls[0][0]).toContain('from-name=""')
    })
})

describe('parseAgentMessagePush', () => {
    it('把三形态 content 归一成 blocks（Hub 传的是归一后的，这里是二次把关）', () => {
        expect(parseAgentMessagePush({ ...delivery, blocks: 'plain' })?.blocks).toEqual([{ type: 'text', text: 'plain' }])
        expect(parseAgentMessagePush({ ...delivery, blocks: [{ type: 'text', text: 'x' }] })?.blocks).toEqual([
            { type: 'text', text: 'x' },
        ])
    })

    it('原样透传三个标识', () => {
        expect(parseAgentMessagePush(delivery)).toEqual(delivery)
    })
})
