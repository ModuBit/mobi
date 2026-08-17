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
import type { StoredMessage } from '../../src/store/types'

/** 构造 StoredMessage（默认 pending 排队消息） */
function msg(seq: number, over: Partial<StoredMessage> = {}): StoredMessage {
    return {
        id: `id-${seq}`, sessionId: 's', content: {}, createdAt: seq * 10, seq,
        localId: `loc-${seq}`, metadata: null, deletedAt: null, isSidechain: false, parentToolUseId: null,
        category: 'persistent', submittedAt: null,
        queueState: 'pending', positionAt: seq * 10,
        ...over,
    }
}

/** mock store：getMessages 按 beforeSeq 返回可控结果；getUnsubmittedLocalMessages 返回指定集 */
function makeService(opts: {
    page: StoredMessage[]
    olderProbe?: StoredMessage[]   // getMessages(_, 1, oldestSeq) 的返回，模拟更早历史
}) {
    const calls: { beforeSeq?: number | undefined }[] = []
    const store = {
        messages: {
            getMessages: (_sid: string, _limit: number, beforeSeq?: number) => {
                calls.push({ beforeSeq })
                // 探针调用（limit=1 且带 beforeSeq）→ 返回 olderProbe
                if (_limit === 1 && beforeSeq !== undefined) return opts.olderProbe ?? []
                return opts.page
            },
            getUnsubmittedLocalMessages: () => opts.page.filter(m => m.queueState === 'pending'),
        },
    }
    const service = new MessageService(store as never, {} as never, {} as never)
    return { service, calls }
}

describe('MessageService.getMessagesPage 游标', () => {
    test('整页全 pending 时仍能翻页（游标取最老消息 seq，不因 pending 跳过）', () => {
        // 场景：agent 卡住，用户连发 3 条全 pending；更早有历史
        const { service } = makeService({
            page: [msg(1), msg(2), msg(3)],
            olderProbe: [msg(0, { queueState: null })], // 更早存在一条非排队消息
        })

        const result = service.getMessagesPage('s', { limit: 3, beforeSeq: null })

        // 关键：hasMore=true，nextBeforeSeq 指向页内最老消息（seq=1），而非 null 卡死
        expect(result.page.hasMore).toBe(true)
        expect(result.page.nextBeforeSeq).toBe(1)
    })
})
