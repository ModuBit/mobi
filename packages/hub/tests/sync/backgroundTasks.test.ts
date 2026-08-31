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
    collectBackgroundToolUseIds,
    extractBackgroundTaskDeltasFromMessageContent,
    extractBackgroundTaskIdsFromMessageContent,
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

/** 构造 assistant 消息（含 tool_use blocks），模拟 CLI 的 role:'agent' 包装 */
function makeAssistantMessage(blocks: Array<Record<string, unknown>>) {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                message: {
                    content: blocks,
                },
            },
        },
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
        isBackground: true,
        startedAt: 1000000,
        ...overrides,
    }
}

// ============ collectBackgroundToolUseIds 测试 ============

describe('collectBackgroundToolUseIds', () => {
    test('收集 Bash run_in_background 的 toolUseId', () => {
        const msg = makeAssistantMessage([
            { type: 'tool_use', id: 'toolu-001', name: 'Bash', input: { command: 'sleep 10', run_in_background: true } },
        ])
        const map = new Map()
        collectBackgroundToolUseIds(msg, map)
        expect(map.size).toBe(1)
        expect(map.get('toolu-001')).toBe('Bash')
    })

    test('收集 Agent run_in_background 的 toolUseId', () => {
        const msg = makeAssistantMessage([
            { type: 'tool_use', id: 'toolu-002', name: 'Agent', input: { prompt: '研究代码', run_in_background: true } },
        ])
        const map = new Map()
        collectBackgroundToolUseIds(msg, map)
        expect(map.size).toBe(1)
        expect(map.get('toolu-002')).toBe('Agent')
    })

    test('Monitor 始终被收集', () => {
        const msg = makeAssistantMessage([
            { type: 'tool_use', id: 'toolu-003', name: 'Monitor', input: { command: 'tail -f log.txt' } },
        ])
        const map = new Map()
        collectBackgroundToolUseIds(msg, map)
        expect(map.size).toBe(1)
        expect(map.get('toolu-003')).toBe('Monitor')
    })

    test('Bash 无 run_in_background 不收集', () => {
        const msg = makeAssistantMessage([
            { type: 'tool_use', id: 'toolu-004', name: 'Bash', input: { command: 'echo hello' } },
        ])
        const map = new Map()
        collectBackgroundToolUseIds(msg, map)
        expect(map.size).toBe(0)
    })

    test('Agent 无 run_in_background 不收集', () => {
        const msg = makeAssistantMessage([
            { type: 'tool_use', id: 'toolu-005', name: 'Agent', input: { prompt: '分析代码' } },
        ])
        const map = new Map()
        collectBackgroundToolUseIds(msg, map)
        expect(map.size).toBe(0)
    })

    test('run_in_background 为 false 不收集', () => {
        const msg = makeAssistantMessage([
            { type: 'tool_use', id: 'toolu-006', name: 'Bash', input: { command: 'echo', run_in_background: false } },
        ])
        const map = new Map()
        collectBackgroundToolUseIds(msg, map)
        expect(map.size).toBe(0)
    })

    test('非 assistant 消息不处理', () => {
        const msg = makeSystemMessage('task_started', { task_id: 'bt-001' })
        const map = new Map()
        collectBackgroundToolUseIds(msg, map)
        expect(map.size).toBe(0)
    })

    test('role:agent 包装的 assistant 消息能正确收集（回归）', () => {
        // CLI 将所有消息包装为 role:'agent'，data.type 才是实际消息类型
        const msg = {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: {
                        content: [
                            { type: 'tool_use', id: 'toolu-real', name: 'Agent', input: { prompt: '分析', run_in_background: true } },
                        ],
                    },
                },
            },
        }
        const map = new Map()
        collectBackgroundToolUseIds(msg, map)
        expect(map.size).toBe(1)
        expect(map.get('toolu-real')).toBe('Agent')
    })

    test('多个 tool_use blocks 混合收集', () => {
        const msg = makeAssistantMessage([
            { type: 'tool_use', id: 'toolu-bg', name: 'Bash', input: { command: 'sleep 10', run_in_background: true } },
            { type: 'tool_use', id: 'toolu-fg', name: 'Bash', input: { command: 'echo hi' } },
            { type: 'tool_use', id: 'toolu-agent', name: 'Agent', input: { prompt: '分析', run_in_background: true } },
            { type: 'tool_use', id: 'toolu-monitor', name: 'Monitor', input: { command: 'watch ps' } },
            { type: 'text', text: '说明文字' },
        ])
        const map = new Map()
        collectBackgroundToolUseIds(msg, map)
        expect(map.size).toBe(3)
        expect(map.get('toolu-bg')).toBe('Bash')
        expect(map.get('toolu-agent')).toBe('Agent')
        expect(map.get('toolu-monitor')).toBe('Monitor')
    })

    test('累加到已有 Map 中', () => {
        const map = new Map([['toolu-old', 'Bash'] as const])
        const msg = makeAssistantMessage([
            { type: 'tool_use', id: 'toolu-new', name: 'Agent', input: { prompt: 'x', run_in_background: true } },
        ])
        collectBackgroundToolUseIds(msg, map)
        expect(map.size).toBe(2)
    })

    test('无法解包的消息不做任何操作', () => {
        const map = new Map()
        collectBackgroundToolUseIds('not-an-object', map)
        collectBackgroundToolUseIds(null, map)
        collectBackgroundToolUseIds(undefined, map)
        expect(map.size).toBe(0)
    })

    test('未知工具名不收集', () => {
        const msg = makeAssistantMessage([
            { type: 'tool_use', id: 'toolu-x', name: 'Unknown', input: {} },
        ])
        const map = new Map()
        collectBackgroundToolUseIds(msg, map)
        expect(map.size).toBe(0)
    })
})

// ============ extractBackgroundTaskDeltasFromMessageContent 测试 ============

describe('extractBackgroundTaskDeltasFromMessageContent', () => {

    describe('task_started', () => {
        test('task_id 在 activeBackgroundTaskIds 中（background_tasks_changed 权威集合）→ 生成后台 delta', () => {
            const msg = makeSystemMessage('task_started', {
                task_id: 'bt-001',
                description: '后台构建',
                tool_use_id: 'tu-001',
            })
            const activeBg = new Set(['bt-001'])
            const result = extractBackgroundTaskDeltasFromMessageContent(msg, undefined, undefined, activeBg)
            expect(result).not.toBeNull()

            const delta = result as Extract<BackgroundTaskDelta, { type: 'started' }>
            expect(delta.task.taskId).toBe('bt-001')
            expect(delta.task.isBackground).toBe(true)
        })

        test('task_id 不在 activeBackgroundTaskIds 且无 run_in_background → 返回 null（前台任务，核心修复）', () => {
            // SDK 对所有 Bash/Agent 任务（无论前后台）都 emit task_started；
            // 前台任务（task_id 不在 background_tasks_changed 集合、tool_use 未显式后台）不得生成后台 delta
            const msg = makeSystemMessage('task_started', {
                task_id: 'bt-fg',
                description: '前台 Bash',
                tool_use_id: 'toolu-fg',
            })
            const activeBg = new Set(['bt-001'])
            const result = extractBackgroundTaskDeltasFromMessageContent(msg, undefined, undefined, activeBg)
            expect(result).toBeNull()
        })

        test('task_id 不在 activeBackgroundTaskIds 但 tool_use_id 命中 run_in_background → 生成后台 delta（重启兜底）', () => {
            // CLI 进程重启后 background_tasks_changed 不 emit，activeBackgroundTaskIds 为空；
            // 显式 run_in_background=true 的 tool_use 仍能兜底识别后台任务
            const msg = makeSystemMessage('task_started', {
                task_id: 'bt-002',
                description: '显式后台构建',
                tool_use_id: 'toolu-001',
            })
            const activeBg = new Set(['bt-001'])
            const bgMap = new Map([['toolu-001', 'Bash'] as const])
            const result = extractBackgroundTaskDeltasFromMessageContent(msg, bgMap, undefined, activeBg)
            expect(result).not.toBeNull()

            const delta = result as Extract<BackgroundTaskDelta, { type: 'started' }>
            expect(delta.task.taskId).toBe('bt-002')
            expect(delta.task.isBackground).toBe(true)
        })

        test('task_id 不在 activeBackgroundTaskIds 且 tool_use_id 不匹配 → 返回 null（前台）', () => {
            const msg = makeSystemMessage('task_started', {
                task_id: 'bt-fg2',
                description: '前台任务',
                tool_use_id: 'toolu-unknown',
            })
            const activeBg = new Set(['bt-001'])
            const bgMap = new Map([['toolu-bg', 'Bash'] as const])
            const result = extractBackgroundTaskDeltasFromMessageContent(msg, bgMap, undefined, activeBg)
            expect(result).toBeNull()
        })

        test('无 activeBackgroundTaskIds 时（仅靠 run_in_background 判定）生成 delta', () => {
            // activeBackgroundTaskIds 为 undefined（未接入 bg_changed 的调用方）：后台判定退化为
            // 仅依赖 run_in_background tool_use 命中，绝不无条件放行前台任务
            const msg = makeSystemMessage('task_started', {
                task_id: 'bt-001',
                description: '运行构建脚本',
                tool_use_id: 'tu-001',
            })
            const bgMap = new Map([['tu-001', 'Bash'] as const])
            const result = extractBackgroundTaskDeltasFromMessageContent(msg, bgMap)
            expect(result).not.toBeNull()
            expect(result!.type).toBe('started')

            const delta = result as Extract<BackgroundTaskDelta, { type: 'started' }>
            expect(delta.task.taskId).toBe('bt-001')
            expect(delta.task.toolName).toBe('Bash')
            expect(delta.task.isBackground).toBe(true)
        })

        test('无 activeBackgroundTaskIds 且 tool_use_id 未命中 run_in_background → 返回 null（前台）', () => {
            // activeBackgroundTaskIds 为 undefined + tool_use 未显式后台 → 前台任务不生成 delta
            const msg = makeSystemMessage('task_started', {
                task_id: 'bt-fg',
                description: '前台任务',
                tool_use_id: 'tu-001',
            })
            const bgMap = new Map([['tu-bg', 'Bash'] as const])
            const result = extractBackgroundTaskDeltasFromMessageContent(msg, bgMap)
            expect(result).toBeNull()
        })

        test('tool_use_id 在 backgroundToolUseIds 中且 task_id 在 activeBackgroundTaskIds 中 → 生成 delta', () => {
            const msg = makeSystemMessage('task_started', {
                task_id: 'bt-001',
                description: '后台构建',
                tool_use_id: 'toolu-001',
            })
            const bgMap = new Map([['toolu-001', 'Bash'] as const])
            const activeBg = new Set(['bt-001'])
            const result = extractBackgroundTaskDeltasFromMessageContent(msg, bgMap, undefined, activeBg)
            expect(result).not.toBeNull()

            const delta = result as Extract<BackgroundTaskDelta, { type: 'started' }>
            expect(delta.task.toolName).toBe('Bash')
            expect(delta.task.isBackground).toBe(true)
        })

        test('SDK 内部后台任务（无主 tool_use，仅靠 activeBackgroundTaskIds 识别）→ 生成 delta', () => {
            // /code-review custom command 的 background subagent 由 SDK 内部启动，
            // 无主 agent 的 tool_use（task_started.tool_use_id 为空），只能靠 background_tasks_changed 集合识别
            const msg = makeSystemMessage('task_started', {
                task_id: 'bt-003',
                description: 'code-review',
                subagent_type: 'code-reviewer',
            })
            const bgMap = new Map([['toolu-001', 'Bash'] as const])
            const activeBg = new Set(['bt-003'])
            const result = extractBackgroundTaskDeltasFromMessageContent(msg, bgMap, undefined, activeBg)
            expect(result).not.toBeNull()

            const delta = result as Extract<BackgroundTaskDelta, { type: 'started' }>
            expect(delta.task.taskId).toBe('bt-003')
            expect(delta.task.toolUseId).toBeNull()
            // toolName 由 subagent_type 兜底推断
            expect(delta.task.toolName).toBe('Agent')
            expect(delta.task.subagentType).toBe('code-reviewer')
            expect(delta.task.isBackground).toBe(true)
        })

        test('Agent 后台任务使用 backgroundToolUseIds 中的 toolName', () => {
            const msg = makeSystemMessage('task_started', {
                task_id: 'bt-004',
                description: '后台 Agent',
                tool_use_id: 'toolu-agent',
                subagent_type: 'researcher',
            })
            const bgMap = new Map([['toolu-agent', 'Agent'] as const])
            const activeBg = new Set(['bt-004'])
            const result = extractBackgroundTaskDeltasFromMessageContent(msg, bgMap, undefined, activeBg)

            const delta = result as Extract<BackgroundTaskDelta, { type: 'started' }>
            expect(delta.task.toolName).toBe('Agent')
            expect(delta.task.subagentType).toBe('researcher')
            expect(delta.task.isBackground).toBe(true)
        })

        test('Monitor 后台任务使用 backgroundToolUseIds 中的 toolName', () => {
            const msg = makeSystemMessage('task_started', {
                task_id: 'bt-005',
                description: 'Monitor watch',
                tool_use_id: 'toolu-monitor',
            })
            const bgMap = new Map([['toolu-monitor', 'Monitor'] as const])
            const activeBg = new Set(['bt-005'])
            const result = extractBackgroundTaskDeltasFromMessageContent(msg, bgMap, undefined, activeBg)

            const delta = result as Extract<BackgroundTaskDelta, { type: 'started' }>
            expect(delta.task.toolName).toBe('Monitor')
            expect(delta.task.isBackground).toBe(true)
        })

        test('有 subagent_type 且 task_id 在 activeBackgroundTaskIds 中 → 生成 Agent 类型 delta', () => {
            const msg = makeSystemMessage('task_started', {
                task_id: 'bt-002',
                description: '研究代码库结构',
                tool_use_id: 'tu-002',
                subagent_type: 'researcher',
            })
            const activeBg = new Set(['bt-002'])
            const result = extractBackgroundTaskDeltasFromMessageContent(msg, undefined, undefined, activeBg)
            expect(result).not.toBeNull()

            const delta = result as Extract<BackgroundTaskDelta, { type: 'started' }>
            expect(delta.task.taskId).toBe('bt-002')
            expect(delta.task.toolName).toBe('Agent')
            expect(delta.task.subagentType).toBe('researcher')
            expect(delta.task.isBackground).toBe(true)
        })
    })

    describe('task_progress', () => {
        test('taskId 在 knownTaskIds 中时生成 delta', () => {
            const msg = makeSystemMessage('task_progress', {
                task_id: 'bt-001',
                usage: { total_tokens: 500, tool_uses: 3, duration_ms: 12000 },
            })
            const knownTaskIds = new Set(['bt-001'])
            const result = extractBackgroundTaskDeltasFromMessageContent(msg, undefined, knownTaskIds)
            expect(result).not.toBeNull()

            const delta = result as Extract<BackgroundTaskDelta, { type: 'progress' }>
            expect(delta.taskId).toBe('bt-001')
            expect(delta.metrics.tokens).toBe(500)
        })

        test('taskId 不在 knownTaskIds 中时返回 null（前台任务）', () => {
            const msg = makeSystemMessage('task_progress', {
                task_id: 'bt-fg',
                usage: { total_tokens: 100 },
            })
            const knownTaskIds = new Set(['bt-001'])
            const result = extractBackgroundTaskDeltasFromMessageContent(msg, undefined, knownTaskIds)
            expect(result).toBeNull()
        })

        test('无 knownTaskIds 时（旧逻辑）仍生成 delta', () => {
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
        test('taskId 在 knownTaskIds 中时生成 delta', () => {
            const msg = makeSystemMessage('task_notification', {
                task_id: 'bt-001',
                status: 'completed',
                summary: '构建成功完成',
            })
            const knownTaskIds = new Set(['bt-001'])
            const result = extractBackgroundTaskDeltasFromMessageContent(msg, undefined, knownTaskIds)
            expect(result).not.toBeNull()

            const delta = result as Extract<BackgroundTaskDelta, { type: 'completed' }>
            expect(delta.taskId).toBe('bt-001')
            expect(delta.status).toBe('completed')
        })

        test('taskId 不在 knownTaskIds 中时返回 null（前台任务）', () => {
            const msg = makeSystemMessage('task_notification', {
                task_id: 'bt-fg',
                status: 'completed',
            })
            const knownTaskIds = new Set(['bt-001'])
            const result = extractBackgroundTaskDeltasFromMessageContent(msg, undefined, knownTaskIds)
            expect(result).toBeNull()
        })

        test('无 knownTaskIds 时（旧逻辑）仍生成 delta', () => {
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

// ============ extractBackgroundTaskIdsFromMessageContent 测试 ============

describe('extractBackgroundTaskIdsFromMessageContent', () => {
    /** 构造 background_tasks_changed 消息 */
    function makeBgChangedMessage(tasks: Array<Record<string, unknown>>) {
        return {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'system',
                    subtype: 'background_tasks_changed',
                    tasks,
                }
            }
        }
    }

    test('返回活跃后台任务 task_id 集合', () => {
        const msg = makeBgChangedMessage([
            { task_id: 'bt-001', task_type: 'local_bash', description: '构建' },
            { task_id: 'bt-002', task_type: 'local_agent', description: '研究' },
        ])
        const result = extractBackgroundTaskIdsFromMessageContent(msg)
        expect(result).not.toBeNull()
        expect(Array.from(result!).sort()).toEqual(['bt-001', 'bt-002'])
    })

    test('tasks 数组为空 → 返回空集合（replace 语义清空）', () => {
        const msg = makeBgChangedMessage([])
        const result = extractBackgroundTaskIdsFromMessageContent(msg)
        expect(result).not.toBeNull()
        expect(result!.size).toBe(0)
    })

    test('非 background_tasks_changed 消息 → 返回 null', () => {
        const msg = makeSystemMessage('task_started', { task_id: 'bt-001' })
        const result = extractBackgroundTaskIdsFromMessageContent(msg)
        expect(result).toBeNull()
    })

    test('task_id 缺失或非字符串时过滤', () => {
        const msg = makeBgChangedMessage([
            { task_id: 'bt-001', task_type: 'local_bash' },
            { task_type: 'local_agent' },          // 无 task_id
            { task_id: 123, task_type: 'local_bash' }, // 非字符串
        ])
        const result = extractBackgroundTaskIdsFromMessageContent(msg)
        expect(result).not.toBeNull()
        expect(Array.from(result!)).toEqual(['bt-001'])
    })

    test('无法解包的消息返回 null', () => {
        expect(extractBackgroundTaskIdsFromMessageContent('not-an-object')).toBeNull()
        expect(extractBackgroundTaskIdsFromMessageContent(null)).toBeNull()
    })
})

// ============ 批次 B：ambient 过滤 + is_backgrounded（spec D1/D2/D3）============

describe('ambient 过滤（批次 B）', () => {
    test('background_tasks_changed 集合不含 ambient 条目', () => {
        const msg = makeSystemMessage('background_tasks_changed', {
            tasks: [
                { task_id: 'bt-user', task_type: 'local_bash', description: '用户任务' },
                { task_id: 'bt-housekeep', task_type: 'local_bash', description: 'checkpoint', ambient: true },
            ],
        })
        const ids = extractBackgroundTaskIdsFromMessageContent(msg)
        expect(ids).not.toBeNull()
        expect(ids!.has('bt-user')).toBe(true)
        expect(ids!.has('bt-housekeep')).toBe(false)
    })

    test('ambient task_started 不创建 delta', () => {
        const msg = makeSystemMessage('task_started', {
            task_id: 'bt-housekeep', task_type: 'local_bash',
            description: 'checkpoint', ambient: true,
        })
        const delta = extractBackgroundTaskDeltasFromMessageContent(msg)
        expect(delta).toBeNull()
    })

    test('skip_transcript 但非 ambient 的条目不被过滤（语义边界，spec D2）', () => {
        const msg = makeSystemMessage('background_tasks_changed', {
            tasks: [{ task_id: 'bt-skip', task_type: 'local_bash', description: 'x', skip_transcript: true }],
        })
        const ids = extractBackgroundTaskIdsFromMessageContent(msg)
        expect(ids!.has('bt-skip')).toBe(true)
    })
})

describe('is_backgrounded 第三信号（批次 B，spec D3）', () => {
    test('两信号皆未命中但 is_backgrounded=true 时创建条目', () => {
        const msg = makeSystemMessage('task_started', {
            task_id: 'bt-explicit', task_type: 'local_agent',
            description: '后台 agent', is_backgrounded: true, subagent_type: 'Explore',
        })
        const delta = extractBackgroundTaskDeltasFromMessageContent(
            msg, new Map(), new Set(), new Set(),   // 空 backgroundToolUseIds / knownTaskIds / activeBackgroundTaskIds
        )
        expect(delta).not.toBeNull()
        expect(delta!.type).toBe('started')
        if (delta!.type === 'started') {
            expect(delta!.task.taskId).toBe('bt-explicit')
            expect(delta!.task.subagentType).toBe('Explore')
        }
    })

    test('is_backgrounded=false（显式前台）不创建条目', () => {
        const msg = makeSystemMessage('task_started', {
            task_id: 'bt-fg', task_type: 'local_agent',
            description: '前台', is_backgrounded: false,
        })
        const delta = extractBackgroundTaskDeltasFromMessageContent(msg, new Map(), new Set(), new Set())
        expect(delta).toBeNull()
    })
})

describe('task_updated 中途后台化补建（批次 B，spec D3）', () => {
    test('patch.is_backgrounded=true 且无终态 status → 补建 started delta（toolUseId=null）', () => {
        const msg = makeSystemMessage('task_updated', {
            task_id: 'bt-promoted',
            patch: { is_backgrounded: true, status: 'running' },
        })
        const delta = extractBackgroundTaskDeltasFromMessageContent(msg, new Map(), new Set())
        expect(delta).not.toBeNull()
        expect(delta!.type).toBe('started')
        if (delta!.type === 'started') {
            expect(delta!.task.toolUseId).toBeNull()
            expect(delta!.task.status).toBe('running')
            expect(delta!.task.isBackground).toBe(true)
        }
    })

    test('patch 带终态 status 时仍走既有 completed 分支，不补建', () => {
        const msg = makeSystemMessage('task_updated', {
            task_id: 'bt-done',
            patch: { is_backgrounded: true, status: 'completed' },
        })
        const delta = extractBackgroundTaskDeltasFromMessageContent(msg, new Map(), new Set())
        expect(delta).not.toBeNull()
        expect(delta!.type).toBe('completed')
    })

    test('无 patch.is_backgrounded 且无终态 → 维持 return null（现状不变）', () => {
        const msg = makeSystemMessage('task_updated', {
            task_id: 'bt-other', patch: { description: 'only desc' },
        })
        const delta = extractBackgroundTaskDeltasFromMessageContent(msg, new Map(), new Set())
        expect(delta).toBeNull()
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

    test('completed: 不存在的 task 创建最小终态条目', () => {
        const delta: BackgroundTaskDelta = {
            type: 'completed',
            taskId: 'bt-001',
            status: 'completed',
            summary: 'Task done',
        }
        const result = applyBackgroundTaskDelta(undefined, delta)
        expect(result).toHaveLength(1)
        expect(result[0].taskId).toBe('bt-001')
        expect(result[0].status).toBe('completed')
        expect(result[0].summary).toBe('Task done')
        expect(result[0].completedAt).toBeGreaterThan(0)
        // 兜底创建的最小终态条目也是后台任务
        expect(result[0].isBackground).toBe(true)
    })
})
