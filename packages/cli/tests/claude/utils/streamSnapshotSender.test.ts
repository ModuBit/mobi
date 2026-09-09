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
import { StreamSnapshotSender, type SnapshotOut } from '../../../src/claude/utils/streamSnapshotSender'
import { SNAPSHOT_PENDING_ID } from '@mobi/shared'
import type { SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk'
import type { RawJSONLines } from '../../../src/claude/types'
import type { SDKToLogConverter } from '../../../src/claude/utils/sdkToLogConverter'

function createSender() {
    const transport = vi.fn()
    // 透传 blocks：部分用例需从全量帧断言 snapshot blocks 内容
    const convertSnapshot = vi.fn((blocks: unknown[], opts: unknown) => ({ blocks, opts } as unknown as RawJSONLines))
    const converter = { convertSnapshot } as unknown as SDKToLogConverter
    const sender = new StreamSnapshotSender(transport, converter)
    return { sender, transport, convertSnapshot }
}

/** 取 transport 第 idx 帧的输出（类型窄化用） */
function frameAt(transport: ReturnType<typeof vi.fn>, idx: number): SnapshotOut {
    return transport.mock.calls[idx][0] as SnapshotOut
}

describe('StreamSnapshotSender - abort 补全（consumePendingFull）', () => {
    it('endBlock 后内容保留（不删 buffer），consumePendingFull 能读到', () => {
        const { sender } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'text')
        sender.append(0, 'hello')
        sender.endBlock(0)

        const pending = sender.consumePendingFull()
        expect(pending).not.toBeNull()
        expect(pending!.blocks).toEqual([{ type: 'text', text: 'hello' }])
    })

    it('message_start（setSnapshotOpts）重置 fullDelivered，clearBuffers 清空累积', () => {
        const { sender } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'text')
        sender.append(0, 'first')
        sender.endBlock(0)
        sender.markFullDelivered()
        expect(sender.consumePendingFull()).toBeNull()

        // 新 message：fullDelivered 重置 + buffers 清空
        sender.setSnapshotOpts({ sdkUuid: 'uuid-2' })
        sender.clearBuffers()
        sender.startBlock(0, 'thinking')
        sender.append(0, 'new thought')

        const pending = sender.consumePendingFull()
        expect(pending).not.toBeNull()
        expect(pending!.blocks).toEqual([{ type: 'thinking', thinking: 'new thought' }])
    })

    it('markFullDelivered 后 consumePendingFull 返回 null', () => {
        const { sender } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'text')
        sender.append(0, 'hello')
        sender.markFullDelivered()

        expect(sender.consumePendingFull()).toBeNull()
    })

    it('流式中（未 markFullDelivered）consumePendingFull 返回完整 blocks + 选项', () => {
        const { sender } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1', model: 'm', parentToolUseId: 'p' })
        sender.startBlock(0, 'thinking')
        sender.append(0, 'think...')
        sender.startBlock(1, 'text')
        sender.append(1, 'answer')

        const pending = sender.consumePendingFull()
        expect(pending).not.toBeNull()
        expect(pending!.blocks).toEqual([
            { type: 'thinking', thinking: 'think...' },
            { type: 'text', text: 'answer' },
        ])
        expect(pending!.model).toBe('m')
        expect(pending!.parentToolUseId).toBe('p')
    })

    it('无累积内容时 consumePendingFull 返回 null', () => {
        const { sender } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        expect(sender.consumePendingFull()).toBeNull()
    })
})

describe('StreamSnapshotSender - delta 发送（首帧全量 + 此后增量）', () => {
    it('流首帧为全量帧（baseRev=null，携带完整内容），此后增量帧只带新增后缀', () => {
        const { sender, transport, convertSnapshot } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'text')
        sender.append(0, 'hel')
        sender.flush()

        // 首帧全量：走 converter 携带完整 blocks
        expect(convertSnapshot).toHaveBeenCalledTimes(1)
        const first = frameAt(transport, 0)
        expect(first.kind).toBe('full')
        expect(first.frame).toEqual({ localId: 'uuid-1', rev: 1, baseRev: null })

        sender.append(0, 'lo')
        sender.append(0, ' world')
        sender.flush()

        // 增量帧：只带后缀，不再走 converter
        expect(convertSnapshot).toHaveBeenCalledTimes(1)
        const second = frameAt(transport, 1)
        expect(second.kind).toBe('delta')
        expect(second.frame).toEqual({
            localId: 'uuid-1',
            rev: 2,
            baseRev: 1,
            deltas: [{ op: 'append', index: 0, text: 'lo world' }],
        })
    })

    it('新消息流重置 rev 与首帧全量（resume/下一条消息都从基线起步）', () => {
        const { sender, transport } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'text')
        sender.append(0, 'msg1')
        sender.flush() // full rev=1
        sender.append(0, '!')
        sender.flush() // delta rev=2

        sender.setSnapshotOpts({ sdkUuid: 'uuid-2' })
        sender.clearBuffers()
        sender.startBlock(0, 'text')
        sender.append(0, 'msg2')
        sender.flush()

        const third = frameAt(transport, 2)
        expect(third.kind).toBe('full')
        expect(third.frame).toEqual({ localId: 'uuid-2', rev: 1, baseRev: null })
    })

    it('首帧后新增块以 new-block 入链；tool_use ready 翻转以 replace-block 全块替换', () => {
        const { sender, transport } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'text')
        sender.append(0, 'hi')
        sender.flush() // full：含 text

        // 新 tool_use 块（startBlock 触发立即 flush）：new-block 占位
        sender.startBlock(1, 'tool_use', { id: 'toolu_1', name: 'Bash' })
        let out = frameAt(transport, 1)
        expect(out.kind).toBe('delta')
        expect(out.frame.deltas).toEqual([
            { op: 'new-block', index: 1, block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} } },
        ])

        // input 累积不产 op（半截 JSON 无意义）
        sender.append(1, '{"command":"ls"}')
        sender.flush()
        expect(transport).toHaveBeenCalledTimes(2)

        // content_block_stop：ready 翻转 → replace-block 完整 input
        sender.endBlock(1)
        out = frameAt(transport, 2)
        expect(out.kind).toBe('delta')
        expect(out.frame.deltas).toEqual([
            { op: 'replace-block', index: 1, block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } } },
        ])
    })

    it('thinking done 翻转以 replace-block 携带 durationMs/done', () => {
        const { sender, transport } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'thinking')
        sender.append(0, '思考')
        sender.flush() // full

        sender.endBlock(0) // done 翻转 + 立即 flush
        const out = frameAt(transport, 1)
        expect(out.kind).toBe('delta')
        expect(out.frame.deltas).toEqual([
            {
                op: 'replace-block',
                index: 0,
                block: { type: 'thinking', thinking: '思考', durationMs: expect.any(Number), done: true },
            },
        ])
    })

    it('forceFullFlush：重发全量帧重建基线（socket 重连重发）；无在途内容时 no-op', () => {
        const { sender, transport } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'text')
        sender.append(0, 'partial')
        sender.flush() // full rev=1
        sender.append(0, '!')
        sender.flush() // delta rev=2

        // 断线重连：重发全量（携带当前累积 partial!），rev 继续单调递增
        sender.forceFullFlush()
        const out = frameAt(transport, 2)
        expect(out.kind).toBe('full')
        expect(out.frame).toEqual({ localId: 'uuid-1', rev: 3, baseRev: null })

        // 重发后的后续增量正常衔接
        sender.append(0, '?')
        sender.flush()
        const after = frameAt(transport, 3)
        expect(after.kind).toBe('delta')
        expect(after.frame).toEqual({
            localId: 'uuid-1', rev: 4, baseRev: 3,
            deltas: [{ op: 'append', index: 0, text: '?' }],
        })

        // 无在途内容（流已清）时 forceFullFlush 不发帧
        sender.clearBuffers()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-9' })
        sender.forceFullFlush()
        expect(transport).toHaveBeenCalledTimes(4)
    })

    it('tool_use 在流首帧前 startBlock：首帧即全量且含占位', () => {
        const { sender, transport, convertSnapshot } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'tool_use', { id: 'toolu_1', name: 'Bash' })

        const first = frameAt(transport, 0)
        expect(first.kind).toBe('full')
        expect(convertSnapshot).toHaveBeenCalledWith(
            [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} }],
            expect.anything(),
        )
    })

    it('无脏内容时增量 flush 不发帧（空帧抑制）', () => {
        const { sender, transport } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'text')
        sender.append(0, 'a')
        sender.flush() // full
        sender.flush() // 无变化
        expect(transport).toHaveBeenCalledTimes(1)
    })
})

describe('StreamSnapshotSender - messageId 透传（snapshot↔full 关联键）', () => {
    it('setSnapshotOpts 的 messageId 透传到 convertSnapshot（首帧全量）', () => {
        const { sender, convertSnapshot } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1', messageId: 'msg_anthropic_abc' })
        sender.startBlock(0, 'thinking')
        sender.append(0, '思考')
        sender.flush()

        expect(convertSnapshot).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ messageId: 'msg_anthropic_abc' }),
        )
    })

    it('consumePendingFull 透传 messageId（abort 补全 full 也携带 message.id）', () => {
        const { sender } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1', messageId: 'msg_anthropic_abc' })
        sender.startBlock(0, 'text')
        sender.append(0, 'hi')

        const pending = sender.consumePendingFull()
        expect(pending).not.toBeNull()
        expect(pending!.messageId).toBe('msg_anthropic_abc')
    })
})

describe('StreamSnapshotSender - thinking 打点（snapshot 出口）', () => {
    it('thinking 未 endBlock（流式中）时全量帧的 thinking 不带 done', () => {
        const { sender, transport } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'thinking')
        sender.append(0, '仍在思考')
        sender.flush()

        const first = frameAt(transport, 0)
        expect(first.kind).toBe('full')
        const rawLog = first.message!.content.content.data as { blocks: unknown[] }
        expect(rawLog.blocks).toEqual([{ type: 'thinking', thinking: '仍在思考' }])
    })

    it('text block 不打 durationMs/done', () => {
        const { sender, transport } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'text')
        sender.append(0, '正文')
        sender.endBlock(0)
        sender.flush()

        const first = frameAt(transport, 0)
        expect(first.kind).toBe('full')
        const rawLog = first.message!.content.content.data as { blocks: unknown[] }
        expect(rawLog.blocks).toEqual([{ type: 'text', text: '正文' }])
    })
})

describe('StreamSnapshotSender - injectThinkingMeta（full 出口）', () => {
    it('把已 done 的 thinking durationMs/done 注入 full message 对应 thinking block', () => {
        const { sender } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
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
        const { sender } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
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
        const { sender } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
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
        const { sender } = createSender()
        const full = { message: { content: 'string-content' } } as unknown as SDKAssistantMessage
        expect(() => sender.injectThinkingMeta(full)).not.toThrow()
    })
})

describe('StreamSnapshotSender - tool_use 半截与 parse 兜底（abort 补全）', () => {
    it('未 stop 的 tool_use：流式占位 input={}，consumePendingFull 用累积 inputJson 兜底 parse', () => {
        const { sender } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'tool_use', { id: 'toolu_1', name: 'Bash' })
        sender.append(0, '{"command":"ls"}') // 累积完整 JSON 但未 content_block_stop

        // 流式出口：占位 input={}（半截 JSON 无意义）
        sender.flush()
        expect(sender.consumePendingFull()!.blocks).toEqual([
            { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } },
        ])
    })

    it('parse 失败的半截 JSON 兜底为 {}，保留「该工具被调用过」的记录', () => {
        const { sender } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'tool_use', { id: 'toolu_1', name: 'Write' })
        sender.append(0, '{"content":"半截') // JSON.parse 必败

        expect(sender.consumePendingFull()!.blocks).toEqual([
            { type: 'tool_use', id: 'toolu_1', name: 'Write', input: {} },
        ])
    })
})

describe('StreamSnapshotSender - 修复回归（code-review A3/A4/F9/F12）', () => {
    it('A3：full 已下发后 forceFullFlush 不重发陈旧全量（防 web 幽灵重复气泡）', () => {
        const { sender, transport } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'text')
        sender.append(0, 'done')
        sender.flush() // full rev=1
        sender.markFullDelivered()

        sender.forceFullFlush()
        expect(transport).toHaveBeenCalledTimes(1) // 不重发
    })

    it('A4：连续 CHECKPOINT_EVERY_DELTAS 个增量帧后，下一帧自动发全量（checkpoint 封顶断档窗口）', () => {
        const { sender, transport } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'text')
        sender.append(0, 'x')
        sender.flush() // full rev=1

        // 逐字符追加并 flush：每个字符一个增量帧
        for (let i = 0; i < 20; i++) {
            sender.append(0, 'y')
            sender.flush()
        }
        // 第 21 次脏 flush 应为 checkpoint 全量帧（而非增量）
        sender.append(0, 'z')
        sender.flush()

        const last = frameAt(transport, 21)
        expect(last.kind).toBe('full')
        expect(last.frame).toEqual({ localId: 'uuid-1', rev: 22, baseRev: null })
        // checkpoint 后计数复位：下一帧回到增量
        sender.append(0, 'w')
        sender.flush()
        const after = frameAt(transport, 22)
        expect(after.kind).toBe('delta')
        expect(after.frame.baseRev).toBe(22)
    })

    it('F9：流首帧未发且无脏内容时 flush 不发空块全量（needFull 保持置位）', () => {
        const { sender, transport } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'text') // text 的 startBlock 不标脏
        sender.flush()
        expect(transport).not.toHaveBeenCalled()

        // 有真实内容后首帧照常发出
        sender.append(0, 'hi')
        sender.flush()
        expect(frameAt(transport, 0).kind).toBe('full')
    })

    it('F12：setSnapshotOpts 缺 sdkUuid 时回退 PENDING_ID，不沿用上一条消息的 uuid（防消息互相吞并）', () => {
        const { sender, transport } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'text')
        sender.append(0, 'msg1')
        sender.flush()

        sender.setSnapshotOpts({}) // 无 sdkUuid
        sender.clearBuffers()
        sender.startBlock(0, 'text')
        sender.append(0, 'msg2')
        sender.flush()

        const second = frameAt(transport, 1)
        expect(second.kind).toBe('full')
        expect(second.frame.localId).toBe(SNAPSHOT_PENDING_ID)
    })
})
