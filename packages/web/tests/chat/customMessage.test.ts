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
 * 自定义消息管线测试（ADR 0002 / ADR 0003 mobi URI 动作协议）：
 * normalize（role==='custom' 分流）→ reducerTimeline（CustomBlock 进时间线）→ buildBubbleItems（system 气泡）。
 * 覆盖：动作链接文本、unknown block / 历史 ref block 剔除（ref 已由动作链接文本取代）、
 * 全不可识别整条跳过、seq 置顶（自然保序）。
 */

import { describe, expect, it, vi } from 'vitest'
import { normalizeDecryptedMessage } from '@/domain/chat/normalize'
import { reduceChatBlocks } from '@/domain/chat/reducer'
import { buildChatBubbleItems } from '@/components/chat/buildBubbleItems'
import type { DecryptedMessage } from '@/core/data/api/types'
import type { CustomBlock } from '@/domain/chat/types'

vi.mock('@/core/lib/diag', () => ({
    initDiag: vi.fn(),
    recordSnapshot: vi.fn(),
}))

function makeCustomMessage(content: unknown, overrides: Partial<DecryptedMessage> = {}): DecryptedMessage {
    return {
        id: 'custom-msg-1',
        seq: 1,
        localId: null,
        createdAt: 1000,
        content: { role: 'custom', content },
        ...overrides,
    }
}

describe('normalize custom 分支', () => {
    it('动作链接文本（溯源消息形态）归一为 custom 消息', () => {
        const content = [
            { type: 'text', text: 'fork 自会话 ' },
            { type: 'text', text: '[父会话](mobi://session/open?id=parent-1)' },
        ]
        const result = normalizeDecryptedMessage(makeCustomMessage(content))
        expect(result).not.toBeNull()
        expect(result!.role).toBe('custom')
        expect(result!.content).toEqual(content)
    })

    it('裸 string content 应收敛为单 text block', () => {
        const result = normalizeDecryptedMessage(makeCustomMessage('纯文本溯源'))
        expect(result!.role).toBe('custom')
        expect(result!.content).toEqual([{ type: 'text', text: '纯文本溯源' }])
    })

    it('unknown block 与历史 ref block 应剔除，合法 block 保留', () => {
        const message = makeCustomMessage([
            { type: 'text', text: '前段' },
            { type: 'mystery', payload: 1 },
            { type: 'ref', targetType: 'file', id: 'f-1' },
            { type: 'text', text: '后段' },
        ])

        const result = normalizeDecryptedMessage(message)
        expect(result!.role).toBe('custom')
        expect(result!.content).toEqual([{ type: 'text', text: '前段' }, { type: 'text', text: '后段' }])
    })

    it('全部 block 不可识别时应返回 null（整条消息不渲染）', () => {
        const result = normalizeDecryptedMessage(makeCustomMessage({ type: 'mystery' }))
        expect(result).toBeNull()
    })
})

describe('custom 消息接入时间线', () => {
    it('应产生 CustomBlock 并保持在消息序位置（溯源消息 seq 1 → 置顶时间线）', () => {
        // seq 1 的溯源消息在最前，其后是常规 agent 消息——归约保序，置顶自然实现
        const provenanceContent = [
            { type: 'text', text: 'fork 自会话 ' },
            { type: 'text', text: '[父会话](mobi://session/open?id=parent-1)' },
        ]
        const provenance = normalizeDecryptedMessage(makeCustomMessage(provenanceContent))!
        const agent = normalizeDecryptedMessage({
            id: 'agent-1',
            seq: 2,
            localId: null,
            createdAt: 2000,
            content: {
                role: 'agent',
                content: { type: 'output', data: { type: 'assistant', message: { content: '回复' } } },
            },
        })!

        const { blocks } = reduceChatBlocks([provenance, agent], null)
        expect(blocks[0]?.kind).toBe('custom')
        const custom = blocks[0] as CustomBlock
        expect(custom.blocks).toEqual(provenanceContent)
        expect(blocks.some(b => b.kind === 'agent-text')).toBe(true)
    })

    it('buildBubbleItems：custom 块渲染为无边框系统行', () => {
        const custom: CustomBlock = {
            kind: 'custom',
            id: 'custom-1',
            localId: null,
            createdAt: 1000,
            blocks: [{ type: 'text', text: 'fork 自会话 ' }],
        }

        const items = buildChatBubbleItems([custom], { metadata: null, isThinking: false }, false, {
            contextResetLabel: 'x', rewoundToHereLabel: 'x', rewindFailedLabel: 'x', skippedLinksLabel: 'x',
        })

        expect(items).toHaveLength(1)
        expect(items[0]).toMatchObject({ key: 'custom-1', role: 'system', variant: 'borderless' })
    })
})
