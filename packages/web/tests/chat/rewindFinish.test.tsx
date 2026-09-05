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
import { collectRewindBatchText, mergeSegmentRows } from '@/domain/chat/rewind'
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

    it('SSE rewind-truncated → ingest 即清窗（视图未挂载也保持窗口正确）', () => {
        const sid = 'sess-r3'
        useRewindStore.setState({ progressBySession: new Map(), completionBySession: new Map() })
        useRewindStore.getState().beginRewind(sid, 'u3')
        _internal.updateState(sid, prev => _internal.buildState(prev, {
            messages: [row('m1', 1), row('m2', 2), row('m3', 3)],
        }))
        const consumed = ingestRewindSseEvent({ type: 'rewind-truncated', sessionId: sid, deleteFromSeq: 2 })
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

const opts = { contextResetLabel: '上下文已重置', rewoundToHereLabel: '已回退至此', rewindFailedLabel: '回退失败', skippedLinksLabel: '{{count}} 个路径被安全护栏跳过（symlink/链接）' }

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

    it('rewind-completed skippedLinks>0 → 分隔线显示跳过提示（spec E2）', () => {
        const items = buildChatBubbleItems(
            [userTextBlock('hello'), {
                ...eventBlock('rewind-completed'),
                event: { type: 'rewind-completed', filesRestored: true, skippedLinks: 3 } as AgentEventBlock['event'],
            }],
            { metadata: null, isThinking: false },
            false,
            { ...opts, skippedLinksLabel: '3 个路径被安全护栏跳过（symlink/链接）' },
        )
        const divider = items.find(it => it.role === 'divider')
        expect(divider).toBeTruthy()
        const html = JSON.stringify(divider?.content)
        expect(html).toContain('已回退至此')
        expect(html).toContain('3 个路径被安全护栏跳过')
    })

    it('rewind-completed 有 error → 显示「回退失败 · error」（F2: isFailed 基于 error 而非 filesRestored）', () => {
        const items = buildChatBubbleItems(
            [userTextBlock('hello'), {
                ...eventBlock('rewind-completed'),
                event: { type: 'rewind-completed', filesRestored: false, error: 'rewind rejected: refused' } as AgentEventBlock['event'],
            }],
            { metadata: null, isThinking: false },
            false,
            opts,
        )
        const divider = items.find(it => it.role === 'divider')
        expect(divider).toBeTruthy()
        const html = JSON.stringify(divider?.content)
        expect(html).toContain('回退失败')
        expect(html).toContain('rewind rejected: refused')
        expect(html).not.toContain('已回退至此')
    })

    it('rewind-completed filesRestored=true + error → 显示「回退失败 · error」+ skippedLinks（文件回滚成功但截断失败中间态）', () => {
        const items = buildChatBubbleItems(
            [userTextBlock('hello'), {
                ...eventBlock('rewind-completed'),
                event: { type: 'rewind-completed', filesRestored: true, error: 'rewind rejected: refused', skippedLinks: 2 } as AgentEventBlock['event'],
            }],
            { metadata: null, isThinking: false },
            false,
            { ...opts, skippedLinksLabel: '2 个路径被安全护栏跳过（symlink/链接）' },
        )
        const divider = items.find(it => it.role === 'divider')
        expect(divider).toBeTruthy()
        const html = JSON.stringify(divider?.content)
        // 有 error → 失败文案
        expect(html).toContain('回退失败')
        expect(html).toContain('rewind rejected: refused')
        // filesRestored=true + skippedLinks>0 → 仍显跳过提示
        expect(html).toContain('2 个路径被安全护栏跳过')
    })

    it('rewind-completed filesRestored=false 但无 error → 显示「已回退至此」（F2: 无 error 即非失败）', () => {
        const items = buildChatBubbleItems(
            [userTextBlock('hello'), {
                ...eventBlock('rewind-completed'),
                event: { type: 'rewind-completed', filesRestored: false } as AgentEventBlock['event'],
            }],
            { metadata: null, isThinking: false },
            false,
            opts,
        )
        const divider = items.find(it => it.role === 'divider')
        expect(divider).toBeTruthy()
        const html = JSON.stringify(divider?.content)
        // 无 error → 成功文案（filesRestored=false 不再等同于失败）
        expect(html).toContain('已回退至此')
        expect(html).not.toContain('回退失败')
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
        // wire 内层 content 为 {type:'text',text} 平铺（webapp 发送/落库形态），normalize 走单 block 通道
        const rows = [
            { seq: 12, metadata: { nativeId: 'u1', nativeSessionId: 'ns' }, content: { role: 'user', content: { type: 'text', text: 'm2' } } },
            { seq: 10, metadata: { nativeId: 'u1', nativeSessionId: 'ns' }, content: { role: 'user', content: { type: 'text', text: 'm1' } } },
            { seq: 11, metadata: { nativeId: 'other' }, content: { role: 'user', content: { type: 'text', text: 'nope' } } },
            { seq: 9, metadata: null, content: { role: 'user', content: { type: 'text', text: 'no-native' } } },
        ]
        expect(collectRewindBatchText(rows, 'u1')).toBe('m1\nm2')
    })

    it('originalText 后备（快照/乐观形态）', () => {
        const rows = [{ seq: 1, metadata: { nativeId: 'u1' }, content: null, originalText: 'fallback' }]
        expect(collectRewindBatchText(rows, 'u1')).toBe('fallback')
    })

    it('block 数组行：text 连接、非 text block（附件）不混入回填正文', () => {
        const rows = [{
            seq: 1,
            metadata: { nativeId: 'u1' },
            content: {
                role: 'user',
                content: [
                    { type: 'text', text: '看这个' },
                    { type: 'document', source: { type: 'url', value: '/a.pdf' }, id: 'd', filename: 'a.pdf', size: 1 },
                ],
            },
        }]
        expect(collectRewindBatchText(rows, 'u1')).toBe('看这个')
    })

    it('无匹配行 / 全空文本 → null', () => {
        expect(collectRewindBatchText([{ seq: 1, metadata: { nativeId: 'x' }, content: {} }], 'u1')).toBeNull()
        expect(collectRewindBatchText([], 'u1')).toBeNull()
    })
})

// ──────────────────────────────────────────────────────────────
// mergeSegmentRows（锚点批结构化还原为 ComposerSegments）
// ──────────────────────────────────────────────────────────────

describe('mergeSegmentRows', () => {
    const row = (seq: number, text: string, nativeId = 'u1', extra: unknown[] = []) => ({
        seq,
        metadata: { nativeId },
        content: { role: 'user', content: [{ type: 'text', text }, ...extra] },
    })

    it('单行纯文本批：无合并语义，即普通 deserialize', () => {
        expect(mergeSegmentRows([row(1, 'hello')], 'u1'))
            .toEqual({ text: 'hello', files: [], images: [], quotes: [] })
    })

    it('多行同 nativeId：正文按 seq 升序 join(\\n)，其余行排除', () => {
        const rows = [
            { seq: 12, metadata: { nativeId: 'u1' }, content: { role: 'user', content: { type: 'text', text: 'm2' } } },
            { seq: 10, metadata: { nativeId: 'u1' }, content: { role: 'user', content: { type: 'text', text: 'm1' } } },
            { seq: 11, metadata: { nativeId: 'other' }, content: { role: 'user', content: { type: 'text', text: 'nope' } } },
        ]
        expect(mergeSegmentRows(rows, 'u1')!.text).toBe('m1\nm2')
    })

    it('非 text 结构以首行为模板（避免多行携带同附件时重复堆叠）', () => {
        const docBlock = {
            type: 'document',
            source: { type: 'url', value: '/a.pdf', mimeType: 'application/pdf' },
            id: 'd1', filename: 'a.pdf', size: 1,
        }
        const rows = [
            row(2, '第二行', 'u1'),
            row(1, '第一行', 'u1', [docBlock, { type: 'quote', messageId: 'm9', role: 'agent', excerpt: 'q' }]),
        ]
        const merged = mergeSegmentRows(rows, 'u1')!
        expect(merged.text).toBe('第一行\n第二行')
        // 结构来自首行（seq=1）：files 有、quotes 有
        expect(merged.files).toEqual([{
            id: 'd1', filename: 'a.pdf', path: '/a.pdf', mimeType: 'application/pdf', size: 1,
        }])
        expect(merged.quotes).toEqual([{ messageId: 'm9', role: 'agent', excerpt: 'q' }])
        expect(merged.images).toEqual([])
        // 第二行的结构不并入（首行模板语义）
    })

    it('originalText 后备（快照/乐观形态）；无匹配行 → null', () => {
        const rows = [
            { seq: 1, metadata: { nativeId: 'u1' }, content: null, originalText: 'fallback' },
            { seq: 2, metadata: null, content: { role: 'user', content: { type: 'text', text: 'no-native' } } },
        ]
        expect(mergeSegmentRows(rows, 'u1')).toEqual({
            text: 'fallback', files: [], images: [], quotes: [],
        })
        expect(mergeSegmentRows([], 'u1')).toBeNull()
        expect(mergeSegmentRows([{ seq: 1, metadata: { nativeId: 'x' }, content: {} }], 'u1')).toBeNull()
    })
})
