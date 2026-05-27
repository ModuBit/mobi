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
    inferToolName,
    extractBackgroundTaskDeltasFromMessageContent,
    applyBackgroundTaskDelta,
} from '../../src/sync/backgroundTasks'
import type { BackgroundTaskDelta, BackgroundTaskItem } from '../../src/sync/backgroundTasks'

// ============ 辅助函数 ============

/** 构造 agent 消息（含 system 子类型） */
function makeSystemMessage(subtype: string, extra: Record<string, unknown> = {}) {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'system',
                subtype,
                ...extra,
            }
        }
    }
}

/** 标准的测试用 BackgroundTaskItem */
function makeSampleBackgroundTask(overrides?: Partial<BackgroundTaskItem>): BackgroundTaskItem {
    return {
        taskId: 'bt-001',
        toolUseId: 'tu-001',
        toolName: 'Bash',
        description: '运行构建脚本',
        status: 'running',
        startedAt: 1000000,
        ...overrides,
    }
}

// ============ inferToolName 测试 ============

describe('inferToolName', () => {
    test('subagent_type 非空时返回 Agent', () => {
        expect(inferToolName({ subagent_type: 'researcher' })).toBe('Agent')
    })

    test('subagent_type 为空字符串时返回 Bash', () => {
        expect(inferToolName({ subagent_type: '' })).toBe('Bash')
    })

    test('无 subagent_type 字段时返回 Bash', () => {
        expect(inferToolName({})).toBe('Bash')
    })
})

// ============ extractBackgroundTaskDeltasFromMessageContent 测试 ============

describe('extractBackgroundTaskDeltasFromMessageContent', () => {

    describe('task_started', () => {
        test('无 subagent_type 时生成 Bash 类型的 started delta', () => {
            const msg = makeSystemMessage('task_started', {
                task_id: 'bt-001',
                description: '运行构建脚本',
                tool_use_id: 'tu-001',
            })
            const result = extractBackgroundTaskDeltasFromMessageContent(msg)
            expect(result).not.toBeNull()
            expect(result!.type).toBe('started')

            const delta = result as Extract<BackgroundTaskDelta, { type: 'started' }>
            expect(delta.task.taskId).toBe('bt-001')
            expect(delta.task.toolName).toBe('Bash')
            expect(delta.task.description).toBe('运行构建脚本')
            expect(delta.task.toolUseId).toBe('tu-001')
            expect(delta.task.status).toBe('running')
        })

        test('有 subagent_type 时生成 Agent 类型的 started delta', () => {
            const msg = makeSystemMessage('task_started', {
                task_id: 'bt-002',
                description: '研究代码库结构',
                tool_use_id: 'tu-002',
                subagent_type: 'researcher',
            })
            const result = extractBackgroundTaskDeltasFromMessageContent(msg)
            expect(result).not.toBeNull()

            const delta = result as Extract<BackgroundTaskDelta, { type: 'started' }>
            expect(delta.task.taskId).toBe('bt-002')
            expect(delta.task.toolName).toBe('Agent')
            expect(delta.task.subagentType).toBe('researcher')
        })
    })

    describe('task_progress', () => {
        test('生成 progress delta 并携带 metrics', () => {
            const msg = makeSystemMessage('task_progress', {
                task_id: 'bt-001',
                usage: {
                    total_tokens: 500,
                    tool_uses: 3,
                    duration_ms: 12000,
                },
                summary: '正在分析代码',
            })
            const result = extractBackgroundTaskDeltasFromMessageContent(msg)
            expect(result).not.toBeNull()
            expect(result!.type).toBe('progress')

            const delta = result as Extract<BackgroundTaskDelta, { type: 'progress' }>
            expect(delta.taskId).toBe('bt-001')
            expect(delta.metrics.tokens).toBe(500)
            expect(delta.metrics.toolUses).toBe(3)
            expect(delta.metrics.durationMs).toBe(12000)
            expect(delta.summary).toBe('正在分析代码')
        })

        test('缺少 usage 时 metrics 默认为 0', () => {
            const msg = makeSystemMessage('task_progress', {
                task_id: 'bt-001',
            })
            const result = extractBackgroundTaskDeltasFromMessageContent(msg)

            const delta = result as Extract<BackgroundTaskDelta, { type: 'progress' }>
            expect(delta.metrics.tokens).toBe(0)
            expect(delta.metrics.toolUses).toBe(0)
            expect(delta.metrics.durationMs).toBe(0)
            expect(delta.summary).toBeUndefined()
        })
    })

    describe('task_notification', () => {
        test('生成 completed delta 并携带 status 和 summary', () => {
            const msg = makeSystemMessage('task_notification', {
                task_id: 'bt-001',
                status: 'completed',
                summary: '构建成功完成',
            })
            const result = extractBackgroundTaskDeltasFromMessageContent(msg)
            expect(result).not.toBeNull()
            expect(result!.type).toBe('completed')

            const delta = result as Extract<BackgroundTaskDelta, { type: 'completed' }>
            expect(delta.taskId).toBe('bt-001')
            expect(delta.status).toBe('completed')
            expect(delta.summary).toBe('构建成功完成')
        })

        test('status 为 failed 时正确返回', () => {
            const msg = makeSystemMessage('task_notification', {
                task_id: 'bt-002',
                status: 'failed',
            })
            const result = extractBackgroundTaskDeltasFromMessageContent(msg)

            const delta = result as Extract<BackgroundTaskDelta, { type: 'completed' }>
            expect(delta.status).toBe('failed')
            expect(delta.summary).toBeUndefined()
        })

        test('status 为 stopped 时正确返回', () => {
            const msg = makeSystemMessage('task_notification', {
                task_id: 'bt-003',
                status: 'stopped',
                summary: '用户手动停止',
            })
            const result = extractBackgroundTaskDeltasFromMessageContent(msg)

            const delta = result as Extract<BackgroundTaskDelta, { type: 'completed' }>
            expect(delta.status).toBe('stopped')
            expect(delta.summary).toBe('用户手动停止')
        })
    })

    describe('边界情况', () => {
        test('非 task 相关的 system 消息返回 null', () => {
            const msg = makeSystemMessage('api_error', {
                message: '请求超时',
            })
            const result = extractBackgroundTaskDeltasFromMessageContent(msg)
            expect(result).toBeNull()
        })

        test('非 agent role 的消息返回 null', () => {
            const msg = {
                role: 'user',
                content: {
                    type: 'output',
                    data: {
                        type: 'system',
                        subtype: 'task_started',
                        task_id: 'bt-001',
                    }
                }
            }
            const result = extractBackgroundTaskDeltasFromMessageContent(msg)
            expect(result).toBeNull()
        })

        test('task_started 缺少 task_id 返回 null', () => {
            const msg = makeSystemMessage('task_started', {
                description: '缺少 task_id',
            })
            const result = extractBackgroundTaskDeltasFromMessageContent(msg)
            expect(result).toBeNull()
        })

        test('task_progress 缺少 task_id 返回 null', () => {
            const msg = makeSystemMessage('task_progress', {
                usage: { total_tokens: 100 },
            })
            const result = extractBackgroundTaskDeltasFromMessageContent(msg)
            expect(result).toBeNull()
        })

        test('task_notification 缺少 task_id 返回 null', () => {
            const msg = makeSystemMessage('task_notification', {
                status: 'completed',
            })
            const result = extractBackgroundTaskDeltasFromMessageContent(msg)
            expect(result).toBeNull()
        })

        test('task_notification 的 status 不合法时返回 null', () => {
            const msg = makeSystemMessage('task_notification', {
                task_id: 'bt-001',
                status: 'unknown_status',
            })
            const result = extractBackgroundTaskDeltasFromMessageContent(msg)
            expect(result).toBeNull()
        })

        test('无法解包的消息返回 null', () => {
            expect(extractBackgroundTaskDeltasFromMessageContent('not-an-object')).toBeNull()
            expect(extractBackgroundTaskDeltasFromMessageContent(null)).toBeNull()
            expect(extractBackgroundTaskDeltasFromMessageContent(undefined)).toBeNull()
        })

        test('data.type 不是 system 时返回 null', () => {
            const msg = {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        message: { content: [] },
                    }
                }
            }
            const result = extractBackgroundTaskDeltasFromMessageContent(msg)
            expect(result).toBeNull()
        })
    })
})

// ============ applyBackgroundTaskDelta 测试 ============

describe('applyBackgroundTaskDelta', () => {

    test('started: 添加到空数组', () => {
        const delta: BackgroundTaskDelta = {
            type: 'started',
            task: makeSampleBackgroundTask(),
        }
        const result = applyBackgroundTaskDelta(undefined, delta)
        expect(result).toHaveLength(1)
        expect(result[0].taskId).toBe('bt-001')
    })

    test('started: 添加到已有数组', () => {
        const existing: BackgroundTaskItem[] = [
            makeSampleBackgroundTask({ taskId: 'bt-001' }),
        ]
        const delta: BackgroundTaskDelta = {
            type: 'started',
            task: makeSampleBackgroundTask({ taskId: 'bt-002', description: '新任务' }),
        }
        const result = applyBackgroundTaskDelta(existing, delta)
        expect(result).toHaveLength(2)
        expect(result[1].taskId).toBe('bt-002')
    })

    test('started: 相同 taskId 时覆盖（幂等）', () => {
        const existing: BackgroundTaskItem[] = [
            makeSampleBackgroundTask({ taskId: 'bt-001', description: '旧描述' }),
        ]
        const delta: BackgroundTaskDelta = {
            type: 'started',
            task: makeSampleBackgroundTask({ taskId: 'bt-001', description: '新描述' }),
        }
        const result = applyBackgroundTaskDelta(existing, delta)
        expect(result).toHaveLength(1)
        expect(result[0].description).toBe('新描述')
    })

    test('progress: 合并 metrics 到已有任务', () => {
        const existing: BackgroundTaskItem[] = [
            makeSampleBackgroundTask({ taskId: 'bt-001' }),
        ]
        const delta: BackgroundTaskDelta = {
            type: 'progress',
            taskId: 'bt-001',
            metrics: { tokens: 500, toolUses: 3, durationMs: 12000 },
            summary: '进度更新',
        }
        const result = applyBackgroundTaskDelta(existing, delta)
        expect(result).toHaveLength(1)
        expect(result[0].metrics).toEqual({ tokens: 500, toolUses: 3, durationMs: 12000 })
        expect(result[0].summary).toBe('进度更新')
    })

    test('progress: 不覆盖未变更的字段', () => {
        const existing: BackgroundTaskItem[] = [
            makeSampleBackgroundTask({
                taskId: 'bt-001',
                description: '原始描述',
            }),
        ]
        const delta: BackgroundTaskDelta = {
            type: 'progress',
            taskId: 'bt-001',
            metrics: { tokens: 100, toolUses: 1, durationMs: 5000 },
        }
        const result = applyBackgroundTaskDelta(existing, delta)
        expect(result[0].description).toBe('原始描述')
        expect(result[0].summary).toBeUndefined()
    })

    test('completed: 更新任务状态为终态（不移除）', () => {
        const existing: BackgroundTaskItem[] = [
            makeSampleBackgroundTask({ taskId: 'bt-001' }),
            makeSampleBackgroundTask({ taskId: 'bt-002' }),
        ]
        const delta: BackgroundTaskDelta = {
            type: 'completed',
            taskId: 'bt-001',
            status: 'completed',
            summary: '构建成功',
        }
        const result = applyBackgroundTaskDelta(existing, delta)
        expect(result).toHaveLength(2)
        expect(result[0].taskId).toBe('bt-001')
        expect(result[0].status).toBe('completed')
        expect(result[0].summary).toBe('构建成功')
        expect(result[0].completedAt).toBeGreaterThan(0)
        // 未变更的任务保持不变
        expect(result[1].taskId).toBe('bt-002')
        expect(result[1].status).toBe('running')
    })

    test('progress: 不存在的 task 返回数组不变', () => {
        const existing: BackgroundTaskItem[] = [
            makeSampleBackgroundTask({ taskId: 'bt-001' }),
        ]
        const delta: BackgroundTaskDelta = {
            type: 'progress',
            taskId: 'bt-999',
            metrics: { tokens: 100, toolUses: 1, durationMs: 5000 },
        }
        const result = applyBackgroundTaskDelta(existing, delta)
        expect(result).toHaveLength(1)
        expect(result[0].taskId).toBe('bt-001')
        // 不应有 metrics 被合并
        expect(result[0].metrics).toBeUndefined()
    })

    test('completed: 不存在的 task 返回空数组', () => {
        const delta: BackgroundTaskDelta = {
            type: 'completed',
            taskId: 'bt-001',
            status: 'completed',
        }
        const result = applyBackgroundTaskDelta(undefined, delta)
        expect(result).toHaveLength(0)
    })
})
