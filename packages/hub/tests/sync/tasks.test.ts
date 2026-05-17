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
    extractTaskDeltasFromMessageContent,
    applyTaskDelta,
    PendingTaskMap,
} from '../../src/sync/tasks'
import type { TaskDelta, TaskItem } from '../../src/sync/tasks'

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

/** 构造 user 消息（含 tool_result 块） */
function makeUserToolResult(toolUseId: string, content: unknown, isError = false, toolUseResult?: Record<string, unknown>) {
    const data: Record<string, unknown> = {
        type: 'user',
        message: {
            content: [{
                type: 'tool_result',
                tool_use_id: toolUseId,
                content: typeof content === 'string' ? content : JSON.stringify(content),
                is_error: isError
            }]
        }
    }
    if (toolUseResult) data.tool_use_result = toolUseResult
    return {
        role: 'user',
        content: {
            type: 'output',
            data
        }
    }
}

/** 构造非 agent/assistant 的消息 */
function makeOtherRoleMessage(role: string) {
    return {
        role,
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                message: {
                    content: []
                }
            }
        }
    }
}

/** 标准的测试用 TaskItem */
function makeSampleTask(overrides?: Partial<TaskItem>): TaskItem {
    return {
        id: 'task-001',
        subject: '测试任务',
        status: 'pending',
        ...overrides,
    }
}

// ============ PendingTaskMap 测试 ============

describe('PendingTaskMap', () => {
    test('saveToolUse / get / delete 正常工作', () => {
        const map = new PendingTaskMap()
        map.saveToolUse('id-1', 'TaskCreate', { subject: '测试' })

        const entry = map.get('id-1')
        expect(entry).toBeDefined()
        expect(entry!.toolName).toBe('TaskCreate')
        expect(entry!.input).toEqual({ subject: '测试' })

        map.delete('id-1')
        expect(map.get('id-1')).toBeUndefined()
    })

    test('saveReadOnlyToolName / getToolName / delete 正常工作', () => {
        const map = new PendingTaskMap()
        map.saveReadOnlyToolName('id-2', 'TaskList')

        expect(map.getToolName('id-2')).toBe('TaskList')

        map.delete('id-2')
        expect(map.getToolName('id-2')).toBeUndefined()
    })

    test('不存在的 key 返回 undefined', () => {
        const map = new PendingTaskMap()
        expect(map.get('no-such-id')).toBeUndefined()
        expect(map.getToolName('no-such-id')).toBeUndefined()
    })
})

// ============ extractTaskDeltasFromMessageContent 测试 ============

describe('extractTaskDeltasFromMessageContent', () => {

    describe('TaskCreate', () => {
        test('配对成功：暂存 tool_use + 配对 tool_result 返回 create delta', () => {
            const map = new PendingTaskMap()

            // 1. assistant 消息暂存 tool_use
            const assistantMsg = makeAssistantToolUse('tu-1', 'TaskCreate', {
                subject: '实现功能 X',
                description: '详细描述',
            })
            const result1 = extractTaskDeltasFromMessageContent(assistantMsg, map)
            expect(result1).toBeNull()
            expect(map.get('tu-1')).toBeDefined()

            // 2. user 消息配对 tool_result
            const userMsg = makeUserToolResult('tu-1', {
                task: { id: 'task-001', subject: '实现功能 X' }
            })
            const result2 = extractTaskDeltasFromMessageContent(userMsg, map)
            expect(result2).not.toBeNull()
            expect(result2!.type).toBe('create')

            const delta = result2 as Extract<TaskDelta, { type: 'create' }>
            expect(delta.task.id).toBe('task-001')
            expect(delta.task.subject).toBe('实现功能 X')
            expect(delta.task.description).toBe('详细描述')
            expect(delta.task.status).toBe('pending')

            // 配对后暂存已清除
            expect(map.get('tu-1')).toBeUndefined()
        })

        test('配对成功：包含 metadata 和 activeForm', () => {
            const map = new PendingTaskMap()

            const assistantMsg = makeAssistantToolUse('tu-1', 'TaskCreate', {
                subject: '实现功能 Y',
                activeForm: '正在实现功能 Y',
                metadata: { priority: 'high' },
            })
            extractTaskDeltasFromMessageContent(assistantMsg, map)

            const userMsg = makeUserToolResult('tu-1', {
                task: { id: 'task-002', subject: '实现功能 Y' }
            })
            const result = extractTaskDeltasFromMessageContent(userMsg, map)

            expect(result).not.toBeNull()
            const delta = result as Extract<TaskDelta, { type: 'create' }>
            expect(delta.task.activeForm).toBe('正在实现功能 Y')
            expect(delta.task.metadata).toEqual({ priority: 'high' })
        })

        test('tool_result 失败时不生成 task', () => {
            const map = new PendingTaskMap()

            const assistantMsg = makeAssistantToolUse('tu-2', 'TaskCreate', {
                subject: '失败的任务',
            })
            extractTaskDeltasFromMessageContent(assistantMsg, map)

            const userMsg = makeUserToolResult('tu-2', { error: '创建失败' }, true)
            const result = extractTaskDeltasFromMessageContent(userMsg, map)
            expect(result).toBeNull()
        })
    })

    describe('TaskUpdate', () => {
        test('配对成功：返回 update delta', () => {
            const map = new PendingTaskMap()

            const assistantMsg = makeAssistantToolUse('tu-3', 'TaskUpdate', {
                taskId: 'task-001',
                status: 'in_progress',
            })
            extractTaskDeltasFromMessageContent(assistantMsg, map)

            const userMsg = makeUserToolResult('tu-3', { success: true })
            const result = extractTaskDeltasFromMessageContent(userMsg, map)

            expect(result).not.toBeNull()
            expect(result!.type).toBe('update')

            const delta = result as Extract<TaskDelta, { type: 'update' }>
            expect(delta.taskId).toBe('task-001')
            expect(delta.updates.status).toBe('in_progress')
        })

        test('配对成功：多个更新字段', () => {
            const map = new PendingTaskMap()

            const assistantMsg = makeAssistantToolUse('tu-4', 'TaskUpdate', {
                taskId: 'task-001',
                status: 'completed',
                subject: '更新后的标题',
                description: '更新后的描述',
            })
            extractTaskDeltasFromMessageContent(assistantMsg, map)

            const userMsg = makeUserToolResult('tu-4', { success: true })
            const result = extractTaskDeltasFromMessageContent(userMsg, map)

            const delta = result as Extract<TaskDelta, { type: 'update' }>
            expect(delta.updates.status).toBe('completed')
            expect(delta.updates.subject).toBe('更新后的标题')
            expect(delta.updates.description).toBe('更新后的描述')
        })

        test('tool_result 失败时丢弃', () => {
            const map = new PendingTaskMap()

            const assistantMsg = makeAssistantToolUse('tu-5', 'TaskUpdate', {
                taskId: 'task-001',
                status: 'completed',
            })
            extractTaskDeltasFromMessageContent(assistantMsg, map)

            const userMsg = makeUserToolResult('tu-5', { error: '更新失败' }, true)
            const result = extractTaskDeltasFromMessageContent(userMsg, map)
            expect(result).toBeNull()
        })
    })

    describe('TaskList', () => {
        test('配对成功：返回 calibration delta', () => {
            const map = new PendingTaskMap()

            const assistantMsg = makeAssistantToolUse('tu-6', 'TaskList', {
                status: 'pending',
            })
            extractTaskDeltasFromMessageContent(assistantMsg, map)

            const userMsg = makeUserToolResult('tu-6', {
                tasks: [
                    { id: 'task-001', subject: '任务 1', status: 'pending' },
                    { id: 'task-002', subject: '任务 2', status: 'in_progress' },
                ]
            })
            const result = extractTaskDeltasFromMessageContent(userMsg, map)

            expect(result).not.toBeNull()
            expect(result!.type).toBe('calibration')

            const delta = result as Extract<TaskDelta, { type: 'calibration' }>
            expect(delta.tasks).toHaveLength(2)
            expect(delta.tasks[0].id).toBe('task-001')
            expect(delta.tasks[1].status).toBe('in_progress')
        })
    })

    describe('TaskGet', () => {
        test('配对成功：返回 single-calibration delta', () => {
            const map = new PendingTaskMap()

            const assistantMsg = makeAssistantToolUse('tu-7', 'TaskGet', {
                taskId: 'task-001',
            })
            extractTaskDeltasFromMessageContent(assistantMsg, map)

            const userMsg = makeUserToolResult('tu-7', {
                task: { id: 'task-001', subject: '任务 1', status: 'in_progress', description: '描述' }
            })
            const result = extractTaskDeltasFromMessageContent(userMsg, map)

            expect(result).not.toBeNull()
            expect(result!.type).toBe('single-calibration')

            const delta = result as Extract<TaskDelta, { type: 'single-calibration' }>
            expect(delta.task.id).toBe('task-001')
            expect(delta.task.status).toBe('in_progress')
        })
    })

    describe('边界情况', () => {
        test('非 agent/assistant/user 消息返回 null', () => {
            const map = new PendingTaskMap()
            const msg = makeOtherRoleMessage('system')
            const result = extractTaskDeltasFromMessageContent(msg, map)
            expect(result).toBeNull()
        })

        test('不含 Task 工具调用的 assistant 消息返回 null', () => {
            const map = new PendingTaskMap()
            const msg = makeAssistantToolUse('tu-x', 'OtherTool', { foo: 'bar' })
            const result = extractTaskDeltasFromMessageContent(msg, map)
            expect(result).toBeNull()
            expect(map.get('tu-x')).toBeUndefined()
        })

        test('不含 tool_result 的 user 消息返回 null', () => {
            const map = new PendingTaskMap()
            const msg = {
                role: 'user',
                content: {
                    type: 'output',
                    data: {
                        type: 'user',
                        message: {
                            content: [{ type: 'text', text: '普通文本' }]
                        }
                    }
                }
            }
            const result = extractTaskDeltasFromMessageContent(msg, map)
            expect(result).toBeNull()
        })

        test('无法解包的消息返回 null', () => {
            const map = new PendingTaskMap()
            expect(extractTaskDeltasFromMessageContent('not-an-object', map)).toBeNull()
            expect(extractTaskDeltasFromMessageContent(null, map)).toBeNull()
            expect(extractTaskDeltasFromMessageContent(undefined, map)).toBeNull()
        })

        test('tool_result 的 content 为 JSON 字符串时可正常解析', () => {
            const map = new PendingTaskMap()

            const assistantMsg = makeAssistantToolUse('tu-str', 'TaskCreate', {
                subject: '字符串结果',
            })
            extractTaskDeltasFromMessageContent(assistantMsg, map)

            // content 为 JSON 字符串（makeUserToolResult 会 stringify）
            const userMsg = makeUserToolResult('tu-str', {
                task: { id: 'task-str-1', subject: '字符串结果' }
            })
            const result = extractTaskDeltasFromMessageContent(userMsg, map)

            expect(result).not.toBeNull()
            const delta = result as Extract<TaskDelta, { type: 'create' }>
            expect(delta.task.id).toBe('task-str-1')
        })

        test('未配对的 tool_result（无暂存）返回 null', () => {
            const map = new PendingTaskMap()

            const userMsg = makeUserToolResult('unknown-id', {
                task: { id: 'task-999', subject: '未知' }
            })
            const result = extractTaskDeltasFromMessageContent(userMsg, map)
            expect(result).toBeNull()
        })

        test('TaskUpdate 缺少 taskId 时返回 null', () => {
            const map = new PendingTaskMap()

            const assistantMsg = makeAssistantToolUse('tu-notaskid', 'TaskUpdate', {
                status: 'completed',
            })
            extractTaskDeltasFromMessageContent(assistantMsg, map)

            const userMsg = makeUserToolResult('tu-notaskid', { success: true })
            const result = extractTaskDeltasFromMessageContent(userMsg, map)
            expect(result).toBeNull()
        })

        test('TaskUpdate 无更新字段时返回 null', () => {
            const map = new PendingTaskMap()

            const assistantMsg = makeAssistantToolUse('tu-nofields', 'TaskUpdate', {
                taskId: 'task-001',
            })
            extractTaskDeltasFromMessageContent(assistantMsg, map)

            const userMsg = makeUserToolResult('tu-nofields', { success: true })
            const result = extractTaskDeltasFromMessageContent(userMsg, map)
            expect(result).toBeNull()
        })
    })

    describe('tool_use_result 提取', () => {
        // 实际 Claude Agent SDK 的 tool_result 格式：
        // content 是纯文本，task 数据在 tool_use_result 中
        test('TaskCreate: content 为纯文本时从 tool_use_result 提取 task', () => {
            const map = new PendingTaskMap()

            const assistantMsg = makeAssistantToolUse('tu-tur-1', 'TaskCreate', {
                subject: '创建 src 目录',
                description: '创建 /tmp/e2e-test-task/src 目录',
            })
            extractTaskDeltasFromMessageContent(assistantMsg, map)

            const userMsg = makeUserToolResult(
                'tu-tur-1',
                'Task #4 created successfully: 创建 src 目录',
                false,
                { task: { id: '4', subject: '创建 /tmp/e2e-test-task/src 目录' } }
            )
            const result = extractTaskDeltasFromMessageContent(userMsg, map)
            expect(result).not.toBeNull()
            expect(result!.type).toBe('create')

            const delta = result as Extract<TaskDelta, { type: 'create' }>
            expect(delta.task.id).toBe('4')
            expect(delta.task.subject).toBe('创建 src 目录')
            expect(delta.task.description).toBe('创建 /tmp/e2e-test-task/src 目录')
            expect(delta.task.status).toBe('pending')
        })

        test('TaskCreate: 无 tool_use_result 时回退到 content 解析', () => {
            const map = new PendingTaskMap()

            const assistantMsg = makeAssistantToolUse('tu-tur-2', 'TaskCreate', {
                subject: '回退测试',
            })
            extractTaskDeltasFromMessageContent(assistantMsg, map)

            // 无 tool_use_result，content 是 JSON
            const userMsg = makeUserToolResult('tu-tur-2', {
                task: { id: 'task-fallback', subject: '回退测试' }
            })
            const result = extractTaskDeltasFromMessageContent(userMsg, map)
            expect(result).not.toBeNull()

            const delta = result as Extract<TaskDelta, { type: 'create' }>
            expect(delta.task.id).toBe('task-fallback')
            expect(delta.task.subject).toBe('回退测试')
        })

        test('TaskGet: 从 tool_use_result 提取单个 task', () => {
            const map = new PendingTaskMap()

            const assistantMsg = makeAssistantToolUse('tu-tur-3', 'TaskGet', {})
            extractTaskDeltasFromMessageContent(assistantMsg, map)

            const userMsg = makeUserToolResult(
                'tu-tur-3',
                'Task details retrieved',
                false,
                { task: { id: 'task-get-1', subject: '校准任务', status: 'in_progress' } }
            )
            const result = extractTaskDeltasFromMessageContent(userMsg, map)
            expect(result).not.toBeNull()
            expect(result!.type).toBe('single-calibration')

            const delta = result as Extract<TaskDelta, { type: 'single-calibration' }>
            expect(delta.task.id).toBe('task-get-1')
            expect(delta.task.subject).toBe('校准任务')
            expect(delta.task.status).toBe('in_progress')
        })

        test('TaskList: 从 tool_use_result 提取 task 列表', () => {
            const map = new PendingTaskMap()

            const assistantMsg = makeAssistantToolUse('tu-tur-4', 'TaskList', {})
            extractTaskDeltasFromMessageContent(assistantMsg, map)

            const userMsg = makeUserToolResult(
                'tu-tur-4',
                '2 tasks found',
                false,
                { tasks: [
                    { id: '1', subject: '任务A', status: 'completed' },
                    { id: '2', subject: '任务B', status: 'pending' },
                ] }
            )
            const result = extractTaskDeltasFromMessageContent(userMsg, map)
            expect(result).not.toBeNull()
            expect(result!.type).toBe('calibration')

            const delta = result as Extract<TaskDelta, { type: 'calibration' }>
            expect(delta.tasks).toHaveLength(2)
            expect(delta.tasks[0].subject).toBe('任务A')
            expect(delta.tasks[1].subject).toBe('任务B')
        })
    })
})

// ============ applyTaskDelta 测试 ============

describe('applyTaskDelta', () => {

    test('create: 添加新 task 到空列表', () => {
        const delta: TaskDelta = {
            type: 'create',
            task: makeSampleTask(),
        }
        const result = applyTaskDelta(undefined, delta)
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('task-001')
    })

    test('create: 添加新 task 到已有列表', () => {
        const existing: TaskItem[] = [makeSampleTask({ id: 'task-001' })]
        const delta: TaskDelta = {
            type: 'create',
            task: makeSampleTask({ id: 'task-002', subject: '新任务' }),
        }
        const result = applyTaskDelta(existing, delta)
        expect(result).toHaveLength(2)
        expect(result[1].id).toBe('task-002')
    })

    test('create: 已存在相同 id 时覆盖', () => {
        const existing: TaskItem[] = [makeSampleTask({ id: 'task-001', subject: '旧标题' })]
        const delta: TaskDelta = {
            type: 'create',
            task: makeSampleTask({ id: 'task-001', subject: '新标题' }),
        }
        const result = applyTaskDelta(existing, delta)
        expect(result).toHaveLength(1)
        expect(result[0].subject).toBe('新标题')
    })

    test('update: 更新已有 task 的字段', () => {
        const existing: TaskItem[] = [makeSampleTask({ id: 'task-001', status: 'pending' })]
        const delta: TaskDelta = {
            type: 'update',
            taskId: 'task-001',
            updates: { status: 'in_progress' },
        }
        const result = applyTaskDelta(existing, delta)
        expect(result).toHaveLength(1)
        expect(result[0].status).toBe('in_progress')
    })

    test('update: status 为 deleted 时移除 task', () => {
        const existing: TaskItem[] = [
            makeSampleTask({ id: 'task-001' }),
            makeSampleTask({ id: 'task-002' }),
        ]
        const delta: TaskDelta = {
            type: 'update',
            taskId: 'task-001',
            updates: { status: 'deleted' },
        }
        const result = applyTaskDelta(existing, delta)
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('task-002')
    })

    test('update: 不存在的 taskId 不影响列表', () => {
        const existing: TaskItem[] = [makeSampleTask({ id: 'task-001' })]
        const delta: TaskDelta = {
            type: 'update',
            taskId: 'task-999',
            updates: { status: 'completed' },
        }
        const result = applyTaskDelta(existing, delta)
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('task-001')
    })

    test('calibration: 替换整个列表', () => {
        const existing: TaskItem[] = [
            makeSampleTask({ id: 'task-001' }),
            makeSampleTask({ id: 'task-002' }),
        ]
        const delta: TaskDelta = {
            type: 'calibration',
            tasks: [
                makeSampleTask({ id: 'task-003', subject: '校准任务 A' }),
                makeSampleTask({ id: 'task-004', subject: '校准任务 B' }),
                makeSampleTask({ id: 'task-005', subject: '校准任务 C' }),
            ],
        }
        const result = applyTaskDelta(existing, delta)
        expect(result).toHaveLength(3)
        expect(result[0].id).toBe('task-003')
        expect(result[2].subject).toBe('校准任务 C')
    })

    test('calibration: 替换空列表', () => {
        const existing: TaskItem[] = [makeSampleTask({ id: 'task-001' })]
        const delta: TaskDelta = {
            type: 'calibration',
            tasks: [],
        }
        const result = applyTaskDelta(existing, delta)
        expect(result).toHaveLength(0)
    })

    test('single-calibration: 更新已存在的 task', () => {
        const existing: TaskItem[] = [
            makeSampleTask({ id: 'task-001', status: 'pending', subject: '旧标题' }),
        ]
        const delta: TaskDelta = {
            type: 'single-calibration',
            task: makeSampleTask({ id: 'task-001', status: 'in_progress', subject: '新标题' }),
        }
        const result = applyTaskDelta(existing, delta)
        expect(result).toHaveLength(1)
        expect(result[0].status).toBe('in_progress')
        expect(result[0].subject).toBe('新标题')
    })

    test('single-calibration: 添加不存在的 task', () => {
        const existing: TaskItem[] = [makeSampleTask({ id: 'task-001' })]
        const delta: TaskDelta = {
            type: 'single-calibration',
            task: makeSampleTask({ id: 'task-002', subject: '新增任务' }),
        }
        const result = applyTaskDelta(existing, delta)
        expect(result).toHaveLength(2)
        expect(result[1].id).toBe('task-002')
    })
})
