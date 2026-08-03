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
import { StreamSnapshotSender } from './streamSnapshotSender'
import type { SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk'

/**
 * thinking 块打点 + 双出口注入（snapshot buildBlocks / full injectThinkingMeta）测试。
 *
 * remote 模式下，思考耗时来自 content_block_start→stop 的 wall clock 差；
 * snapshot→full 是替换关系，full 必须重新携带 durationMs/done，否则思考完成后「思考了 X 秒」丢失。
 */

// fake converter：把 buildBlocks() 的结果原样塞进返回对象，便于从 transport 收到的消息里断言 blocks
function makeFakeConverter() {
    return {
        convertSnapshot: (blocks: unknown[], opts: unknown) => ({ blocks, opts }),
    } as unknown as ConstructorParameters<typeof StreamSnapshotSender>[1]
}

function setup() {
    const transport = vi.fn()
    const sender = new StreamSnapshotSender(transport, makeFakeConverter())
    return { sender, transport }
}

/** 从 transport 第 idx 次收到的 DecryptedMessage 里取出 snapshot 的 blocks */
function snapshotBlocks(transport: ReturnType<typeof vi.fn>, idx = 0) {
    const msg = transport.mock.calls[idx]?.[0] as
        | { content?: { content?: { data?: { blocks?: unknown[] } } } }
        | undefined
    return msg?.content?.content?.data?.blocks
}

describe('StreamSnapshotSender — thinking 打点（snapshot 出口）', () => {
    it('thinking endBlock 后 flush 的 snapshot 带 durationMs 与 done:true', () => {
        const { sender, transport } = setup()
        sender.startBlock(0, 'thinking')
        sender.append(0, '在思考...')
        sender.endBlock(0) // content_block_stop：算 durationMs、置 done
        sender.flush()

        const blocks = snapshotBlocks(transport) as Array<{ type: string; durationMs?: number; done?: boolean }>
        const thinking = blocks.find(b => b.type === 'thinking')!
        expect(thinking.done).toBe(true)
        expect(typeof thinking.durationMs).toBe('number')
        expect(thinking.durationMs!).toBeGreaterThanOrEqual(0)
    })

    it('thinking 未 endBlock（流式中）时 snapshot 不带 done', () => {
        const { sender, transport } = setup()
        sender.startBlock(0, 'thinking')
        sender.append(0, '仍在思考')
        sender.flush()

        const blocks = snapshotBlocks(transport) as Array<{ type: string; done?: boolean; durationMs?: number }>
        const thinking = blocks.find(b => b.type === 'thinking')!
        expect(thinking.done).toBeUndefined()
        expect(thinking.durationMs).toBeUndefined()
    })

    it('text block 不打 durationMs/done', () => {
        const { sender, transport } = setup()
        sender.startBlock(0, 'text')
        sender.append(0, '正文')
        sender.endBlock(0)
        sender.flush()

        const blocks = snapshotBlocks(transport) as Array<{ type: string; done?: boolean; durationMs?: number }>
        const text = blocks.find(b => b.type === 'text')!
        expect(text.done).toBeUndefined()
        expect(text.durationMs).toBeUndefined()
    })
})

describe('StreamSnapshotSender — injectThinkingMeta（full 出口）', () => {
    it('把已 done 的 thinking durationMs/done 注入 full message 对应 thinking block', () => {
        const { sender } = setup()
        sender.startBlock(0, 'thinking')
        sender.append(0, '想通了')
        sender.endBlock(0)

        // full message 的 content 数组下标 = stream event 的 block index（这里 thinking 在 index 0）
        const full = {
            message: { content: [{ type: 'thinking', thinking: '想通了' }] },
        } as unknown as SDKAssistantMessage
        sender.injectThinkingMeta(full)

        const block = (full.message.content as unknown as Array<Record<string, unknown>>)[0]
        expect(block.done).toBe(true)
        expect(typeof block.durationMs).toBe('number')
    })

    it('未 done 的 thinking 不注入（abort 等场景无 meta，保留 SDK 原样）', () => {
        const { sender } = setup()
        sender.startBlock(0, 'thinking')
        sender.append(0, '还没想完')

        const full = {
            message: { content: [{ type: 'thinking', thinking: '还没想完' }] },
        } as unknown as SDKAssistantMessage
        sender.injectThinkingMeta(full)

        const block = (full.message.content as unknown as Array<Record<string, unknown>>)[0]
        expect(block.done).toBeUndefined()
        expect(block.durationMs).toBeUndefined()
    })

    it('非 thinking block 不被动；按 content 数组下标精确匹配（多 block 场景）', () => {
        const { sender } = setup()
        // index 0 是 text，index 1 是 thinking —— 仅 thinking 在 1 打点
        sender.startBlock(1, 'thinking')
        sender.append(1, '思考')
        sender.endBlock(1)

        const full = {
            message: {
                content: [
                    { type: 'text', text: '正文' },
                    { type: 'thinking', thinking: '思考' },
                ],
            },
        } as unknown as SDKAssistantMessage
        sender.injectThinkingMeta(full)

        const blocks = full.message.content as unknown as Array<Record<string, unknown>>
        expect(blocks[0]).toEqual({ type: 'text', text: '正文' }) // text 不被动
        expect(blocks[1].done).toBe(true) // thinking(index 1) 命中
        expect(typeof blocks[1].durationMs).toBe('number')
    })

    it('content 非数组（异常）安全跳过', () => {
        const { sender } = setup()
        const full = { message: { content: 'string-content' } } as unknown as SDKAssistantMessage
        expect(() => sender.injectThinkingMeta(full)).not.toThrow()
    })
})
