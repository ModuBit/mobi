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
import { StreamSnapshotSender } from '../../../src/claude/utils/streamSnapshotSender'
import type { RawJSONLines } from '../../../src/claude/types'
import type { SDKToLogConverter } from '../../../src/claude/utils/sdkToLogConverter'

function createSender() {
    const transport = vi.fn()
    const convertSnapshot = vi.fn((): RawJSONLines => ({} as RawJSONLines))
    const converter = { convertSnapshot } as unknown as SDKToLogConverter
    const sender = new StreamSnapshotSender(transport, converter)
    return { sender, transport, convertSnapshot }
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

describe('StreamSnapshotSender - tool_use 流式（让前端可见 tool running 中间态）', () => {
    it('content_block_stop 后 tool_use 下发完整 input，input 由 input_json_delta 拼成', () => {
        const { sender, convertSnapshot, transport } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1', messageId: 'msg_1' })
        sender.startBlock(0, 'tool_use', { id: 'toolu_1', name: 'Bash' })
        // startBlock 已立即下发占位（input={}），手动 flush 不重复触发新内容
        sender.append(0, '{"comm')
        sender.append(0, 'and":"ls"}')
        sender.flush()
        sender.endBlock(0) // content_block_stop：input 完整、ready，触发 flush
        expect(convertSnapshot).toHaveBeenCalledWith(
            expect.arrayContaining([{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]),
            expect.anything(),
        )
        expect(transport).toHaveBeenCalled()
    })

    it('ready 时 input JSON 解析失败兜底为 {}（保 running 可见，不丢 tool_use）', () => {
        const { sender, convertSnapshot } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1', messageId: 'msg_1' })
        sender.startBlock(0, 'tool_use', { id: 'toolu_2', name: 'Read' })
        sender.append(0, '{not-json')
        sender.endBlock(0)

        expect(convertSnapshot).toHaveBeenCalledWith(
            expect.arrayContaining([{ type: 'tool_use', id: 'toolu_2', name: 'Read', input: {} }]),
            expect.anything(),
        )
    })

    it('text 与 tool_use 混合：text 流式即下发，tool_use start 即占位、stop 后填充完整 input', () => {
        const { sender, convertSnapshot } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1', messageId: 'msg_1' })
        sender.startBlock(0, 'text')
        sender.append(0, 'thinking...')
        sender.startBlock(1, 'tool_use', { id: 'toolu_3', name: 'Grep' })
        sender.append(1, '{"pattern":"x"}')

        // start tool_use 立即触发 flush：snapshot 同时含 text 与 tool_use 占位（input={}）
        const placeholderCall = convertSnapshot.mock.calls.at(-1)![0] as unknown[]
        expect(placeholderCall).toEqual([
            { type: 'text', text: 'thinking...' },
            { type: 'tool_use', id: 'toolu_3', name: 'Grep', input: {} },
        ])

        sender.endBlock(1)
        const fullCall = convertSnapshot.mock.calls.at(-1)![0] as unknown[]
        expect(fullCall).toEqual([
            { type: 'text', text: 'thinking...' },
            { type: 'tool_use', id: 'toolu_3', name: 'Grep', input: { pattern: 'x' } },
        ])
    })

    it('abort 补全（consumePendingFull）保留半截 tool_use，不丢调用记录', () => {
        // abort 时 tool_use 可能仍在流式 input（未 content_block_stop）。consumePendingFull 用于落库
        // 补全，此时应保留该 tool_use（input 兜底），避免「该工具被调用过」整条丢失。
        const { sender } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1' })
        sender.startBlock(0, 'tool_use', { id: 'toolu_4', name: 'Bash' })
        sender.append(0, '{"command":"ls"') // 未闭合，未 endBlock（abort 发生在 content_block_stop 前）

        const pending = sender.consumePendingFull()
        expect(pending!.blocks).toEqual([
            { type: 'tool_use', id: 'toolu_4', name: 'Bash', input: {} }, // parse 失败兜底 {}
        ])
    })

    it('content_block_start 立即下发 input={} 占位（消除大 input 工具的生成盲区）', () => {
        const { sender, convertSnapshot, transport } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1', messageId: 'msg_1' })
        // content_block_start：tool_use 立即下发占位，input={}（parsedInput 初始值）
        sender.startBlock(0, 'tool_use', { id: 'toolu_placeholder', name: 'Write' })

        expect(convertSnapshot).toHaveBeenCalledTimes(1)
        expect(convertSnapshot).toHaveBeenCalledWith(
            [{ type: 'tool_use', id: 'toolu_placeholder', name: 'Write', input: {} }],
            expect.anything(),
        )
        expect(transport).toHaveBeenCalledTimes(1)
    })

    it('占位后 endBlock 下发完整 input（input 空→满就地更新）', () => {
        const { sender, convertSnapshot } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1', messageId: 'msg_1' })
        sender.startBlock(0, 'tool_use', { id: 'toolu_ph2', name: 'Write' })
        sender.append(0, '{"file_path":"/a.ts","content":"x"}')

        const placeholderCall = convertSnapshot.mock.calls.at(-1)![0] as unknown[]
        expect(placeholderCall).toEqual([{ type: 'tool_use', id: 'toolu_ph2', name: 'Write', input: {} }])

        sender.endBlock(0) // content_block_stop：input 完整，再下发一次
        const fullCall = convertSnapshot.mock.calls.at(-1)![0] as unknown[]
        expect(fullCall).toEqual([
            { type: 'tool_use', id: 'toolu_ph2', name: 'Write', input: { file_path: '/a.ts', content: 'x' } },
        ])
    })
})

describe('StreamSnapshotSender - messageId 透传（snapshot↔full 关联键）', () => {
    it('setSnapshotOpts 的 messageId 透传到 convertSnapshot（flush 发 snapshot 时）', () => {
        const { sender, convertSnapshot, transport } = createSender()
        sender.setSnapshotOpts({ sdkUuid: 'uuid-1', messageId: 'msg_anthropic_abc' })
        sender.startBlock(0, 'thinking')
        sender.append(0, '思考')
        sender.flush()

        expect(convertSnapshot).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ messageId: 'msg_anthropic_abc' }),
        )
        expect(transport).toHaveBeenCalled()
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
