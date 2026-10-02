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
        category: 'persistent', lifecycleAt: null,
        lifecycle: 'queued', positionAt: seq * 10,
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
            getUnsubmittedLocalMessages: () => opts.page.filter(m => m.lifecycle === 'queued'),
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
            olderProbe: [msg(0, { lifecycle: null })], // 更早存在一条非排队消息
        })

        const result = service.getMessagesPage('s', { limit: 3, beforeSeq: null })

        // 关键：hasMore=true，nextBeforeSeq 指向页内最老消息（seq=1），而非 null 卡死
        expect(result.page.hasMore).toBe(true)
        expect(result.page.nextBeforeSeq).toBe(1)
    })
})

describe('MessageService.redeliverQueued（fork 激活翻转补投）', () => {
    /** mock io：捕获 room emit */
    function makeServiceWithIo(opts: { queued: StoredMessage[] }) {
        const emits: Array<{ room: string; event: string; args: unknown[] }> = []
        const io = {
            of: () => ({
                to: (room: string) => ({
                    emit: (event: string, ...args: unknown[]) => { emits.push({ room, event, args }) },
                }),
            }),
        }
        const store = {
            messages: {
                getUnsubmittedLocalMessages: (_sid: string) => opts.queued,
            },
        }
        const service = new MessageService(store as never, io as never, {} as never)
        return { service, emits }
    }

    const userMsg = (text: string) => ({
        role: 'user',
        content: [{ type: 'text', text }],
        meta: { sentFrom: 'webapp' },
    })

    test('仍 queued 的行重放为 new-message 房间广播（body 形态与 sendMessage 一致）', () => {
        const queued = [msg(1, { content: userMsg('激活前的首条消息') })]
        const { service, emits } = makeServiceWithIo({ queued })

        service.redeliverQueued('s1')

        expect(emits).toHaveLength(1)
        const { room, event, args } = emits[0]
        expect(room).toBe('session:s1')
        expect(event).toBe('session-update')
        const update = args[0] as { body: { t: string; sid: string; message: { seq: number } } }
        expect(update.body.t).toBe('new-message')
        expect(update.body.sid).toBe('s1')
        expect(update.body.message.seq).toBe(1)
    })

    test('无 queued 行时不广播', () => {
        const { service, emits } = makeServiceWithIo({ queued: [] })

        service.redeliverQueued('s1')

        expect(emits).toHaveLength(0)
    })
})

describe('MessageService 出口剥离死重 base64 图片数据', () => {
    /** 构造 Read 工具读图的 transcript 帧：同一张图在 tool_use_result 与 tool_result image 各存一份 */
    function imageReadFrame(seq: number, base64: string): StoredMessage {
        return {
            ...msg(seq, { lifecycle: null, localId: null }),
            content: {
                role: 'agent',
                content: {
                    type: 'text',
                    data: {
                        uuid: `u-${seq}`,
                        message: {
                            role: 'user',
                            content: [{
                                type: 'tool_result',
                                tool_use_id: `tu-${seq}`,
                                content: [{
                                    type: 'image',
                                    source: { type: 'base64', media_type: 'image/png', data: base64 },
                                }],
                            }],
                        },
                        tool_use_result: {
                            type: 'image',
                            file: { base64, type: 'image/png', originalSize: 100, dimensions: {} },
                        },
                    },
                },
            },
        } as unknown as StoredMessage
    }

    const BIG = 'iVBORw0KGgo' + 'A'.repeat(200_000)
    const MARKER = '[mobi:base64-stripped]'

    test('getMessagesPage：tool_use_result.file.base64 与 tool_result image source.data 均被剥离为占位符', () => {
        const { service } = makeService({ page: [imageReadFrame(1, BIG)] })

        const result = service.getMessagesPage('s', { limit: 10, beforeSeq: null })
        const raw = JSON.stringify(result.messages)

        expect(raw).not.toContain(BIG)
        expect(raw).toContain(MARKER)
        // 非大字段原样保留（dimensions 等 meta 不受影响）
        const frame = result.messages[0].content as { content: { data: { tool_use_result: { file: { dimensions: unknown; originalSize: number } } } } }
        expect(frame.content.data.tool_use_result.file.dimensions).toBeDefined()
        expect(frame.content.data.tool_use_result.file.originalSize).toBe(100)
    })

    test('剥离只发生在出口：入库原对象不被原地修改', () => {
        const original = imageReadFrame(1, BIG)
        const { service } = makeService({ page: [original] })

        service.getMessagesPage('s', { limit: 10, beforeSeq: null })

        const frame = original.content as { content: { data: { tool_use_result: { file: { base64: string } } } } }
        expect(frame.content.data.tool_use_result.file.base64).toBe(BIG)
    })

    test('无 base64 的普通消息原样透传，不被剥离逻辑触碰', () => {
        const plain = msg(1, {
            lifecycle: null,
            content: { role: 'agent', content: { type: 'text', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } } },
        })
        const { service } = makeService({ page: [plain] })

        const result = service.getMessagesPage('s', { limit: 10, beforeSeq: null })
        expect(JSON.stringify(result.messages)).toContain('hello')
        expect(JSON.stringify(result.messages)).not.toContain(MARKER)
    })
})

describe('MessageService 出口剥离 tool_result 重内容', () => {
    /** 构造 assistant tool_use + user tool_result 帧对（注册表靠 assistant 帧喂饱） */
    const assistantFrame = (toolUseId: string, toolName: string): unknown => ({
        role: 'agent',
        content: {
            type: 'text',
            data: {
                uuid: `ua-${toolUseId}`,
                message: { role: 'assistant', content: [{ type: 'tool_use', id: toolUseId, name: toolName, input: {} }] },
            },
        },
    })
    const resultFrame = (seq: number, toolUseId: string, blockContent: unknown, opts: { isError?: boolean; toolUseResult?: unknown } = {}): StoredMessage => ({
        ...msg(seq, { lifecycle: null, localId: null }),
        content: {
            role: 'agent',
            content: {
                type: 'text',
                data: {
                    uuid: `ur-${seq}`,
                    message: {
                        role: 'user',
                        content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: opts.isError, content: blockContent }],
                    },
                    ...(opts.toolUseResult !== undefined ? { tool_use_result: opts.toolUseResult } : {}),
                },
            },
        },
    } as unknown as StoredMessage)

    const BIG = 'x'.repeat(100_000)

    test('Read 大结果经出口替换为占位；Edit 的 tool_use_result.structuredPatch 原样保留', () => {
        const tur = { type: 'edit', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['+n'] }] }
        const { service } = makeService({
            page: [
                { ...msg(1, { lifecycle: null, localId: null }), content: assistantFrame('tu-e', 'Edit') } as StoredMessage,
                resultFrame(2, 'tu-e', [{ type: 'text', text: BIG }], { toolUseResult: tur }),
            ],
        })

        const result = service.getMessagesPage('s', { limit: 10, beforeSeq: null })
        const raw = JSON.stringify(result.messages)

        expect(raw).not.toContain(BIG)
        expect(raw).toContain('[file content omitted — open via file chip]')
        expect(raw).toContain('"structuredPatch"')
    })

    test('Task 族与 is_error 结果不剥离', () => {
        const { service } = makeService({
            page: [
                { ...msg(1, { lifecycle: null, localId: null }), content: assistantFrame('tu-t', 'TaskList') } as StoredMessage,
                resultFrame(2, 'tu-t', [{ type: 'text', text: BIG }]),
                resultFrame(3, 'tu-unknown', [{ type: 'text', text: BIG }], { isError: true }),
            ],
        })

        const raw = JSON.stringify(service.getMessagesPage('s', { limit: 10, beforeSeq: null }))

        // TaskList 结果全量保留；未注册工具的失败结果也全量保留
        expect(raw).toContain(BIG)
    })

    test('出口剥离不落库：原始 StoredMessage.content 仍是全量', () => {
        const original = resultFrame(1, 'tu-cold', [{ type: 'text', text: BIG }])
        const { service } = makeService({ page: [original] })

        service.getMessagesPage('s', { limit: 10, beforeSeq: null })

        expect(JSON.stringify(original)).toContain(BIG)
    })
})
