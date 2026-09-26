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
 * attentionFeedback 转换检测契约：
 * - 首次见到的 session 只记基线不触发（避免页面加载/重连对账时对已在等待的会话误响）
 * - pending 优先于 ready（审批到达时同帧 running 翻转，审批语义更高优先级）
 * - 仅活跃会话触发；非活跃只更新基线
 * - 增量 delta 只带部分字段时与基线合并，缺失字段沿用旧值
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
    diffAttentionTransition,
    trackAttentionTransition,
    clearAttentionState,
    clearAllAttentionStates,
    type AttentionSnapshot,
} from '@/core/notifications/attentionFeedback'

const idle: AttentionSnapshot = { active: true, running: false, pendingCount: 0 }
const running: AttentionSnapshot = { active: true, running: true, pendingCount: 0 }
const pending: AttentionSnapshot = { active: true, running: true, pendingCount: 1 }

describe('diffAttentionTransition', () => {
    it('running true→false → ready（输出完成等待输入）', () => {
        expect(diffAttentionTransition(running, idle)).toBe('ready')
    })

    it('pendingCount 0→N → pending（审批/提问到达）', () => {
        expect(diffAttentionTransition(running, pending)).toBe('pending')
    })

    it('pendingCount N→0（审批已处理）不触发', () => {
        expect(diffAttentionTransition(pending, running)).toBeNull()
    })

    it('同帧 pending 到达且 running 翻转 → pending 优先', () => {
        expect(diffAttentionTransition(running, { active: true, running: false, pendingCount: 2 })).toBe('pending')
    })

    it('无变化 / running false→true（开始输出）均不触发', () => {
        expect(diffAttentionTransition(idle, idle)).toBeNull()
        expect(diffAttentionTransition(idle, running)).toBeNull()
        expect(diffAttentionTransition(pending, pending)).toBeNull()
    })

    it('非活跃会话任何变化都不触发', () => {
        expect(diffAttentionTransition(running, { active: false, running: false, pendingCount: 0 })).toBeNull()
        expect(diffAttentionTransition(idle, { active: false, running: false, pendingCount: 3 })).toBeNull()
    })
})

describe('trackAttentionTransition（模块级基线）', () => {
    beforeEach(() => {
        clearAllAttentionStates()
    })

    it('首次见到只记基线不触发', () => {
        expect(trackAttentionTransition('s1', { running: true })).toBeNull()
        // 基线已记录：之后真正翻转才触发
        expect(trackAttentionTransition('s1', { running: false })).toBe('ready')
    })

    it('增量 delta 与基线合并，缺省字段沿用旧值', () => {
        // 基线：running + pending=1
        trackAttentionTransition('s2', { running: true, agentState: { requests: { r1: {} } } })
        // delta 只带 agentState 清空：pending 1→0，running 沿用 true → 不触发
        expect(trackAttentionTransition('s2', { agentState: { requests: {} } })).toBeNull()
    })

    it('delta 带完整 session（id 同 sessionId）同样按字段归并', () => {
        trackAttentionTransition('s3', { running: true })
        expect(trackAttentionTransition('s3', { id: 's3', running: false, active: true })).toBe('ready')
    })

    it('会话首次出现即在等待中（重连对账重放）不误响', () => {
        expect(trackAttentionTransition('s4', { running: false, agentState: { requests: { r: {} } } })).toBeNull()
    })

    it('clearAttentionState 清除单会话基线后再见到重新记基线', () => {
        trackAttentionTransition('s5', { running: true })
        clearAttentionState('s5')
        expect(trackAttentionTransition('s5', { running: false })).toBeNull()
    })

    it('非活跃 delta：基线更新为非活跃，后续 pending 到达不触发', () => {
        trackAttentionTransition('s6', { running: true })
        trackAttentionTransition('s6', { active: false, running: false })
        expect(trackAttentionTransition('s6', { agentState: { requests: { r: {} } } })).toBeNull()
    })
})
