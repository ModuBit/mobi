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
import { deriveOpenUITerminalStates } from '@/ui/openui/actionState'
import type { DecryptedMessage } from '@/core/data/api/types'

const userMsg = (meta?: Record<string, unknown>): DecryptedMessage => ({
    id: `u-${Math.random()}`,
    seq: 1,
    localId: null,
    createdAt: 0,
    isSidechain: false,
    content: { role: 'user', content: [{ type: 'text', text: 'x' }], meta: meta ?? { sentFrom: 'webapp' } } as DecryptedMessage['content'],
})

/** agent result 行：data.type='result' 是 shared isTurnResultUnwrapped 的终点判据
 *  （显式传 type 可构造非 result 的中途输出） */
const resultMsg = (data: Record<string, unknown> = {}): DecryptedMessage => ({
    id: `a-${Math.random()}`,
    seq: 2,
    localId: null,
    createdAt: 1,
    isSidechain: false,
    content: { role: 'agent', content: { type: 'output', data: { type: 'result', ...data } } } as DecryptedMessage['content'],
})

const openuiAction = (anchor: string, lifecycle?: string, formState?: Record<string, unknown>, stateVar?: string) => ({
    ...userMsg({
        sentFrom: 'openui',
        openuiAnchor: anchor,
        ...(formState ? { openuiFormState: formState } : {}),
        ...(stateVar ? { openuiStateVar: stateVar } : {}),
    }),
    ...(lifecycle ? { lifecycle: lifecycle as DecryptedMessage['lifecycle'] } : {}),
})

describe('deriveOpenUITerminalStates（档③终态扫描）', () => {
    it('发起后有 result 终态证据 → done', () => {
        const out = deriveOpenUITerminalStates([
            openuiAction('blk-1'),
            resultMsg({ stop_reason: 'end_turn', usage: { input_tokens: 10 } }),
        ], false)
        expect(out.get('blk-1')?.phase).toBe('done')
    })

    it('meta 携带 openuiFormState → 派生条目携带快照（票 02）', () => {
        const snap = { 'todo-panel': { task1: true } }
        const msgs = [
            openuiAction('blk-9', undefined, snap),
            resultMsg({ stop_reason: 'end_turn', usage: { input_tokens: 1 } }),
        ]
        const out = deriveOpenUITerminalStates(msgs, false)
        expect(out.get('blk-9')).toEqual({ phase: 'done', formState: snap })
    })

    it('per-action：meta 带 openuiStateVar → 派生键为复合键 anchor#var（票 02）', () => {
        const msgs = [
            openuiAction('blk-1', undefined, undefined, '$mdState'),
            resultMsg({ stop_reason: 'end_turn', usage: { input_tokens: 1 } }),
        ]
        const out = deriveOpenUITerminalStates(msgs, false)
        expect(out.get('blk-1#$mdState')).toEqual({ phase: 'done' })
        expect(out.has('blk-1')).toBe(false)
    })

    it('per-action：双操作先后发起各自配对，互不覆盖（票 02）', () => {
        const msgs = [
            openuiAction('blk-1', undefined, undefined, '$mdState'),
            resultMsg({ stop_reason: 'end_turn', usage: { input_tokens: 1 } }),
            openuiAction('blk-1', undefined, undefined, '$jsonState'),
            resultMsg({ stop_reason: 'end_turn', usage: { input_tokens: 2 } }),
        ]
        const out = deriveOpenUITerminalStates(msgs, false)
        expect(out.get('blk-1#$mdState')?.phase).toBe('done')
        expect(out.get('blk-1#$jsonState')?.phase).toBe('done')
    })

    it('无快照条目不带 formState 键（与旧形状一致）', () => {
        const out = deriveOpenUITerminalStates([
            openuiAction('blk-10'),
            resultMsg({ stop_reason: 'end_turn', usage: { input_tokens: 1 } }),
        ], false)
        expect(out.get('blk-10')).toEqual({ phase: 'done' })
    })

    it('fence 级三段锚点（block.id:line）与旧 block 级锚点同为 opaque 字符串各自归因', () => {
        const out = deriveOpenUITerminalStates([
            openuiAction('msg-1:1:0'),
            resultMsg({ stop_reason: 'end_turn', usage: { input_tokens: 1 } }),
            openuiAction('msg-1:1:1'),
            resultMsg({ stop_reason: 'end_turn', usage: { input_tokens: 1 } }),
        ], false)
        expect(out.get('msg-1:1:0')?.phase).toBe('done')
        expect(out.get('msg-1:1:1')?.phase).toBe('done')
    })

    it('terminal_reason aborted_* → failed', () => {
        const out = deriveOpenUITerminalStates([
            openuiAction('blk-1'),
            resultMsg({ terminal_reason: 'aborted_streaming' }),
        ], false)
        expect(out.get('blk-1')?.phase).toBe('failed')
    })

    it('发起后无终态 + 会话 running → running；会话已停 → 不给条目（不误报）', () => {
        const msgs = [openuiAction('blk-1')]
        expect(deriveOpenUITerminalStates(msgs, true).get('blk-1')?.phase).toBe('running')
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
        expect(out.get('blk-1')?.phase).toBe('done')
        expect(out.get('blk-2')?.phase).toBe('failed')
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
        expect(deriveOpenUITerminalStates(msgs, true).get('blk-1')?.phase).toBe('running')
        expect(deriveOpenUITerminalStates(msgs, false).has('blk-1')).toBe(false)
    })

    it('锚点消息已被消费（processing）→ 其后 result 归因为 done', () => {
        const out = deriveOpenUITerminalStates([
            openuiAction('blk-1', 'processing'),
            resultMsg({ stop_reason: 'end_turn' }),
        ], false)
        expect(out.get('blk-1')?.phase).toBe('done')
    })

    // 并发点击实锤（per-action E2E 2026-10-11）：交叠 turn 的两条锚点背靠背落库，
    // 单 pending 槽位被后者覆盖 → 前者的 result 错配给后者、前者终态丢失恒卡 running
    it('交叠双操作：两锚点背靠背发起，result 按序各自归因不互相覆盖', () => {
        const msgs = [
            openuiAction('blk-1', 'processing', undefined, '$mdState'),
            openuiAction('blk-1', 'processing', undefined, '$jsonState'),
            resultMsg({ stop_reason: 'end_turn', usage: { input_tokens: 1 } }),
            resultMsg({ stop_reason: 'end_turn', usage: { input_tokens: 2 } }),
        ]
        const out = deriveOpenUITerminalStates(msgs, false)
        expect(out.get('blk-1#$mdState')?.phase).toBe('done')
        expect(out.get('blk-1#$jsonState')?.phase).toBe('done')
    })

    it('交叠且队首未消费：result 不归因给任何锚点（插队窗口保护不因交叠失效）', () => {
        const msgs = [
            openuiAction('blk-1', 'queued', undefined, '$mdState'),
            openuiAction('blk-1', 'processing', undefined, '$jsonState'),
            resultMsg({ stop_reason: 'end_turn', usage: { input_tokens: 1 } }),
        ]
        const out = deriveOpenUITerminalStates(msgs, true)
        // result 属于更早的 turn，两个锚点都不消费它；尾部双双归 running
        expect(out.get('blk-1#$mdState')?.phase).toBe('running')
        expect(out.get('blk-1#$jsonState')?.phase).toBe('running')
    })

    // 扫描时刻消费盲区（code-review 2026-10-11）：turn 进行中点击 → 锚点 consumed
    // 翻转不触发重扫 → 重扫时队首闸门已放行，锚点会与滞留窗口的上一 turn result
    // 错配。顺序 turn 保证孤儿 result 必在合法 result 之前——按
    // 「孤儿数 = result 数 − 已消费锚点数」剥离后再配对
    it('孤儿剥离：turn 中点击的锚点只与自己的 result 配对，不吃上一 turn 的陈旧 result', () => {
        const msgs = [
            openuiAction('blk-1', 'processing'),
            resultMsg({ terminal_reason: 'aborted_streaming' }), // 上一 turn 的收尾（若误配则误显失败）
            resultMsg({ stop_reason: 'end_turn' }), // 本 turn 的真终态
        ]
        const out = deriveOpenUITerminalStates(msgs, false)
        expect(out.get('blk-1')?.phase).toBe('done')
    })

    it('孤儿剥离 + 交叠：先到的前 turn result 不参与，两锚点按序配对自己的 result', () => {
        const msgs = [
            openuiAction('blk-1', 'processing', undefined, '$mdState'),
            openuiAction('blk-1', 'processing', undefined, '$jsonState'),
            resultMsg({ terminal_reason: 'aborted_streaming' }), // 交叠点击前那个 turn 的收尾
            resultMsg({ stop_reason: 'end_turn' }),
            resultMsg({ stop_reason: 'end_turn' }),
        ]
        const out = deriveOpenUITerminalStates(msgs, false)
        expect(out.get('blk-1#$mdState')?.phase).toBe('done')
        expect(out.get('blk-1#$jsonState')?.phase).toBe('done')
    })

    it('孤儿剥离在部分消费时也生效：queued 队首挡住配对，已消费的后任不吃孤儿 result', () => {
        const msgs = [
            openuiAction('blk-1', 'queued', undefined, '$mdState'),
            openuiAction('blk-1', 'processing', undefined, '$jsonState'),
            resultMsg({ stop_reason: 'end_turn' }), // 更早 turn 的收尾
        ]
        const out = deriveOpenUITerminalStates(msgs, true)
        expect(out.get('blk-1#$mdState')?.phase).toBe('running')
        expect(out.get('blk-1#$jsonState')?.phase).toBe('running')
    })

    it('usage:null（typeof null === "object"）不再被字段启发式误判为终态证据', () => {
        const out = deriveOpenUITerminalStates([
            openuiAction('blk-1'),
            resultMsg({ type: 'text', usage: null }), // 中途输出行，非 result
        ], false)
        expect(out.has('blk-1')).toBe(false)
    })
})
