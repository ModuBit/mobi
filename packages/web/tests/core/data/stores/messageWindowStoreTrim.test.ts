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

import {
    isTurnStart,
    trimByTurnBoundary,
    TRIM_THRESHOLD,
    TRIM_TARGET,
    ingestIncomingMessages,
    getMessageWindowState,
    _resetForTest,
    _internal,
} from '@/core/data/stores/messageWindowStore'
import type { DecryptedMessage } from '@/core/data/api/types'

// ───────── fixture ─────────

/** user 信封（turn 起点） */
function userMsg(id: string, seq: number): DecryptedMessage {
    return { id, seq, snapshot: false, createdAt: seq, content: { role: 'user', content: { type: 'text', text: id } } } as unknown as DecryptedMessage
}

/** agent 信封（非 turn 起点，模拟 assistant/工具/sidechain 行） */
function agentMsg(id: string, seq: number): DecryptedMessage {
    return {
        id, seq, snapshot: false, createdAt: seq,
        content: { role: 'agent', content: { type: 'output', data: { type: 'assistant', message: { content: [] } } } },
    } as unknown as DecryptedMessage
}

/** 压缩边界（turn 起点） */
function compactMsg(id: string, seq: number): DecryptedMessage {
    return {
        id, seq, snapshot: false, createdAt: seq,
        content: { role: 'agent', content: { type: 'output', data: { type: 'system', subtype: 'compact_boundary', compact_metadata: {} } } },
    } as unknown as DecryptedMessage
}

/** context-cleared（turn 起点） */
function clearedMsg(id: string, seq: number): DecryptedMessage {
    return {
        id, seq, snapshot: false, createdAt: seq,
        content: { role: 'agent', content: { type: 'event', data: { type: 'context-cleared' } } },
    } as unknown as DecryptedMessage
}

/** 构造 n 个 turn，每个 turn = user 起点 + follow 行（agent） */
function buildTurns(turnCount: number, followPerTurn = 2): DecryptedMessage[] {
    const messages: DecryptedMessage[] = []
    let seq = 1
    for (let t = 0; t < turnCount; t++) {
        messages.push(userMsg(`u${t}`, seq++))
        for (let f = 0; f < followPerTurn; f++) messages.push(agentMsg(`a${t}-${f}`, seq++))
    }
    return messages
}

/** 用 _internal 直接播种窗口状态（绕过 api） */
function seedWindow(sessionId: string, messages: DecryptedMessage[], hasMore: boolean): void {
    _internal.updateState(sessionId, prev => _internal.buildState(prev, {
        messages, hasMore, oldestSeq: messages[0]?.seq ?? null,
    }))
}

describe('#40 C-1：isTurnStart 原始层 turn 起点判定', () => {
    it('user 信封 / compact_boundary / context-cleared 判为 turn 起点', () => {
        expect(isTurnStart(userMsg('u', 1).content)).toBe(true)
        expect(isTurnStart(compactMsg('c', 1).content)).toBe(true)
        expect(isTurnStart(clearedMsg('x', 1).content)).toBe(true)
    })

    it('agent output / 快照 / 垃圾形态不判为起点', () => {
        expect(isTurnStart(agentMsg('a', 1).content)).toBe(false)
        expect(isTurnStart(null)).toBe(false)
        expect(isTurnStart('raw')).toBe(false)
    })
})

describe('#40 C-1：trimByTurnBoundary 纯函数', () => {
    it('未超阈值 → 原引用返回', () => {
        const messages = buildTurns(10)
        expect(trimByTurnBoundary(messages)).toBe(messages)
    })

    it(`超阈值 → 裁到剩 ≤ ${TRIM_TARGET}，且切点必是 turn 起点（不断 sidechain 前缀）`, () => {
        const messages = buildTurns(Math.ceil((TRIM_THRESHOLD + 1) / 3), 2) // 每 turn 3 行
        expect(messages.length).toBeGreaterThan(TRIM_THRESHOLD)

        const trimmed = trimByTurnBoundary(messages)
        expect(trimmed.length).toBeLessThanOrEqual(TRIM_TARGET)
        expect(trimmed.length).toBeGreaterThan(0)
        // 切点在 turn 起点：首行必是 user 信封（不会把一个 turn 拦腰截断）
        expect(isTurnStart(trimmed[0].content)).toBe(true)
        // 只裁头不裁尾：尾部行与原数组一致
        expect(trimmed[trimmed.length - 1]).toBe(messages[messages.length - 1])
    })

    it('多种 turn 起点混合（compact/cleared）也能定位切点', () => {
        const messages = buildTurns(600, 2)
        messages.splice(5, 0, compactMsg('cp', 100))
        messages.splice(50, 0, clearedMsg('cc', 200))
        const trimmed = trimByTurnBoundary(messages)
        expect(trimmed.length).toBeLessThanOrEqual(TRIM_TARGET)
        expect(isTurnStart(trimmed[0].content)).toBe(true)
    })

    it('单个巨型 turn（无更早起点可用）→ 兜底保留最后一个整 turn', () => {
        // 前 1 个 turn + 巨型 turn（起点后跟 > TRIM_TARGET 行 agent）
        const messages: DecryptedMessage[] = [userMsg('u0', 1)]
        let seq = 2
        for (let i = 0; i <= TRIM_THRESHOLD; i++) messages.push(agentMsg(`a${i}`, seq++))
        const trimmed = trimByTurnBoundary(messages)
        // 唯一能切的起点是 u0（下标 0，切它=裁掉全部）→ 无处可裁，原样返回
        expect(trimmed).toBe(messages)
    })

    it('完全没有 turn 起点 → 不裁（避免裁出 orphan 开头）', () => {
        const messages: DecryptedMessage[] = []
        for (let i = 0; i <= TRIM_THRESHOLD; i++) messages.push(agentMsg(`a${i}`, i + 1))
        expect(trimByTurnBoundary(messages)).toBe(messages)
    })
})

describe('#40 C-1：store 集成（ingest 触发裁剪）', () => {
    const SID = 'trim-store-test'

    beforeEach(() => _resetForTest())

    it(`hasMore=true 且 ingest 后超阈值 → 裁剪 + oldestSeq 重算 + version 递增`, () => {
        const messages = buildTurns(Math.ceil(TRIM_THRESHOLD / 3), 2)
        seedWindow(SID, messages, true)
        const versionBefore = getMessageWindowState(SID).messagesVersion
        const seqBefore = getMessageWindowState(SID).oldestSeq

        ingestIncomingMessages(SID, [agentMsg('new-1', 99999)])

        const state = getMessageWindowState(SID)
        expect(state.messages.length).toBeLessThanOrEqual(TRIM_TARGET + 1)
        expect(isTurnStart(state.messages[0].content)).toBe(true)
        expect(state.oldestSeq).not.toBeNull()
        expect(state.oldestSeq).not.toBe(seqBefore)
        expect(state.messagesVersion).toBeGreaterThan(versionBefore)
    })

    it('hasMore=false（历史已穷尽）→ 不裁（裁了上滚拉不回）', () => {
        const messages = buildTurns(Math.ceil(TRIM_THRESHOLD / 3), 2)
        seedWindow(SID, messages, false)

        ingestIncomingMessages(SID, [agentMsg('new-1', 99999)])

        const state = getMessageWindowState(SID)
        expect(state.messages.length).toBe(messages.length + 1)
        expect(state.messages[0]).toBe(messages[0])
    })

    it('流式 append 日常路径：未超阈值零开销（原数组引用透传）', () => {
        const messages = buildTurns(10)
        seedWindow(SID, messages, true)
        const versionBefore = getMessageWindowState(SID).messagesVersion

        ingestIncomingMessages(SID, [agentMsg('new-1', 999)])

        const state = getMessageWindowState(SID)
        expect(state.messages.length).toBe(messages.length + 1)
        expect(state.messages[0]).toBe(messages[0])
        expect(state.messagesVersion).toBeGreaterThan(versionBefore)
    })
})
