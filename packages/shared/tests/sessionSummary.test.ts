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
import type { Session } from '../src/schemas'
import { toSessionSummary } from '../src/sessionSummary'

/** 构建最小合法 Session 对象 */
function makeSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 0,
        createdAt: 1000,
        updatedAt: 2000,
        active: true,
        activeAt: 1500,
        metadata: null,
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        running: false,
        runningAt: 0,
        ...overrides,
    }
}

describe('toSessionSummary', () => {
    it('最小 session 正确转换', () => {
        const session = makeSession()
        const summary = toSessionSummary(session)

        expect(summary.id).toBe('session-1')
        expect(summary.active).toBe(true)
        expect(summary.running).toBe(false)
        expect(summary.activeAt).toBe(1500)
        expect(summary.updatedAt).toBe(2000)
        expect(summary.metadata).toBeNull()
        expect(summary.todoProgress).toBeNull()
        expect(summary.pendingRequestsCount).toBe(0)
    })

    it('含 agentState.requests 正确计算 pendingRequestsCount', () => {
        const session = makeSession({
            agentState: {
                requests: {
                    req1: { tool: 'Read', arguments: { path: '/foo' }, createdAt: null },
                    req2: { tool: 'Write', arguments: { path: '/bar' }, createdAt: null },
                    req3: { tool: 'Bash', arguments: { command: 'ls' }, createdAt: null },
                },
            },
        })
        const summary = toSessionSummary(session)
        expect(summary.pendingRequestsCount).toBe(3)
    })

    it('agentState.requests 为空对象时 pendingRequestsCount 为 0', () => {
        const session = makeSession({
            agentState: { requests: {} },
        })
        const summary = toSessionSummary(session)
        expect(summary.pendingRequestsCount).toBe(0)
    })

    it('含 runtimeState.todos 正确计算 todoProgress', () => {
        const session = makeSession({
            runtimeState: {
                todos: [
                    { content: '任务1', status: 'completed', priority: 'high', id: '1' },
                    { content: '任务2', status: 'in_progress', priority: 'medium', id: '2' },
                    { content: '任务3', status: 'pending', priority: 'low', id: '3' },
                    { content: '任务4', status: 'completed', priority: 'high', id: '4' },
                ],
            },
        })
        const summary = toSessionSummary(session)
        expect(summary.todoProgress).toEqual({ completed: 2, total: 4 })
    })

    it('runtimeState.todos 为空数组时 todoProgress 为 null', () => {
        const session = makeSession({
            runtimeState: { todos: [] },
        })
        const summary = toSessionSummary(session)
        expect(summary.todoProgress).toBeNull()
    })

    it('含 metadata 正确提取字段', () => {
        const session = makeSession({
            metadata: {
                path: '/project',
                host: 'localhost',
                name: 'my-project',
                machineId: 'machine-1',
                summary: { text: '项目摘要', updatedAt: 1000 },
                flavor: 'claude',
                worktree: {
                    basePath: '/project',
                    branch: 'main',
                    name: 'wt-1',
                },
            },
        })
        const summary = toSessionSummary(session)
        expect(summary.metadata).not.toBeNull()
        expect(summary.metadata!.name).toBe('my-project')
        expect(summary.metadata!.path).toBe('/project')
        expect(summary.metadata!.machineId).toBe('machine-1')
        expect(summary.metadata!.summary).toEqual({ text: '项目摘要' })
        expect(summary.metadata!.flavor).toBe('claude')
        expect(summary.metadata!.worktree?.branch).toBe('main')
    })

    it('metadata 中无 machineId 时为 undefined', () => {
        const session = makeSession({
            metadata: {
                path: '/project',
                host: 'localhost',
            },
        })
        const summary = toSessionSummary(session)
        expect(summary.metadata!.machineId).toBeUndefined()
    })

    it('含 model 正确提取', () => {
        const session = makeSession({
            runtimeState: { model: 'claude-sonnet-4-20250514' },
        })
        const summary = toSessionSummary(session)
        expect(summary.model).toBe('claude-sonnet-4-20250514')
    })

    it('含 mode 正确提取', () => {
        const session = makeSession({ mode: 'remote' })
        const summary = toSessionSummary(session)
        expect(summary.mode).toBe('remote')
    })

    it('不含 mode 时 mode 为 undefined', () => {
        const session = makeSession()
        const summary = toSessionSummary(session)
        expect(summary.mode).toBeUndefined()
    })

    it('含 runtimeState.tasks 正确计算 taskProgress', () => {
        const session = makeSession({
            runtimeState: {
                tasks: [
                    { id: 't1', subject: '任务1', status: 'completed' },
                    { id: 't2', subject: '任务2', status: 'in_progress' },
                    { id: 't3', subject: '任务3', status: 'pending' },
                    { id: 't4', subject: '任务4', status: 'completed' },
                ],
            },
        })
        const summary = toSessionSummary(session)
        expect(summary.taskProgress).toEqual({ completed: 2, total: 4 })
    })

    it('runtimeState.tasks 为空数组时 taskProgress 为 null', () => {
        const session = makeSession({
            runtimeState: { tasks: [] },
        })
        const summary = toSessionSummary(session)
        expect(summary.taskProgress).toBeNull()
    })

    it('含 projectId 时透传——Web 取消置顶后据此回填原项目分组', () => {
        const summary = toSessionSummary(makeSession({ projectId: 'p1' }))
        expect(summary.projectId).toBe('p1')
    })

    it('projectId 为 null（游离）或缺失时归一为 null，不残留 undefined', () => {
        expect(toSessionSummary(makeSession({ projectId: null })).projectId).toBeNull()
        expect(toSessionSummary(makeSession()).projectId).toBeNull()
    })
})
