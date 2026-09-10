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

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { RuntimeState } from '@mobi/shared/types'

import { Store } from '../../src/store'
import { BackgroundTaskTracker } from '../../src/sync/backgroundTaskTracker'
import { SessionMessageRuntimeProjector } from '../../src/sync/sessionMessageRuntimeProjector'

function makeSystemContent(subtype: string, extra: Record<string, unknown> = {}): unknown {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: { type: 'system', subtype, ...extra },
        },
    }
}

function makeAssistantContent(blocks: Array<Record<string, unknown>>): unknown {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                message: { content: blocks },
            },
        },
    }
}

function makeUserContent(blocks: Array<Record<string, unknown>>): unknown {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'user',
                message: { content: blocks },
            },
        },
    }
}

describe('SessionMessageRuntimeProjector', () => {
    let store: Store
    let sessionId: string
    let projector: SessionMessageRuntimeProjector

    beforeEach(() => {
        store = new Store(':memory:')
        sessionId = store.sessions.getOrCreateSession(
            'runtime-projector',
            { path: '/tmp/projector' },
            null,
            'default',
        ).id
        projector = new SessionMessageRuntimeProjector(store, new BackgroundTaskTracker(), {
            now: () => 1_750_000_000_000,
        })
    })

    afterEach(() => {
        store.close()
    })

    function project(content: unknown): RuntimeState[] {
        return projector.project({ sessionId, namespace: 'default', content })
    }

    function storedRuntimeState(): RuntimeState | null {
        return store.sessions.getSession(sessionId)?.runtimeState as RuntimeState | null
    }

    test('Agent tool_use 与 tool_result 跨消息配对，并在全部完成后清除 teamState', () => {
        const started = project(makeAssistantContent([
            {
                type: 'tool_use',
                id: 'tu-1',
                name: 'Agent',
                input: { name: 'analyzer', description: '分析任务' },
            },
        ]))

        expect(started).toHaveLength(1)
        expect(started[0]?.teamState?.members?.[0]).toMatchObject({
            name: 'analyzer',
            status: 'running',
            toolUseIds: ['tu-1'],
        })

        const completed = project(makeUserContent([
            { type: 'tool_result', tool_use_id: 'tu-1', content: 'done' },
        ]))

        expect(completed).toHaveLength(1)
        expect(completed[0]?.teamState).toBeUndefined()
        expect(storedRuntimeState()?.teamState).toBeUndefined()
    })

    test('多个 teammate 仅完成其中一个时保留其余运行成员', () => {
        project(makeAssistantContent([
            {
                type: 'tool_use',
                id: 'tu-1',
                name: 'Agent',
                input: { name: 'analyzer', description: '分析' },
            },
            {
                type: 'tool_use',
                id: 'tu-2',
                name: 'Agent',
                input: { name: 'coder', description: '编码' },
            },
        ]))

        const publications = project(makeUserContent([
            { type: 'tool_result', tool_use_id: 'tu-1', content: 'done' },
        ]))

        const members = publications[0]?.teamState?.members
        expect(members?.find(member => member.name === 'analyzer')?.status).toBe('completed')
        expect(members?.find(member => member.name === 'coder')?.status).toBe('running')
    })

    test('background_tasks_changed 先到时，task_started 被识别为后台任务', () => {
        project(makeSystemContent('background_tasks_changed', {
            tasks: [{ task_id: 'bt-1', task_type: 'local_agent', description: '后台研究' }],
        }))

        const publications = project(makeSystemContent('task_started', {
            task_id: 'bt-1',
            task_type: 'local_agent',
            description: '后台研究',
            subagent_type: 'researcher',
        }))

        expect(publications).toHaveLength(1)
        expect(publications[0]?.backgroundTasks?.[0]).toMatchObject({
            taskId: 'bt-1',
            isBackground: true,
            toolName: 'Agent',
            status: 'running',
        })
    })

    test('未被后台集合或 run_in_background 声明的 task_started 不会建立后台任务', () => {
        const publications = project(makeSystemContent('task_started', {
            task_id: 'bt-foreground',
            task_type: 'local_bash',
            description: '前台 Bash',
            tool_use_id: 'toolu-foreground',
        }))

        expect(publications).toEqual([])
        expect(storedRuntimeState()?.backgroundTasks).toBeUndefined()
    })

    test('run_in_background 可在缺少 background_tasks_changed 时识别后台任务', () => {
        project(makeAssistantContent([
            {
                type: 'tool_use',
                id: 'toolu-bg',
                name: 'Bash',
                input: { command: 'sleep 60', run_in_background: true },
            },
        ]))

        const publications = project(makeSystemContent('task_started', {
            task_id: 'bt-explicit',
            task_type: 'local_bash',
            description: 'sleep 60',
            tool_use_id: 'toolu-bg',
        }))

        expect(publications[0]?.backgroundTasks?.[0]).toMatchObject({
            taskId: 'bt-explicit',
            isBackground: true,
            toolName: 'Bash',
        })
    })

    test('后台任务结束时先发布终态，再发布清空状态', () => {
        project(makeSystemContent('background_tasks_changed', {
            tasks: [{ task_id: 'bt-1', task_type: 'local_bash', description: '构建' }],
        }))
        project(makeSystemContent('task_started', {
            task_id: 'bt-1',
            task_type: 'local_bash',
            description: '构建',
        }))
        project(makeSystemContent('background_tasks_changed', { tasks: [] }))

        const publications = project(makeSystemContent('task_notification', {
            task_id: 'bt-1',
            status: 'completed',
            summary: '构建完成',
        }))

        expect(publications).toHaveLength(2)
        expect(publications[0]?.backgroundTasks?.[0]).toMatchObject({
            taskId: 'bt-1',
            status: 'completed',
        })
        expect(publications[1]?.backgroundTasks).toBeUndefined()
        expect(storedRuntimeState()?.backgroundTasks).toBeUndefined()
    })

    test('task_notification 早于后台集合移除时仍能收敛为终态', () => {
        project(makeSystemContent('background_tasks_changed', {
            tasks: [{ task_id: 'bt-1', task_type: 'local_bash', description: '构建' }],
        }))
        project(makeSystemContent('task_started', {
            task_id: 'bt-1',
            task_type: 'local_bash',
            description: '构建',
        }))

        const publications = project(makeSystemContent('task_notification', {
            task_id: 'bt-1',
            status: 'completed',
        }))
        project(makeSystemContent('background_tasks_changed', { tasks: [] }))

        expect(publications[0]?.backgroundTasks?.[0]?.status).toBe('completed')
        expect(publications.at(-1)?.backgroundTasks).toBeUndefined()
        expect(storedRuntimeState()?.backgroundTasks).toBeUndefined()
    })

    test('无运行状态变化的普通消息不写库、不产生发布', () => {
        const seqBefore = store.sessions.getSession(sessionId)?.seq

        const publications = project({ role: 'user', content: 'hello' })

        expect(publications).toEqual([])
        expect(store.sessions.getSession(sessionId)?.seq).toBe(seqBefore)
    })

    test('存储层拒绝 namespace 不匹配的写入时不产生发布', () => {
        const publications = projector.project({
            sessionId,
            namespace: 'other',
            content: makeAssistantContent([
                {
                    type: 'tool_use',
                    id: 'tu-1',
                    name: 'Agent',
                    input: { name: 'analyzer', description: '分析任务' },
                },
            ]),
        })

        expect(publications).toEqual([])
        expect(store.sessions.getSession(sessionId)?.runtimeState).toBeNull()
    })
})
