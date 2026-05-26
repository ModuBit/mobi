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
import {
    PermissionModeSchema,
    DecryptedMessageSchema,
    MetadataSchema,
    SessionSchema,
    SyncEventSchema,
    BackgroundTaskItemSchema,
    RuntimeStateSchema,
} from '../src/schemas'

describe('PermissionModeSchema', () => {
    it('合法模式解析成功', () => {
        expect(PermissionModeSchema.parse('default')).toBe('default')
        expect(PermissionModeSchema.parse('acceptEdits')).toBe('acceptEdits')
        expect(PermissionModeSchema.parse('bypassPermissions')).toBe('bypassPermissions')
        expect(PermissionModeSchema.parse('plan')).toBe('plan')
    })

    it('非法模式抛错', () => {
        expect(() => PermissionModeSchema.parse('invalid')).toThrow()
        expect(() => PermissionModeSchema.parse('')).toThrow()
        expect(() => PermissionModeSchema.parse(123)).toThrow()
    })
})

describe('DecryptedMessageSchema', () => {
    it('合法消息解析成功', () => {
        const msg = {
            id: 'msg-1',
            seq: 1,
            localId: 'local-1',
            content: 'hello',
            createdAt: 1000,
        }
        const result = DecryptedMessageSchema.parse(msg)
        expect(result.id).toBe('msg-1')
        expect(result.seq).toBe(1)
        expect(result.content).toBe('hello')
    })

    it('seq 和 localId 允许 null', () => {
        const msg = {
            id: 'msg-2',
            seq: null,
            localId: null,
            content: { text: 'hello' },
            createdAt: 1000,
        }
        const result = DecryptedMessageSchema.parse(msg)
        expect(result.seq).toBeNull()
        expect(result.localId).toBeNull()
    })

    it('缺少必填字段抛错', () => {
        // 缺少 id
        expect(() => DecryptedMessageSchema.parse({
            seq: 1,
            localId: null,
            content: 'hello',
            createdAt: 1000,
        })).toThrow()

        // 缺少 createdAt（必填 number 字段）
        expect(() => DecryptedMessageSchema.parse({
            id: 'msg-1',
            seq: 1,
            localId: null,
            content: 'hello',
        })).toThrow()
    })
})

describe('MetadataSchema', () => {
    it('完整元数据解析成功', () => {
        const meta = {
            path: '/project',
            host: 'localhost',
            version: '1.0.0',
            name: 'my-project',
            os: 'linux',
            summary: { text: '测试摘要', updatedAt: 1000 },
            machineId: 'machine-1',
            claudeSessionId: 'session-1',
            tools: ['tool1', 'tool2'],
        }
        const result = MetadataSchema.parse(meta)
        expect(result.path).toBe('/project')
        expect(result.host).toBe('localhost')
        expect(result.version).toBe('1.0.0')
        expect(result.name).toBe('my-project')
        expect(result.summary?.text).toBe('测试摘要')
    })

    it('仅 path + host 解析成功', () => {
        const meta = { path: '/project', host: 'localhost' }
        const result = MetadataSchema.parse(meta)
        expect(result.path).toBe('/project')
        expect(result.host).toBe('localhost')
        // 可选字段应为 undefined
        expect(result.version).toBeUndefined()
        expect(result.name).toBeUndefined()
    })

    it('缺少必填字段抛错', () => {
        // 缺少 host
        expect(() => MetadataSchema.parse({ path: '/project' })).toThrow()
        // 缺少 path
        expect(() => MetadataSchema.parse({ host: 'localhost' })).toThrow()
        // 空对象
        expect(() => MetadataSchema.parse({})).toThrow()
    })

    it('解析包含 gitBranch 的完整 metadata', () => {
        const metadata = {
            path: '/home/user/project',
            host: 'myhost',
            gitBranch: 'feature/auth',
        }
        const result = MetadataSchema.parse(metadata)
        expect(result.gitBranch).toBe('feature/auth')
    })

    it('gitBranch 可选，缺失时不报错', () => {
        const metadata = {
            path: '/home/user/project',
            host: 'myhost',
        }
        const result = MetadataSchema.parse(metadata)
        expect(result.gitBranch).toBeUndefined()
    })

    it('gitBranch 为 undefined 时不报错', () => {
        const metadata = {
            path: '/home/user/project',
            host: 'myhost',
            gitBranch: undefined,
        }
        const result = MetadataSchema.parse(metadata)
        expect(result.gitBranch).toBeUndefined()
    })
})

describe('SessionSchema', () => {
    /** 构建最小合法 session 对象 */
    function makeMinimal(overrides: Record<string, unknown> = {}) {
        return {
            id: 'session-1',
            namespace: 'default',
            seq: 0,
            createdAt: 1000,
            updatedAt: 1000,
            active: true,
            activeAt: 1000,
            metadata: null,
            metadataVersion: 0,
            agentState: null,
            agentStateVersion: 0,
            running: false,
            runningAt: 0,
            ...overrides,
        }
    }

    it('最小合法 session 解析成功', () => {
        const session = makeMinimal()
        const result = SessionSchema.parse(session)
        expect(result.id).toBe('session-1')
        expect(result.active).toBe(true)
        expect(result.metadata).toBeNull()
        expect(result.agentState).toBeNull()
    })

    it('含完整元数据解析成功', () => {
        const session = makeMinimal({
            metadata: {
                path: '/project',
                host: 'localhost',
                name: 'my-project',
                version: '1.0.0',
            },
            permissionMode: 'default',
            mode: 'local',
        })
        const result = SessionSchema.parse(session)
        expect(result.metadata?.name).toBe('my-project')
        expect(result.permissionMode).toBe('default')
        expect(result.mode).toBe('local')
    })

    it('缺少必填字段抛错', () => {
        // 缺少 id
        expect(() => SessionSchema.parse(makeMinimal({ id: undefined }))).toThrow()
        // 缺少 namespace
        expect(() => SessionSchema.parse(makeMinimal({ namespace: undefined }))).toThrow()
        // 缺少 active
        expect(() => SessionSchema.parse(makeMinimal({ active: undefined }))).toThrow()
    })
})

describe('SyncEventSchema', () => {
    it('session-added 事件解析成功', () => {
        const event = {
            type: 'session-added',
            sessionId: 'session-1',
            namespace: 'default',
        }
        const result = SyncEventSchema.parse(event)
        expect(result.type).toBe('session-added')
        if (result.type === 'session-added') {
            expect(result.sessionId).toBe('session-1')
        }
    })

    it('message-received 事件解析成功', () => {
        const event = {
            type: 'message-received',
            sessionId: 'session-1',
            message: {
                id: 'msg-1',
                seq: 1,
                localId: null,
                content: 'hello',
                createdAt: 1000,
            },
        }
        const result = SyncEventSchema.parse(event)
        expect(result.type).toBe('message-received')
        if (result.type === 'message-received') {
            expect(result.message.id).toBe('msg-1')
        }
    })

    it('heartbeat 事件解析成功', () => {
        const event = {
            type: 'heartbeat',
            data: { timestamp: 1000 },
        }
        const result = SyncEventSchema.parse(event)
        expect(result.type).toBe('heartbeat')
    })

    it('heartbeat 事件无 data 也解析成功', () => {
        const event = { type: 'heartbeat' }
        const result = SyncEventSchema.parse(event)
        expect(result.type).toBe('heartbeat')
    })

    it('非法类型抛错', () => {
        expect(() => SyncEventSchema.parse({ type: 'unknown-event' })).toThrow()
    })

    it('缺少 type 字段抛错', () => {
        expect(() => SyncEventSchema.parse({ sessionId: 'session-1' })).toThrow()
    })
})

describe('BackgroundTaskItemSchema', () => {
    it('解析有效的 background task', () => {
        const task = {
            taskId: 'bg-1',
            toolName: 'Bash',
            description: 'npm test',
            status: 'running',
            startedAt: Date.now(),
        }
        const result = BackgroundTaskItemSchema.parse(task)
        expect(result.taskId).toBe('bg-1')
        expect(result.toolName).toBe('Bash')
    })

    it('解析含可选字段的 background task', () => {
        const task = {
            taskId: 'bg-2',
            toolName: 'Agent',
            description: 'researcher',
            subagentType: 'Explore',
            status: 'running',
            metrics: { tokens: 100, toolUses: 3, durationMs: 5000 },
            startedAt: Date.now(),
        }
        const result = BackgroundTaskItemSchema.parse(task)
        expect(result.metrics?.tokens).toBe(100)
    })
})

describe('RuntimeStateSchema with backgroundTasks', () => {
    it('包含 backgroundTasks 字段', () => {
        const state = {
            backgroundTasks: [
                { taskId: 'bg-1', toolName: 'Bash', description: 'test', status: 'running', startedAt: 0 },
            ],
        }
        const result = RuntimeStateSchema.parse(state)
        expect(result.backgroundTasks).toHaveLength(1)
    })

    it('backgroundTasks 可选', () => {
        const result = RuntimeStateSchema.parse({})
        expect(result.backgroundTasks).toBeUndefined()
    })
})
