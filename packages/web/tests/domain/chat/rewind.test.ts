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

import { describe, it, expect } from 'vitest'
import { canRewindMessage, collectChainHeadUserRowIds, rewindRejectReasonKey } from '@/domain/chat/rewind'

/** 判据入参的最小消息形状（结构化类型，与 DecryptedMessage.metadata 同构） */
const base = { localId: 'local-1', metadata: { nativeId: 'u1', nativeSessionId: 'ns-1', nativeAckAt: 1755500000000 } }
const idle = { running: false, backgroundTasks: 0 }

describe('canRewindMessage', () => {
    it('session 与消息 nativeSessionId 一致 → 可 rewind', () => {
        expect(canRewindMessage(base, 'ns-1', idle)).toBe(true)
    })

    it('不一致（/clear 前旧行）→ 不可', () => {
        expect(canRewindMessage(base, 'ns-2', idle)).toBe(false)
    })

    it('缺 nativeAckAt（CC 尚未回显接收，假锚点）→ 不可，即便 nativeId/nativeSessionId 齐全', () => {
        expect(canRewindMessage({ localId: 'l', metadata: { nativeId: 'u1', nativeSessionId: 'ns-1' } }, 'ns-1', idle)).toBe(false)
    })

    it('缺 nativeId（!bash 本地执行 / 绑定丢失）→ 不可', () => {
        expect(canRewindMessage({ localId: 'l', metadata: null }, 'ns-1', idle)).toBe(false)
        expect(canRewindMessage({ localId: 'l', metadata: {} }, 'ns-1', idle)).toBe(false)
        expect(canRewindMessage({ localId: 'l', metadata: { nativeSessionId: 'ns-1' } }, 'ns-1', idle)).toBe(false)
    })

    it('消息缺 nativeSessionId（新会话首批未 attach）→ 不可（保守）', () => {
        expect(canRewindMessage({ localId: 'l', metadata: { nativeId: 'u1' } }, 'ns-1', idle)).toBe(false)
    })

    it('running 或后台任务在途 → 不可（体验层置灰）', () => {
        expect(canRewindMessage(base, 'ns-1', { running: true, backgroundTasks: 0 })).toBe(false)
        expect(canRewindMessage(base, 'ns-1', { running: false, backgroundTasks: 2 })).toBe(false)
    })

    it('rewind 进行中（POST 在途 / 截断等待窗口）→ 不可——即便 idle 互斥并发第二次 rewind', () => {
        expect(canRewindMessage(base, 'ns-1', { running: false, backgroundTasks: 0, rewinding: true })).toBe(false)
        // 缺省（旧调用点）不改变行为
        expect(canRewindMessage(base, 'ns-1', { running: false, backgroundTasks: 0, rewinding: undefined })).toBe(true)
    })

    it('会话无 nativeSessionId（未知态）→ 保守不可', () => {
        expect(canRewindMessage(base, undefined, idle)).toBe(false)
        expect(canRewindMessage(base, null, idle)).toBe(false)
    })

    it('链首（isChainHead=true）→ 不可；undefined（窗口未到头不可判定）→ 不隐藏', () => {
        expect(canRewindMessage(base, 'ns-1', idle, true)).toBe(false)
        expect(canRewindMessage(base, 'ns-1', idle, false)).toBe(true)
        expect(canRewindMessage(base, 'ns-1', idle, undefined)).toBe(true)
    })
})

describe('collectChainHeadUserRowIds（链首用户行骨架）', () => {
    const u = (id: string, chain = 'ns-1') => ({ id, content: { role: 'user' }, metadata: { nativeSessionId: chain } })
    const a = (id: string, chain = 'ns-1') => ({ id, content: { role: 'agent' }, metadata: { nativeSessionId: chain } })

    it('链上首条用户行 = 链首；其前出现 assistant 后的用户行不是', () => {
        const heads = collectChainHeadUserRowIds([u('u1'), a('a1'), u('u2')])
        expect([...heads]).toEqual(['u1'])
    })

    it('1:N 合并批（批内无 assistant 分隔）→ 整批都是链首（锚点在批前，批前无 assistant 则整批不可退）', () => {
        const heads = collectChainHeadUserRowIds([u('u1'), u('u2'), a('a1'), u('u3')])
        expect([...heads]).toEqual(['u1', 'u2'])
    })

    it('/clear 换链（新 nativeSessionId）→ 新链首条用户行同样是链首', () => {
        const heads = collectChainHeadUserRowIds([u('u1'), a('a1'), u('u2'), u('u3', 'ns-2'), a('a2', 'ns-2')])
        expect([...heads]).toEqual(['u1', 'u3'])
    })

    it('assistant 行缺 nativeSessionId（attach 前）→ 无法归属链，后续用户行保守不算链首（宁可多显示入口）', () => {
        const orphanAssistant = { id: 'a0', content: { role: 'agent' }, metadata: null }
        const heads = collectChainHeadUserRowIds([orphanAssistant, u('u1')])
        expect([...heads]).toEqual([])
    })

    it('用户行缺 nativeSessionId → 跳过（canRewindMessage 锚点判据已排除）', () => {
        const noChain = { id: 'u0', content: { role: 'user' }, metadata: null }
        const heads = collectChainHeadUserRowIds([noChain, u('u1')])
        expect([...heads]).toEqual(['u1'])
    })
})

describe('rewindRejectReasonKey（dry-run 拒绝文案判别）', () => {
    it('链首 reason（含 first message）→ firstMessage 文案（带 /clear 引导）', () => {
        expect(rewindRejectReasonKey(
            'rewind anchor not found in transcript (cannot rewind the first message of a session — use /clear instead)',
        )).toBe('chat.rewind.firstMessage')
    })

    it('其余 reason / 缺省 → 笼统 unavailable', () => {
        expect(rewindRejectReasonKey('rewind anchor not found in transcript')).toBe('chat.rewind.unavailable')
        expect(rewindRejectReasonKey(undefined)).toBe('chat.rewind.unavailable')
    })
})
