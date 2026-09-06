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
import {
    canForkMessage,
    collectForkTargetBlockIds,
    forkRejectReasonKey,
    extractForkRejectCode,
    agentBlockMessageKey,
} from '@/domain/chat/fork'
import { REWIND_COMMAND } from '@/domain/chat/presentation'
import type { ChatBlock } from '@/domain/chat/types'

/** 判据入参的最小消息形状（与 DecryptedMessage.metadata 同构） */
const base = { metadata: { nativeId: 'a1', nativeSessionId: 'ns-1' }, seq: 5 }
const idle: Parameters<typeof canForkMessage>[2] = { running: false, backgroundTasks: 0, mode: 'remote' }

describe('canForkMessage', () => {
    it('remote + idle + 锚点齐全 + 同链 + 边界之后 → 可 fork', () => {
        expect(canForkMessage(base, 'ns-1', idle)).toBe(true)
    })

    it('仅 remote 会话可 fork：local / mode 缺失 → 不可（fork-session spec 模式范围）', () => {
        expect(canForkMessage(base, 'ns-1', { ...idle, mode: 'local' })).toBe(false)
        expect(canForkMessage(base, 'ns-1', { ...idle, mode: undefined })).toBe(false)
    })

    it('running 或后台任务在途 → 不可', () => {
        expect(canForkMessage(base, 'ns-1', { ...idle, running: true })).toBe(false)
        expect(canForkMessage(base, 'ns-1', { ...idle, backgroundTasks: 2 })).toBe(false)
    })

    it('分叉会话（forkedFrom 溯源存在）→ 不可再 fork（spec §2 fork 的 fork 禁止）', () => {
        expect(canForkMessage(base, 'ns-1', { ...idle, forkedFrom: { sessionId: 'p1' } })).toBe(false)
    })

    it('待激活态（forkFrom 簿记存在）→ 隐藏入口（spec §2）', () => {
        expect(canForkMessage(base, 'ns-1', { ...idle, forkFrom: { parentSessionId: 'p1', parentNativeId: 'pn', anchorNativeId: 'an' } })).toBe(false)
    })

    it('消息无 native 锚点（nativeId / nativeSessionId 缺失）→ 不可', () => {
        expect(canForkMessage({ metadata: null, seq: 5 }, 'ns-1', idle)).toBe(false)
        expect(canForkMessage({ metadata: { nativeSessionId: 'ns-1' }, seq: 5 }, 'ns-1', idle)).toBe(false)
        expect(canForkMessage({ metadata: { nativeId: 'a1' }, seq: 5 }, 'ns-1', idle)).toBe(false)
    })

    it('会话侧 nativeSessionId 未知 → 保守不可', () => {
        expect(canForkMessage(base, undefined, idle)).toBe(false)
        expect(canForkMessage(base, null, idle)).toBe(false)
    })

    it('链判据：消息 nativeSessionId ≠ 会话当前值（/clear 前旧行）→ 不可', () => {
        expect(canForkMessage(base, 'ns-2', idle)).toBe(false)
    })

    it('边界判据：seq ≤ contextBoundarySeq（compact/clear 之前）→ 不可，> 边界 → 可', () => {
        expect(canForkMessage(base, 'ns-1', { ...idle, contextBoundarySeq: 10 })).toBe(false)
        expect(canForkMessage(base, 'ns-1', { ...idle, contextBoundarySeq: 5 })).toBe(false)
        expect(canForkMessage(base, 'ns-1', { ...idle, contextBoundarySeq: 4 })).toBe(true)
    })

    it('contextBoundarySeq 缺失（存量会话未回填）→ 按 0 处理保守放行', () => {
        expect(canForkMessage(base, 'ns-1', idle)).toBe(true)
    })

    it('行 seq 缺失（快照流式行）无法比较 → 保守不隐藏（放行侧由 hub forkSession 校验把守）', () => {
        expect(canForkMessage({ metadata: base.metadata, seq: null }, 'ns-1', { ...idle, contextBoundarySeq: 100 })).toBe(true)
    })
})

// ── collectForkTargetBlockIds：入口仅挂「turn 的 result 落点」 ──

const userText = (id: string, text = 'hi'): ChatBlock => ({
    kind: 'user-text', id, localId: null, createdAt: 1, blocks: [{ type: 'text', text }],
})
const agentText = (id: string, text = 'reply'): ChatBlock => ({
    kind: 'agent-text', id, localId: null, createdAt: 2, text,
})
const toolCall = (id: string): ChatBlock => ({
    kind: 'tool-call', id, localId: null, createdAt: 3,
    tool: { id, name: 'Bash', state: 'completed', input: {}, createdAt: 3, startedAt: null, completedAt: null, description: null },
})
const event = (id: string, type: string): ChatBlock => ({
    kind: 'agent-event', id, createdAt: 4, event: { type } as never,
})
const compactSummary = (id: string): ChatBlock => ({
    kind: 'compact-summary', id, localId: null, createdAt: 5, text: 'summary', preTokens: 1, postTokens: 1, durationMs: 1,
})

describe('collectForkTargetBlockIds（每 turn 最后一条 agent 文本块 = result 落点）', () => {
    it('每 turn 取最后一条 agent 文本块；turn 后尾随的事件/工具块不改变落点', () => {
        const targets = collectForkTargetBlockIds([
            userText('u1'),
            agentText('a1:text:0'),
            toolCall('t1'),
            agentText('a1:text:1'),
            event('e1', 'turn-result'),
            userText('u2'),
            agentText('a2:text:0'),
        ])
        expect([...targets]).toEqual(['a1:text:1', 'a2:text:0'])
    })

    it('user 消息开启新 turn（turnBoundary 语义）', () => {
        const targets = collectForkTargetBlockIds([agentText('a0:0'), userText('u1'), agentText('a1:0')])
        expect([...targets]).toEqual(['a0:0', 'a1:0'])
    })

    it('context-cleared 事件与 compact_boundary（compact 事件）开启新 turn', () => {
        const targets = collectForkTargetBlockIds([
            agentText('a0:0'),
            event('e0', 'context-cleared'),
            agentText('a1:0'),
            event('e1', 'compact'),
            agentText('a2:0'),
        ])
        expect([...targets]).toEqual(['a0:0', 'a1:0', 'a2:0'])
    })

    it('compact-summary（compact 总结消息，user 信封）开启新 turn', () => {
        const targets = collectForkTargetBlockIds([agentText('a0:0'), compactSummary('cs'), agentText('a1:0')])
        expect([...targets]).toEqual(['a0:0', 'a1:0'])
    })

    it('rewind 起点 synthetic 行（REWIND_COMMAND）不开启新 turn', () => {
        const targets = collectForkTargetBlockIds([agentText('a0:0'), userText('rw', REWIND_COMMAND), agentText('a0:1')])
        expect([...targets]).toEqual(['a0:1'])
    })

    it('turn 内无 agent 文本块（纯工具轮）→ 不产生落点；空列表 → 空', () => {
        expect([...collectForkTargetBlockIds([userText('u1'), toolCall('t1'), event('e1', 'turn-result')])]).toEqual([])
        expect([...collectForkTargetBlockIds([])]).toEqual([])
    })
})

describe('agentBlockMessageKey（agent 文本块 → 消息行 key，与 reducer blockId 前缀同构）', () => {
    it('localId 在场优先（snapshot 与 full 共享 localId，reducer blockId 同源）', () => {
        expect(agentBlockMessageKey({ id: 'row-1:0', localId: 'sdk-uuid' })).toBe('sdk-uuid')
    })

    it('localId 缺失回退 block.id 去掉 :idx 后缀；无后缀原样', () => {
        expect(agentBlockMessageKey({ id: 'row-1:2', localId: null })).toBe('row-1')
        expect(agentBlockMessageKey({ id: 'row-1', localId: null })).toBe('row-1')
        expect(agentBlockMessageKey({ id: 'a:b:0', localId: null })).toBe('a:b')
    })
})

describe('forkRejectReasonKey（hub forkSession 失败 reason code → 文案判别）', () => {
    it('已知 code 各归专用文案', () => {
        expect(forkRejectReasonKey('anchor-not-found')).toBe('chat.fork.anchorMissing')
        expect(forkRejectReasonKey('anchor-before-boundary')).toBe('chat.fork.beforeBoundary')
        expect(forkRejectReasonKey('turn-start-not-found')).toBe('chat.fork.turnStartMissing')
        expect(forkRejectReasonKey('parent-native-missing')).toBe('chat.fork.parentNativeMissing')
    })

    it('未知 / 缺省 code → 笼统 unavailable（不直出英文串）', () => {
        expect(forkRejectReasonKey('session-not-found')).toBe('chat.fork.unavailable')
        expect(forkRejectReasonKey('access-denied')).toBe('chat.fork.unavailable')
        expect(forkRejectReasonKey(undefined)).toBe('chat.fork.unavailable')
    })
})

describe('extractForkRejectCode（执行失败 code 提取，镜像 extractRewindRejectReason）', () => {
    it('HTTP 错误（axios）优先取响应体 code 字段——hub 透传的失败归因', () => {
        const axiosLike = {
            isAxiosError: true,
            message: 'Request failed with status code 400',
            response: { data: { error: 'Anchor message not found', code: 'anchor-not-found' } },
        }
        expect(extractForkRejectCode(axiosLike)).toBe('anchor-not-found')
    })

    it('响应体无 code / 非 HTTP 错误 → undefined（文案层回退笼统提示）', () => {
        expect(extractForkRejectCode({ response: { data: { error: 'x' } } })).toBeUndefined()
        expect(extractForkRejectCode(new Error('Network Error'))).toBeUndefined()
        expect(extractForkRejectCode('weird')).toBeUndefined()
    })
})
