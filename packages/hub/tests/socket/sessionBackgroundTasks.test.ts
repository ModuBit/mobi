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
 * sessionHandlers message 处理的集成测试：验证 bg_changed → task_started 的后台任务接线。
 * 覆盖「组合判定」在真实处理链路上的行为：
 *   - bg_changed 先到 → task_started 命中集合 → 入 backgroundTasks（isBackground=true）
 *   - 前台 task_started（无 bg_changed、无 run_in_background）→ 不入 backgroundTasks
 *   - 显式 run_in_background 兜底（即使无 bg_changed）→ 入 backgroundTasks
 *   - 后台任务完成后自动清理
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import { registerSessionHandlers } from '../../src/socket/handlers/cli/sessionHandlers'
import type { SessionHandlersDeps } from '../../src/socket/handlers/cli/sessionHandlers'
import type { StoredMessage, StoredSession } from '../../src/store/types'
import type { SyncEvent } from '../../src/sync/syncEngine'
import type { RuntimeState } from '@mobi/shared/types'

const SID = 'test-session'

/** 构造最小 StoredSession */
function makeStoredSession(runtimeState: RuntimeState | null = null): StoredSession {
    return {
        id: SID, tag: null, namespace: 'default', machineId: null,
        createdAt: 1, updatedAt: 1, metadata: null, metadataVersion: 0,
        agentState: null, agentStateVersion: 0, runtimeState,
        runtimeStateUpdatedAt: null, projectId: null, seq: 1,
    }
}

/** 构造 system 消息内容 */
function makeSystemContent(subtype: string, extra: Record<string, unknown> = {}): unknown {
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

/** 构造 assistant 消息（含 tool_use block） */
function makeAssistantContent(blocks: Array<Record<string, unknown>>): unknown {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                message: { content: blocks },
            }
        }
    }
}

/**
 * 集成测试环境：真实 store.sessions 语义（getSession 返回同一引用，setRuntimeState 更新内存），
 * messages.addMessage 返回最小消息，socket 捕获 message handler。
 */
function makeEnv() {
    const session = makeStoredSession()
    const events: SyncEvent[] = []

    const deps: SessionHandlersDeps = {
        store: {
            sessions: {
                getSession: () => session,
                setRuntimeState: (id: string, runtimeState: unknown) => {
                    session.runtimeState = runtimeState as RuntimeState
                    return true
                },
            },
            messages: {
                addMessage: (): StoredMessage => ({
                    id: 'm1', sessionId: SID, content: {}, createdAt: 1, seq: 1,
                    localId: null, isSidechain: false, parentToolUseId: null,
                    category: 'persistent', submittedAt: null, queueState: 'pending', positionAt: 1,
                }),
            },
        } as unknown as SessionHandlersDeps['store'],
        resolveSessionAccess: () => ({ ok: true as const, value: session }),
        emitAccessError: () => {},
        onWebappEvent: (e: SyncEvent) => { events.push(e) },
    }

    // fake socket：捕获 message handler
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const socket = {
        on(event: string, handler: (...args: unknown[]) => void) { handlers.set(event, handler) },
        to() { return { emit() {} } },
        emit(event: string, ...args: unknown[]) { handlers.get(event)?.(...args) },
    }

    registerSessionHandlers(socket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

    return {
        env: { deps, session, events },
        sendMessage: (content: unknown) => {
            handlers.get('message')?.({ sid: SID, message: content })
        },
    }
}

/** 读取 session 的 runtimeState.backgroundTasks */
function bgTasksOf(session: StoredSession) {
    const rs = session.runtimeState as RuntimeState | null
    return rs?.backgroundTasks ?? []
}

describe('sessionHandlers 后台任务接线（bg_changed → task_started 组合判定）', () => {
    beforeEach(() => {
        // 每个测试独立环境由 makeEnv 创建
    })

    test('bg_changed 先到，task_started 命中集合 → 入 backgroundTasks（isBackground=true）', () => {
        const { sendMessage, env } = makeEnv()

        // 1. bg_changed 声明活跃后台集合
        sendMessage(makeSystemContent('background_tasks_changed', {
            tasks: [{ task_id: 'bt-001', task_type: 'local_agent', description: '后台研究' }],
        }))
        // 2. task_started 命中集合 → 判定为后台
        sendMessage(makeSystemContent('task_started', {
            task_id: 'bt-001',
            description: '后台研究',
            task_type: 'local_agent',
            subagent_type: 'researcher',
        }))

        const tasks = bgTasksOf(env.session)
        expect(tasks).toHaveLength(1)
        expect(tasks[0].taskId).toBe('bt-001')
        expect(tasks[0].isBackground).toBe(true)
        expect(tasks[0].toolName).toBe('Agent')
    })

    test('前台 task_started（无 bg_changed 对应、无 run_in_background）→ 不入 backgroundTasks', () => {
        const { sendMessage, env } = makeEnv()

        // 前台 Bash：task_started 有，但 bg_changed 从未声明它
        sendMessage(makeSystemContent('task_started', {
            task_id: 'bt-fg',
            description: '前台 Bash',
            task_type: 'local_bash',
            tool_use_id: 'toolu-fg',
        }))

        expect(bgTasksOf(env.session)).toHaveLength(0)
    })

    test('显式 run_in_background 兜底：即使无 bg_changed 也判后台（CLI 重启场景）', () => {
        const { sendMessage, env } = makeEnv()

        // assistant 消息声明 run_in_background=true 的 Bash tool_use
        sendMessage(makeAssistantContent([
            { type: 'tool_use', id: 'toolu-bg', name: 'Bash', input: { command: 'sleep 60', run_in_background: true } },
        ]))
        // task_started：无 bg_changed，但 tool_use_id 命中 run_in_background
        sendMessage(makeSystemContent('task_started', {
            task_id: 'bt-002',
            description: 'sleep 60',
            task_type: 'local_bash',
            tool_use_id: 'toolu-bg',
        }))

        const tasks = bgTasksOf(env.session)
        expect(tasks).toHaveLength(1)
        expect(tasks[0].taskId).toBe('bt-002')
        expect(tasks[0].isBackground).toBe(true)
        expect(tasks[0].toolName).toBe('Bash')
    })

    test('后台任务完成：task_notification 标记终态，随后 backgroundTasks 自动清理', () => {
        const { sendMessage, env } = makeEnv()

        // 启动后台任务
        sendMessage(makeSystemContent('background_tasks_changed', {
            tasks: [{ task_id: 'bt-001', task_type: 'local_bash', description: '构建' }],
        }))
        sendMessage(makeSystemContent('task_started', {
            task_id: 'bt-001',
            description: '构建',
            task_type: 'local_bash',
        }))
        expect(bgTasksOf(env.session)).toHaveLength(1)

        // 完成：bg_changed 移除该任务 + task_notification 终态
        sendMessage(makeSystemContent('background_tasks_changed', { tasks: [] }))
        sendMessage(makeSystemContent('task_notification', {
            task_id: 'bt-001',
            status: 'completed',
            summary: '构建完成',
        }))

        // 完成后 backgroundTasks 应被自动清理（全部终态 → 清空）
        expect(bgTasksOf(env.session)).toHaveLength(0)
    })

    test('后台任务完成通知乱序到达（task_notification 早于 bg_changed 移除）仍能正确终态', () => {
        const { sendMessage, env } = makeEnv()

        // 启动后台任务
        sendMessage(makeSystemContent('background_tasks_changed', {
            tasks: [{ task_id: 'bt-001', task_type: 'local_bash', description: '构建' }],
        }))
        sendMessage(makeSystemContent('task_started', {
            task_id: 'bt-001',
            description: '构建',
            task_type: 'local_bash',
        }))

        // task_notification 先到（backgroundTaskIds 仍有该任务）→ 标记终态
        sendMessage(makeSystemContent('task_notification', {
            task_id: 'bt-001',
            status: 'completed',
        }))
        // bg_changed 后到，移除活跃集合
        sendMessage(makeSystemContent('background_tasks_changed', { tasks: [] }))

        expect(bgTasksOf(env.session)).toHaveLength(0)
    })
})
