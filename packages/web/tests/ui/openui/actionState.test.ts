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
 * 档③终态扫描规格（generative-ui 票 04）：
 * - openui 发起（sentFrom + openuiAnchor）之后的 agent result 输出 → done；
 *   terminal_reason aborted_* → failed
 * - 档②消息（无 anchor）与手打消息不参与
 * - 窗口尾部 pending：会话 running → running；不 running → 不给条目（不误报）
 * - 刷新恢复语义：同一窗口数据重扫结果幂等
 */

import { describe, it, expect } from 'vitest'
import { deriveOpenUITerminalStates } from '@/components/ui/openui/actionState'
import type { DecryptedMessage } from '@/core/data/api/types'

const userMsg = (meta?: Record<string, unknown>): DecryptedMessage => ({
    id: `u-${Math.random()}`,
    seq: 1,
    localId: null,
    createdAt: 0,
    isSidechain: false,
    content: { role: 'user', content: [{ type: 'text', text: 'x' }], meta: meta ?? { sentFrom: 'webapp' } } as DecryptedMessage['content'],
})

const resultMsg = (data: Record<string, unknown>): DecryptedMessage => ({
    id: `a-${Math.random()}`,
    seq: 2,
    localId: null,
    createdAt: 1,
    isSidechain: false,
    content: { role: 'agent', content: { type: 'output', data } } as DecryptedMessage['content'],
})

const openuiAction = (anchor: string, lifecycle?: string) => ({
    ...userMsg({ sentFrom: 'openui', openuiAnchor: anchor }),
    ...(lifecycle ? { lifecycle: lifecycle as DecryptedMessage['lifecycle'] } : {}),
})

describe('deriveOpenUITerminalStates（档③终态扫描）', () => {
    it('发起后有 result 终态证据 → done', () => {
        const out = deriveOpenUITerminalStates([
            openuiAction('blk-1'),
            resultMsg({ stop_reason: 'end_turn', usage: { input_tokens: 10 } }),
        ], false)
        expect(out.get('blk-1')).toBe('done')
    })

    it('terminal_reason aborted_* → failed', () => {
        const out = deriveOpenUITerminalStates([
            openuiAction('blk-1'),
            resultMsg({ terminal_reason: 'aborted_streaming' }),
        ], false)
        expect(out.get('blk-1')).toBe('failed')
    })

    it('发起后无终态 + 会话 running → running；会话已停 → 不给条目（不误报）', () => {
        const msgs = [openuiAction('blk-1')]
        expect(deriveOpenUITerminalStates(msgs, true).get('blk-1')).toBe('running')
        expect(deriveOpenUITerminalStates(msgs, false).has('blk-1')).toBe(false)
    })

    it('档②（无 anchor）与手打消息不参与；中途 assistant 输出不算终态证据', () => {
        const out = deriveOpenUITerminalStates([
            userMsg(),
            userMsg({ sentFrom: 'openui' }),
            resultMsg({ type: 'text' }), // 中途 assistant 文本块（无 result 字段）不触发
            userMsg({ sentFrom: 'webapp' }),
        ], false)
        expect(out.size).toBe(0)
    })

    it('多条 action 各自归因（前一条未决时后一条开始，前一条保持既有判定）', () => {
        const out = deriveOpenUITerminalStates([
            openuiAction('blk-1'),
            resultMsg({ stop_reason: 'end_turn' }),
            openuiAction('blk-2'),
            resultMsg({ terminal_reason: 'aborted_tools' }),
        ], false)
        expect(out.get('blk-1')).toBe('done')
        expect(out.get('blk-2')).toBe('failed')
    })

    // queued 插队窗口：排队轨道（queued/pushed/acked = 未被 agent 消费）内出现的
    // result 属于上一个 turn，不能归因给这个锚点——否则点完按钮瞬间就被前 turn 的
    // 收尾 result 误翻 done。消费后（processing 及之后）的 result 才是本 turn 终态证据
    it('锚点消息仍在排队轨道（queued）→ 其后 result 是前 turn 的，不归因', () => {
        const msgs = [
            openuiAction('blk-1', 'queued'),
            resultMsg({ stop_reason: 'end_turn' }),
        ]
        // running 中保持 running（agent 即将消费它）；会话已停也不给终态条目
        expect(deriveOpenUITerminalStates(msgs, true).get('blk-1')).toBe('running')
        expect(deriveOpenUITerminalStates(msgs, false).has('blk-1')).toBe(false)
    })

    it('锚点消息已被消费（processing）→ 其后 result 归因为 done', () => {
        const out = deriveOpenUITerminalStates([
            openuiAction('blk-1', 'processing'),
            resultMsg({ stop_reason: 'end_turn' }),
        ], false)
        expect(out.get('blk-1')).toBe('done')
    })
})
