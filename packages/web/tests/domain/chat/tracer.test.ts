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
 * tracer 兜底防线：无法归属的 sidechain 消息不得放行主线。
 *
 * 生产缺陷（2026-09-07）：sidechain 中段消息在 handleUserOutput 转 sidechain prompt 形态时
 * 丢失 parentUUID（已单独修复），tracer 既匹配不上 Task prompt、又取不到 parentUuid，
 * 走到兜底 results.push 直接放行主线 → 以 user-text 气泡泄漏渲染（刷新后消失）。
 * 防线语义：isSidechain 且非根匹配、无 parentUuid 的消息与 orphan 挂起语义一致——
 * 宁可不渲染，绝不进主线。
 */

import { describe, expect, it } from 'vitest'

import { traceMessages } from '@/domain/chat'
import type { NormalizedMessage } from '@/domain/chat/types'

/** Task 主链消息（带 tool-use，供 sidechain root prompt 匹配） */
function taskMessage(prompt: string): NormalizedMessage {
    return {
        id: 'm-task',
        localId: null,
        createdAt: 1000,
        role: 'agent',
        isSidechain: false,
        content: [{ type: 'tool-call', id: 'tool-1', name: 'Task', input: { prompt }, uuid: 'u-main-1', parentUUID: null }],
    }
}

/** sidechain root（prompt 形态，靠 prompt 匹配 Task） */
function sidechainRoot(prompt: string, uuid: string): NormalizedMessage {
    return {
        id: 'm-root',
        localId: null,
        createdAt: 2000,
        role: 'agent',
        isSidechain: true,
        content: [{ type: 'sidechain', uuid, prompt }],
    }
}

describe('traceMessages：无法归属的 sidechain 消息不放行主线', () => {
    it('prompt 匹配的 root 正常归组', () => {
        const task = taskMessage('子任务提示词')
        const root = sidechainRoot('子任务提示词', 's-root')
        const result = traceMessages([task, root])
        expect(result[1].sidechainId).toBe('m-task')
    })

    it('非 root 且无 parentUuid 的 sidechain 消息被丢弃（不进主线）', () => {
        // 修复前的形态：sidechain prompt 无 parentUUID，prompt 匹配不上任何 Task
        const task = taskMessage('子任务提示词')
        const stray = sidechainRoot('一段无法归属的 prompt', 's-stray')
        const result = traceMessages([task, stray])
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('m-task')
    })

    it('有 parentUuid 且链可达的 sidechain 消息正常归组（既有行为不回归）', () => {
        const task = taskMessage('子任务提示词')
        const root = sidechainRoot('子任务提示词', 's-root')
        const child: NormalizedMessage = {
            id: 'm-child',
            localId: null,
            createdAt: 3000,
            role: 'agent',
            isSidechain: true,
            content: [{ type: 'text', text: '子代理输出', uuid: 's-1', parentUUID: 's-root' }],
        }
        const result = traceMessages([task, root, child])
        expect(result).toHaveLength(3)
        expect(result[2].sidechainId).toBe('m-task')
    })

    it('链断裂（parentUuid 无法回溯）的 sidechain 消息不进主线（orphan 挂起语义）', () => {
        const task = taskMessage('子任务提示词')
        const broken: NormalizedMessage = {
            id: 'm-broken',
            localId: null,
            createdAt: 3000,
            role: 'agent',
            isSidechain: true,
            content: [{ type: 'text', text: '链断消息', uuid: 's-x', parentUUID: 's-unknown' }],
        }
        const result = traceMessages([task, broken])
        // orphan 挂起：既不进主线，也不计结果（等待 parent 到达后由 processOrphans 释放）
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('m-task')
    })
})
