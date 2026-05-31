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

import { describe, test, expect } from 'bun:test'
import {
    extractTeamStateFromMessageContent,
    applyTeamStateDelta,
} from '../../src/sync/teams'
import type { TeamState } from '@mobi/shared/types'

// ============ 辅助函数 ============

/** 构造 assistant 消息（含 tool_use 块） */
function makeAssistantToolUse(toolUseId: string, name: string, input: Record<string, unknown>) {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                message: {
                    content: [{ type: 'tool_use', id: toolUseId, name, input }]
                }
            }
        }
    }
}

/** 构造一个初始 TeamState */
function makeTeamState(overrides?: Partial<TeamState>): TeamState {
    return {
        teamName: 'test-team',
        members: [],
        tasks: [],
        messages: [],
        updatedAt: Date.now(),
        ...overrides,
    }
}

// ============ Agent tool name 匹配测试 ============

describe('Agent tool name 匹配', () => {
    test('Agent tool_use 与 Task tool_use 一样触发 processTaskToolWithTeam', () => {
        const delta = extractTeamStateFromMessageContent(
            makeAssistantToolUse('tu-1', 'Agent', {
                team_name: 'test-team',
                name: 'analyzer',
                subagent_type: 'general-purpose',
                description: '分析任务',
            })
        )
        expect(delta).not.toBeNull()
        expect(delta!._action).toBe('update')
        expect(delta!.members).toHaveLength(1)
        expect(delta!.members![0].name).toBe('analyzer')
    })
})

// ============ 自动清理测试 ============

describe('applyTeamStateDelta 自动清理', () => {
    test('所有 members idle + 所有 tasks completed → 返回 null', () => {
        // 1. 创建 team
        const createDelta = extractTeamStateFromMessageContent(
            makeAssistantToolUse('tu-1', 'TeamCreate', {
                team_name: 'test-team',
                description: '测试团队',
            })
        )
        let state = applyTeamStateDelta(null, createDelta!)
        expect(state).not.toBeNull()

        // 2. 添加 member + task
        const memberDelta = extractTeamStateFromMessageContent(
            makeAssistantToolUse('tu-2', 'Task', {
                team_name: 'test-team',
                name: 'researcher',
                subagent_type: 'general-purpose',
                description: '研究任务',
            })
        )
        state = applyTeamStateDelta(state, memberDelta!)
        expect(state!.members).toHaveLength(1)
        expect(state!.tasks).toHaveLength(1)

        // 3. TeammateIdle → member idle（直接构造 delta）
        const idleDelta = {
            _action: 'update' as const,
            members: [{ name: 'researcher', status: 'idle' as const }],
            updatedAt: Date.now(),
        }
        state = applyTeamStateDelta(state, idleDelta)

        // member idle 但 task 还 in_progress → 不清理
        expect(state).not.toBeNull()
        expect(state!.members![0].status).toBe('idle')

        // 4. TaskCompleted → task completed（直接构造 delta）
        const completedDelta = {
            _action: 'update' as const,
            tasks: [{
                id: state!.tasks![0].id,
                title: '研究任务',
                status: 'completed' as const,
                owner: 'researcher',
            }],
            updatedAt: Date.now(),
        }
        state = applyTeamStateDelta(state, completedDelta)

        // 所有 members idle + 所有 tasks completed → 自动清理
        expect(state).toBeNull()
    })

    test('members idle 但 tasks 未全部 completed → 不清理', () => {
        // 创建 team 并添加两个 member + 两个 task
        const createDelta = extractTeamStateFromMessageContent(
            makeAssistantToolUse('tu-1', 'TeamCreate', {
                team_name: 'test-team',
            })
        )
        let state = applyTeamStateDelta(null, createDelta!)

        // 添加 member1 + task1
        const taskDelta1 = extractTeamStateFromMessageContent(
            makeAssistantToolUse('tu-2', 'Task', {
                team_name: 'test-team',
                name: 'researcher',
                description: '研究任务',
            })
        )
        state = applyTeamStateDelta(state, taskDelta1!)

        // 添加 member2 + task2
        const taskDelta2 = extractTeamStateFromMessageContent(
            makeAssistantToolUse('tu-3', 'Task', {
                team_name: 'test-team',
                name: 'coder',
                description: '编码任务',
            })
        )
        state = applyTeamStateDelta(state, taskDelta2!)

        // TeammateIdle: researcher（直接构造 delta）
        const idleDelta1 = {
            _action: 'update' as const,
            members: [{ name: 'researcher', status: 'idle' as const }],
            updatedAt: Date.now(),
        }
        state = applyTeamStateDelta(state, idleDelta1)

        // TaskCompleted: researcher 的任务（直接构造 delta）
        const completedDelta1 = {
            _action: 'update' as const,
            tasks: [{
                id: 'agent:researcher',
                title: '研究任务',
                status: 'completed' as const,
                owner: 'researcher',
            }],
            updatedAt: Date.now(),
        }
        state = applyTeamStateDelta(state, completedDelta1)

        // member1 idle + task1 completed，但 coder 仍 active → 不清理
        expect(state).not.toBeNull()
    })

    test('空 members + 空 tasks 时不清理（初始创建态）', () => {
        const createDelta = extractTeamStateFromMessageContent(
            makeAssistantToolUse('tu-1', 'TeamCreate', {
                team_name: 'test-team',
            })
        )
        const state = applyTeamStateDelta(null, createDelta!)
        // 刚创建的 team 没有任何 member 或 task，不应该自动清理
        expect(state).not.toBeNull()
    })

    test('所有 members shutdown + 所有 tasks completed → 返回 null', () => {
        // 创建 team
        const createDelta = extractTeamStateFromMessageContent(
            makeAssistantToolUse('tu-1', 'TeamCreate', {
                team_name: 'test-team',
            })
        )
        let state = applyTeamStateDelta(null, createDelta!)

        // 添加 member + task
        const taskDelta = extractTeamStateFromMessageContent(
            makeAssistantToolUse('tu-2', 'Task', {
                team_name: 'test-team',
                name: 'researcher',
                description: '研究任务',
            })
        )
        state = applyTeamStateDelta(state, taskDelta!)

        // TaskCompleted → task completed（直接构造 delta）
        const completedDelta = {
            _action: 'update' as const,
            tasks: [{
                id: 'agent:researcher',
                title: '研究任务',
                status: 'completed' as const,
                owner: 'researcher',
            }],
            updatedAt: Date.now(),
        }
        state = applyTeamStateDelta(state, completedDelta)

        // task completed 但 member 还 active → 不清理
        expect(state).not.toBeNull()

        // shutdown member
        const shutdownDelta = {
            _action: 'update' as const,
            members: [{ name: 'researcher', status: 'shutdown' as const }],
            updatedAt: Date.now(),
        }
        state = applyTeamStateDelta(state, shutdownDelta)

        // 所有 members shutdown + 所有 tasks completed → 自动清理
        expect(state).toBeNull()
    })
})

// ============ TeamDelete 仍能清除 teamState 测试 ============

describe('TeamDelete 仍然能清除 teamState', () => {
    test('TeamDelete 返回 null', () => {
        const state = makeTeamState({
            members: [{ name: 'researcher', status: 'active' }],
            tasks: [{ id: 'task-1', title: '任务', status: 'in_progress' }],
        })

        const deleteDelta = extractTeamStateFromMessageContent(
            makeAssistantToolUse('tu-1', 'TeamDelete', {})
        )
        expect(deleteDelta).not.toBeNull()
        expect(deleteDelta!._action).toBe('delete')

        const result = applyTeamStateDelta(state, deleteDelta!)
        expect(result).toBeNull()
    })
})

// ============ extractTeamStateFromMessageContent 兼容性测试 ============

describe('extractTeamStateFromMessageContent 兼容性', () => {
    test('标准 tool_use 消息仍正常工作', () => {
        const delta = extractTeamStateFromMessageContent(
            makeAssistantToolUse('tu-1', 'TeamCreate', {
                team_name: 'compat-team',
                description: '兼容性测试',
            })
        )
        expect(delta).not.toBeNull()
        expect(delta!._action).toBe('create')
    })
})
