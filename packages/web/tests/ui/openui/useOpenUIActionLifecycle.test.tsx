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
 * useOpenUIActionLifecycle 接线锁（架构评审候选 5）：消息窗口 + 运行态 → 终态扫描
 * → store 推进。断言外部行为（锚点 phase 何时被推进），不锁扫描算法本身（那是
 * actionState.test 的职责）。
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useOpenUIActionLifecycle } from '@/ui/openui/useOpenUIActionLifecycle'
import { useOpenUIActionStore } from '@/ui/openui/actionStore'
import type { DecryptedMessage } from '@/core/data/api/types'

/** 携锚点的 openui 回灌用户消息（meta.openuiAnchor） */
function anchoredMessage(anchor: string): DecryptedMessage {
    return {
        id: `m-${anchor}`,
        seq: 1,
        localId: `m-${anchor}`,
        lifecycleAt: null,
        lifecycle: null,
        positionAt: 1,
        content: { role: 'user', content: [{ type: 'text', text: '执行' }], meta: { sentFrom: 'openui', openuiAnchor: anchor } },
        createdAt: 1,
        status: 'sent',
    } as unknown as DecryptedMessage
}

/** agent result 终态消息（stop_reason 证据） */
function resultMessage(stopReason: string): DecryptedMessage {
    return {
        id: `r-${stopReason}`,
        seq: 2,
        localId: `r-${stopReason}`,
        lifecycleAt: null,
        lifecycle: null,
        positionAt: 2,
        content: { role: 'agent', content: { type: 'output', data: { type: 'result', subtype: stopReason, usage: {} } } },
        createdAt: 2,
        status: 'sent',
    } as unknown as DecryptedMessage
}

describe('useOpenUIActionLifecycle（档③终态推进接线）', () => {
    beforeEach(() => {
        useOpenUIActionStore.getState().clearAll()
    })

    it('窗口含锚点发起 + result 终态 → store 推进 done', () => {
        renderHook(() => useOpenUIActionLifecycle([anchoredMessage('a1'), resultMessage('end_turn')], false))
        expect(useOpenUIActionStore.getState().phases.get('a1')).toBe('done')
    })

    it('窗口尾部未决（有发起无终态）且会话 running → running', () => {
        renderHook(() => useOpenUIActionLifecycle([anchoredMessage('a2')], true))
        expect(useOpenUIActionStore.getState().phases.get('a2')).toBe('running')
    })

    it('窗口无锚点消息 → store 零推进', () => {
        renderHook(() => useOpenUIActionLifecycle([resultMessage('end_turn')], false))
        expect(useOpenUIActionStore.getState().phases.size).toBe(0)
    })

    it('卸载清空 store（ChatContainer key 重建/离场时跨会话残留归零）', () => {
        const { unmount } = renderHook(() => useOpenUIActionLifecycle([anchoredMessage('a3')], true))
        expect(useOpenUIActionStore.getState().phases.get('a3')).toBe('running')
        unmount()
        expect(useOpenUIActionStore.getState().phases.size).toBe(0)
    })

    it('同签名（窗口概要不变）跳过重扫——流式 delta 不覆盖本地即时翻转', () => {
        const { rerender } = renderHook(
            ({ messages }: { messages: DecryptedMessage[] }) => useOpenUIActionLifecycle(messages, false),
            { initialProps: { messages: [anchoredMessage('a4'), resultMessage('end_turn')] } },
        )
        expect(useOpenUIActionStore.getState().phases.get('a4')).toBe('done')
        // 用户重新点击（即时翻 running），随后流式 delta 推送同 id 新数组——签名
        // （length + tail id + running）不变，重扫若执行会把 running 覆盖回 done
        useOpenUIActionStore.getState().setPhase('a4', 'running')
        rerender({ messages: [anchoredMessage('a4'), { ...resultMessage('end_turn') }] })
        expect(useOpenUIActionStore.getState().phases.get('a4')).toBe('running')
    })
})
