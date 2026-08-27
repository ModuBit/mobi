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

import { describe, test, expect } from 'bun:test'
import { MessageService } from '../../src/sync/messageService'
import { Store } from '../../src/store'

/**
 * sendMessage 落库格式测试：用户消息 content 三形态（string / 单 block / block 数组）
 * 归一后统一落库为 UserContentBlock[]。使用真实 :memory: Store 验证完整落库链路。
 */
function makeService() {
    const store = new Store(':memory:')
    const session = store.sessions.getOrCreateSession('t1', { path: '/a' }, null, 'default')

    const cliEmits: { body: { t: string } }[] = []
    const published: { type: string }[] = []
    // io.of(ns).to(room).emit(event, update) —— 只捕获第二参 update 信封
    const io = { of: () => ({ to: () => ({ emit: (_event: string, update: { body: { t: string } }) => { cliEmits.push(update) } }) }) }
    const publisher = { emit: (event: { type: string }) => { published.push(event) } }

    const service = new MessageService(store, io as never, publisher as never)
    return { service, sessionId: session.id, cliEmits, published }
}

describe('MessageService.sendMessage 内容归一落库', () => {
    test('三形态均落库为 block 数组', async () => {
        const { service, sessionId } = makeService()

        await service.sendMessage(sessionId, { content: 'hi', sentFrom: 'webapp' })
        await service.sendMessage(sessionId, { content: [{ type: 'text', text: 'yo' }], localId: 'l2', sentFrom: 'webapp' })
        await service.sendMessage(sessionId, {
            content: {
                type: 'text', text: 'old-style',
                attachments: [{ id: '1', filename: 'a.png', mimeType: 'image/png', size: 3, path: '/p/a.png', previewUrl: '/u' }],
            },
            sentFrom: 'webapp',
        })

        const msgs = service.getMessagesAfter(sessionId, { afterSeq: 0, limit: 10 })
        const bodies = msgs.map((m) => (m.content as { content: unknown })?.content)
        expect(bodies[0]).toEqual([{ type: 'text', text: 'hi' }])
        expect(bodies[1]).toEqual([{ type: 'text', text: 'yo' }])
        // 旧平铺 attachment 归一为 document block（历史数据不做 image/document 重分类）
        expect(bodies[2]).toEqual([
            { type: 'text', text: 'old-style' },
            { type: 'document', source: { type: 'url', value: '/p/a.png', mimeType: 'image/png' }, id: '1', filename: 'a.png', size: 3, previewUrl: '/u' },
        ])
    })

    test('meta.sentFrom 落库且 CLI 收到 new-message 推送', async () => {
        const { service, sessionId, cliEmits, published } = makeService()

        await service.sendMessage(sessionId, { content: 'hi', sentFrom: 'webapp' })

        const msgs = service.getMessagesAfter(sessionId, { afterSeq: 0, limit: 10 })
        expect((msgs[0].content as { meta?: { sentFrom?: string } }).meta).toEqual({ sentFrom: 'webapp' })
        expect(cliEmits[0].body.t).toBe('new-message')
        expect(published[0].type).toBe('message-received')
    })

    test('内容无法归一（null / 空串 / 全畸形）时抛错，不落库', async () => {
        const { service, sessionId } = makeService()

        for (const bad of [null, '', [], [{ type: 'unknown' }]]) {
            expect(service.sendMessage(sessionId, { content: bad, sentFrom: 'webapp' })).rejects.toThrow()
        }

        const msgs = service.getMessagesAfter(sessionId, { afterSeq: 0, limit: 10 })
        expect(msgs).toHaveLength(0)
    })
})
