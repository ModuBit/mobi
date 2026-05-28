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
import { extractRunningAgents } from '@/domain/chat/extractRunningAgents'
import type { ChatBlock } from '@/domain/chat/types'

// 工厂函数：构造 ToolCallBlock
function makeAgentBlock(overrides: {
    id?: string
    name?: string
    state?: 'pending' | 'running' | 'completed' | 'error'
    input?: Record<string, unknown>
    description?: string | null
    agentSummary?: string
}): ChatBlock {
    return {
        kind: 'tool-call',
        id: overrides.id ?? 'tool-1',
        localId: null,
        createdAt: Date.now(),
        tool: {
            id: overrides.id ?? 'tool-1',
            name: overrides.name ?? 'Task',
            state: overrides.state ?? 'running',
            input: overrides.input ?? { subagent_type: 'Explore', description: '测试 agent' },
            createdAt: Date.now(),
            startedAt: Date.now(),
            completedAt: null,
            description: overrides.description ?? null,
            ...(overrides.agentSummary && { agentSummary: overrides.agentSummary }),
        },
        children: [],
    }
}

describe('extractRunningAgents', () => {
    it('空数组返回空数组', () => {
        expect(extractRunningAgents([])).toEqual([])
    })

    it('过滤非 agent 工具', () => {
        const blocks: ChatBlock[] = [
            { kind: 'user-text', id: 'u1', localId: null, createdAt: 0, text: 'hello' },
        ]
        expect(extractRunningAgents(blocks)).toEqual([])
    })

    it('提取 running 状态的 agent', () => {
        const block = makeAgentBlock({ state: 'running' })
        const result = extractRunningAgents([block])
        expect(result).toHaveLength(1)
        expect(result[0].block.id).toBe('tool-1')
        expect(result[0].subagentType).toBe('Explore')
        expect(result[0].description).toBe('测试 agent')
    })

    it('提取 pending 状态的 agent', () => {
        const block = makeAgentBlock({ state: 'pending' })
        expect(extractRunningAgents([block])).toHaveLength(1)
    })

    it('过滤 completed 状态的 agent', () => {
        const block = makeAgentBlock({ state: 'completed' })
        expect(extractRunningAgents([block])).toHaveLength(0)
    })

    it('过滤 error 状态的 agent', () => {
        const block = makeAgentBlock({ state: 'error' })
        expect(extractRunningAgents([block])).toHaveLength(0)
    })

    it('过滤非 Agent/Task 工具', () => {
        const block = makeAgentBlock({ name: 'Bash', state: 'running' })
        expect(extractRunningAgents([block])).toHaveLength(0)
    })

    it('从 input 提取 subagent_type 和 description', () => {
        const block = makeAgentBlock({
            input: { subagent_type: 'Plan', description: '设计方案', prompt: 'xxx' },
        })
        const result = extractRunningAgents([block])
        expect(result[0].subagentType).toBe('Plan')
        expect(result[0].description).toBe('设计方案')
    })

    it('input 缺失字段时返回 null', () => {
        const block = makeAgentBlock({ input: {} })
        const result = extractRunningAgents([block])
        expect(result[0].subagentType).toBeNull()
        expect(result[0].description).toBeNull()
    })

    it('同时有多个 running agent 时全部提取', () => {
        const blocks: ChatBlock[] = [
            makeAgentBlock({ id: 'a1', state: 'running' }),
            makeAgentBlock({ id: 'a2', name: 'Agent', state: 'pending' }),
            makeAgentBlock({ id: 'a3', state: 'completed' }),
        ]
        const result = extractRunningAgents(blocks)
        expect(result).toHaveLength(2)
        expect(result.map(r => r.block.id)).toEqual(['a1', 'a2'])
    })

    it('从 block.tool.agentSummary 提取 summary', () => {
        const block = makeAgentBlock({ state: 'running', agentSummary: 'Analyzing code' })
        const result = extractRunningAgents([block])
        expect(result).toHaveLength(1)
        expect(result[0].summary).toBe('Analyzing code')
    })

    it('agentSummary 不存在时 summary 为 null', () => {
        const block = makeAgentBlock({ state: 'running' })
        const result = extractRunningAgents([block])
        expect(result).toHaveLength(1)
        expect(result[0].summary).toBeNull()
    })
})
