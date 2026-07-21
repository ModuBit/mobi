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
