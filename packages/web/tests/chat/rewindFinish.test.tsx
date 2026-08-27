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

import { describe, it, expect, beforeEach } from 'vitest'
import type { UserTextBlock, AgentEventBlock } from '@/domain/chat'
import { REWIND_COMMAND } from '@/domain/chat/presentation'
import { collectRewindBatchText } from '@/domain/chat/rewind'
import { buildChatBubbleItems } from '@/components/chat/buildBubbleItems'
import {
    _resetForTest,
    _internal,
    rewindFrom,
    getMessageWindowState,
} from '@/core/data/stores/messageWindowStore'
import { useRewindStore, ingestRewindSseEvent } from '@/core/data/stores/rewindStore'
import type { DecryptedMessage } from '@/core/data/api/types'

// ──────────────────────────────────────────────────────────────
// messageWindowStore.rewindFrom（窗口按范围清除）
// ──────────────────────────────────────────────────────────────

function row(id: string, seq: number | null): DecryptedMessage {
    return {
        id, seq, localId: null,
        content: { role: 'user', content: { type: 'text', text: `t-${id}` } },
        createdAt: 1000,
    } as DecryptedMessage
}

describe('messageWindowStore.rewindFrom', () => {
    beforeEach(() => {
        _resetForTest()
    })

    it('清除 seq >= deleteFromSeq 的行，保留之前的行与无 seq 行', () => {
        const sid = 'sess-r1'
        _internal.updateState(sid, prev => _internal.buildState(prev, {
            messages: [row('m1', 1), row('m2', 2), row('m3', 3), row('m4', 4), row('snap', null)],
            hasFetchedLatest: true,
        }))
        rewindFrom(sid, 3)
        const remaining = getMessageWindowState(sid).messages.map(m => m.id)
        expect(remaining).toEqual(['m1', 'm2', 'snap'])
    })

    it('幂等：重复清除同一锚点无变化（no-op 不 bump version）', () => {
        const sid = 'sess-r2'
        _internal.updateState(sid, prev => _internal.buildState(prev, {
            messages: [row('m1', 1), row('m2', 2), row('m3', 3)],
        }))
        rewindFrom(sid, 3)
        const v1 = getMessageWindowState(sid).messagesVersion
        rewindFrom(sid, 3)
        expect(getMessageWindowState(sid).messagesVersion).toBe(v1)
    })

    it('SSE rewound-truncated → ingest 即清窗（视图未挂载也保持窗口正确）', () => {
        const sid = 'sess-r3'
        useRewindStore.setState({ progressBySession: new Map(), completionBySession: new Map() })
        useRewindStore.getState().beginRewind(sid, 'u3')
        _internal.updateState(sid, prev => _internal.buildState(prev, {
            messages: [row('m1', 1), row('m2', 2), row('m3', 3)],
        }))
        const consumed = ingestRewindSseEvent({ type: 'rewound-truncated', sessionId: sid, deleteFromSeq: 2 })
        expect(consumed).toBe(true)
        expect(getMessageWindowState(sid).messages.map(m => m.id)).toEqual(['m1'])
        expect(useRewindStore.getState().progressBySession.get(sid)?.deleteFromSeq).toBe(2)
    })
})

// ──────────────────────────────────────────────────────────────
// buildBubbleItems（rewind 分隔线 + 起点标记跳过）
// ──────────────────────────────────────────────────────────────

function userTextBlock(text: string): UserTextBlock {
    return { kind: 'user-text', id: `u-${text}`, localId: null, createdAt: 1000, blocks: [{ type: 'text', text }] }
}

function eventBlock(type: string): AgentEventBlock {
    return { kind: 'agent-event', id: `e-${type}`, createdAt: 2000, event: { type } as AgentEventBlock['event'] }
}

const opts = { contextResetLabel: '上下文已重置', rewoundToHereLabel: '已回退至此' }

describe('buildChatBubbleItems rewind 渲染', () => {
    it('rewind-completed 事件 → 「已回退至此」分隔线（对齐 context-cleared 形态）', () => {
        const items = buildChatBubbleItems(
            [userTextBlock('hello'), eventBlock('rewind-completed')],
            { metadata: null, isThinking: false },
            false,
            opts,
        )
        const divider = items.find(it => it.role === 'divider')
        expect(divider).toBeTruthy()
        expect(JSON.stringify(divider?.content)).toContain('已回退至此')
    })

    it('REWIND_COMMAND 起点标记行 → 不渲染任何气泡', () => {
        const items = buildChatBubbleItems(
            [userTextBlock('hello'), userTextBlock(REWIND_COMMAND)],
            { metadata: null, isThinking: false },
            false,
            opts,
        )
        expect(items.length).toBe(1)
        expect(items[0]?.block?.kind).toBe('user-text')
    })
})

// ──────────────────────────────────────────────────────────────
// collectRewindBatchText（锚点批 N 条原文合并回填）
// ──────────────────────────────────────────────────────────────

describe('collectRewindBatchText', () => {
    it('合并批：同 nativeId 多行按 seq 升序 join(\\n)', () => {
        const rows = [
            { seq: 12, metadata: { nativeId: 'u1', nativeSessionId: 'ns' }, content: { content: { text: 'm2' } } },
            { seq: 10, metadata: { nativeId: 'u1', nativeSessionId: 'ns' }, content: { content: { text: 'm1' } } },
            { seq: 11, metadata: { nativeId: 'other' }, content: { content: { text: 'nope' } } },
            { seq: 9, metadata: null, content: { content: { text: 'no-native' } } },
        ]
        expect(collectRewindBatchText(rows, 'u1')).toBe('m1\nm2')
    })

    it('originalText 后备（快照/乐观形态）', () => {
        const rows = [{ seq: 1, metadata: { nativeId: 'u1' }, content: null, originalText: 'fallback' }]
        expect(collectRewindBatchText(rows, 'u1')).toBe('fallback')
    })

    it('无匹配行 / 全空文本 → null', () => {
        expect(collectRewindBatchText([{ seq: 1, metadata: { nativeId: 'x' }, content: {} }], 'u1')).toBeNull()
        expect(collectRewindBatchText([], 'u1')).toBeNull()
    })
})
