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

/** 构造 hook_started 事件消息 */
function makeHookStartedMessage(
    hookEventName: string,
    input: Record<string, unknown>,
    sessionId = 'session-001',
    cwd = '/test/project',
) {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'hook_started',
                hook_event_name: hookEventName,
                input,
                session_id: sessionId,
                cwd,
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

// ============ processTeammateIdle 测试 ============

describe('processTeammateIdle', () => {
    test('TeammateIdle hook 事件将 member 状态更新为 idle', () => {
        // 1. 创建 team
        const createDelta = extractTeamStateFromMessageContent(
            makeAssistantToolUse('tu-1', 'TeamCreate', {
                team_name: 'test-team',
                description: '测试团队',
            })
        )
        expect(createDelta).not.toBeNull()
        expect(createDelta!._action).toBe('create')
        let state = applyTeamStateDelta(null, createDelta!)
        expect(state).not.toBeNull()
        expect(state!.teamName).toBe('test-team')

        // 2. 添加 member(active) 通过 Task 工具
        const taskDelta = extractTeamStateFromMessageContent(
            makeAssistantToolUse('tu-2', 'Task', {
                team_name: 'test-team',
                name: 'researcher',
                subagent_type: 'general-purpose',
                description: '研究任务',
            })
        )
        expect(taskDelta).not.toBeNull()
        state = applyTeamStateDelta(state, taskDelta!)
        expect(state!.members).toHaveLength(1)
        expect(state!.members![0].name).toBe('researcher')
        expect(state!.members![0].status).toBe('active')

        // 3. TeammateIdle hook 事件
        const idleDelta = extractTeamStateFromMessageContent(
            makeHookStartedMessage('TeammateIdle', {
                teammate_name: 'researcher',
            })
        )
        expect(idleDelta).not.toBeNull()
        expect(idleDelta!._action).toBe('update')
        expect(idleDelta!.members).toHaveLength(1)
        expect(idleDelta!.members![0].name).toBe('researcher')
        expect(idleDelta!.members![0].status).toBe('idle')

        state = applyTeamStateDelta(state, idleDelta!)
        expect(state!.members![0].status).toBe('idle')
    })

    test('TeammateIdle 缺少 teammate_name 时返回 null', () => {
        const delta = extractTeamStateFromMessageContent(
            makeHookStartedMessage('TeammateIdle', {})
        )
        expect(delta).toBeNull()
    })

    test('TeammateIdle teammate_name 非字符串时返回 null', () => {
        const delta = extractTeamStateFromMessageContent(
            makeHookStartedMessage('TeammateIdle', {
                teammate_name: 123,
            })
        )
        expect(delta).toBeNull()
    })
})

// ============ processTaskCompleted 测试 ============

describe('processTaskCompleted', () => {
    test('TaskCompleted hook 事件将 task 状态更新为 completed', () => {
        // 1. 创建 team
        const createDelta = extractTeamStateFromMessageContent(
            makeAssistantToolUse('tu-1', 'TeamCreate', {
                team_name: 'test-team',
                description: '测试团队',
            })
        )
        let state = applyTeamStateDelta(null, createDelta!)

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
        expect(state!.tasks![0].status).toBe('in_progress')

        // 3. TaskCompleted hook 事件
        const completedDelta = extractTeamStateFromMessageContent(
            makeHookStartedMessage('TaskCompleted', {
                task_id: state!.tasks![0].id,
                task_subject: '研究任务',
                teammate_name: 'researcher',
                team_name: 'test-team',
            })
        )
        expect(completedDelta).not.toBeNull()
        expect(completedDelta!._action).toBe('update')
        expect(completedDelta!.tasks).toHaveLength(1)
        expect(completedDelta!.tasks![0].status).toBe('completed')

        state = applyTeamStateDelta(state, completedDelta!)
        expect(state!.tasks![0].status).toBe('completed')
        expect(state!.tasks![0].owner).toBe('researcher')
    })

    test('TaskCompleted 缺少 task_id 时返回 null', () => {
        const delta = extractTeamStateFromMessageContent(
            makeHookStartedMessage('TaskCompleted', {
                task_subject: '某个任务',
                team_name: 'test-team',
            })
        )
        expect(delta).toBeNull()
    })

    test('TaskCompleted 无 team_name 时返回 null（非 team 事件）', () => {
        const delta = extractTeamStateFromMessageContent(
            makeHookStartedMessage('TaskCompleted', {
                task_id: 'task-001',
                task_subject: '某个任务',
            })
        )
        expect(delta).toBeNull()
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

        // 3. TeammateIdle → member idle
        const idleDelta = extractTeamStateFromMessageContent(
            makeHookStartedMessage('TeammateIdle', {
                teammate_name: 'researcher',
            })
        )
        state = applyTeamStateDelta(state, idleDelta!)

        // member idle 但 task 还 in_progress → 不清理
        expect(state).not.toBeNull()
        expect(state!.members![0].status).toBe('idle')

        // 4. TaskCompleted → task completed
        const completedDelta = extractTeamStateFromMessageContent(
            makeHookStartedMessage('TaskCompleted', {
                task_id: state!.tasks![0].id,
                task_subject: '研究任务',
                teammate_name: 'researcher',
                team_name: 'test-team',
            })
        )
        state = applyTeamStateDelta(state, completedDelta!)

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

        // TeammateIdle: researcher
        const idleDelta1 = extractTeamStateFromMessageContent(
            makeHookStartedMessage('TeammateIdle', {
                teammate_name: 'researcher',
            })
        )
        state = applyTeamStateDelta(state, idleDelta1!)

        // TaskCompleted: researcher 的任务
        const completedDelta1 = extractTeamStateFromMessageContent(
            makeHookStartedMessage('TaskCompleted', {
                task_id: `agent:researcher`,
                task_subject: '研究任务',
                teammate_name: 'researcher',
                team_name: 'test-team',
            })
        )
        state = applyTeamStateDelta(state, completedDelta1!)

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

        // TaskCompleted → task completed
        const completedDelta = extractTeamStateFromMessageContent(
            makeHookStartedMessage('TaskCompleted', {
                task_id: `agent:researcher`,
                task_subject: '研究任务',
                teammate_name: 'researcher',
                team_name: 'test-team',
            })
        )
        state = applyTeamStateDelta(state, completedDelta!)

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

// ============ 非 team hook 事件被忽略测试 ============

describe('非 team hook 事件被忽略', () => {
    test('其他 hook_event_name 不生成 delta', () => {
        const delta = extractTeamStateFromMessageContent(
            makeHookStartedMessage('SomeOtherEvent', {
                foo: 'bar',
            })
        )
        expect(delta).toBeNull()
    })

    test('hook_started 但 data.type 不匹配时被忽略', () => {
        // 非 hook_started 的 data.type
        const msg = {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'other_type',
                    hook_event_name: 'TeammateIdle',
                    input: { teammate_name: 'researcher' },
                }
            }
        }
        const delta = extractTeamStateFromMessageContent(msg)
        // 不会命中 hook_started 处理，会走 extractToolBlocks 返回 null
        expect(delta).toBeNull()
    })

    test('TaskCompleted 无 team_name 被忽略', () => {
        const delta = extractTeamStateFromMessageContent(
            makeHookStartedMessage('TaskCompleted', {
                task_id: 'task-001',
                task_subject: '某个任务',
                teammate_name: 'researcher',
                // 无 team_name
            })
        )
        expect(delta).toBeNull()
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

// ============ extractToolBlocks 与 hook_started 共存测试 ============

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

    test('hook_started 消息不干扰 tool_use 消息', () => {
        // hook_started 消息走不同路径，不影响 extractToolBlocks 逻辑
        const hookDelta = extractTeamStateFromMessageContent(
            makeHookStartedMessage('TeammateIdle', {
                teammate_name: 'researcher',
            })
        )
        expect(hookDelta).not.toBeNull()
        expect(hookDelta!._action).toBe('update')
    })

    test('非 agent 角色的 hook_started 消息被忽略', () => {
        const msg = {
            role: 'user',
            content: {
                type: 'output',
                data: {
                    type: 'hook_started',
                    hook_event_name: 'TeammateIdle',
                    input: { teammate_name: 'researcher' },
                }
            }
        }
        const delta = extractTeamStateFromMessageContent(msg)
        expect(delta).toBeNull()
    })
})
