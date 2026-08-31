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
    extractLiveBackgroundTaskIds,
    RuntimeStateSchema,
    ContextUsageSchema,
    PermissionUpdateSchema,
    AgentStateRequestSchema,
    GoalStatusSchema,
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

    it('accepts lifecycleAt null and number', () => {
        const base = { id: 'm1', seq: 1, localId: null, content: {}, createdAt: 0 }
        expect(DecryptedMessageSchema.parse({ ...base, lifecycle: 'queued', lifecycleAt: null }).lifecycleAt).toBeNull()
        expect(DecryptedMessageSchema.parse({ ...base, lifecycle: 'queued', lifecycleAt: 123 }).lifecycleAt).toBe(123)
    })

    it('defaults lifecycle/lifecycleAt to undefined when absent (optional)', () => {
        const parsed = DecryptedMessageSchema.parse({ id: 'm1', seq: 1, localId: null, content: {}, createdAt: 0 })
        expect(parsed.lifecycle).toBeUndefined()
        expect(parsed.lifecycleAt).toBeUndefined()
    })

    it('使用 lifecycleAt 而非 invokedAt', () => {
        const msg = {
            id: 'm1',
            seq: 1,
            localId: null,
            content: { role: 'user', content: { type: 'text', text: 'hi' } },
            createdAt: 1000,
            lifecycle: 'queued',
            lifecycleAt: 2000,
        }
        const parsed = DecryptedMessageSchema.safeParse(msg)
        expect(parsed.success).toBe(true)
        expect((parsed.success ? parsed.data.lifecycleAt : null)).toBe(2000)
    })

    it('lifecycleAt 可空可缺省', () => {
        const parsed = DecryptedMessageSchema.safeParse({
            id: 'm1', seq: null, localId: null, createdAt: 1,
            content: { role: 'user', content: { type: 'text', text: '' } },
        })
        expect(parsed.success).toBe(true)
    })

    it('DecryptedMessage lifecycle 字段：合法值解析、非法值拒收', () => {
        for (const lifecycle of ['queued', 'pushed', 'acked', 'processing', 'done', 'cancelled', 'discarded', 'withdrawn'] as const) {
            const msg = DecryptedMessageSchema.parse({
                id: 'm1', seq: null, localId: null,
                lifecycle, lifecycleAt: 123,
                content: {}, createdAt: 1,
            })
            expect(msg.lifecycle).toBe(lifecycle)
            expect(msg.lifecycleAt).toBe(123)
        }
        expect(() => DecryptedMessageSchema.parse({
            id: 'm1', seq: null, localId: null, lifecycle: 'pending',
            content: {}, createdAt: 1,
        })).toThrow()
    })

    it('DecryptedMessage 旧字段 queueState/submittedAt 已退役（zod strip）', () => {
        const msg = DecryptedMessageSchema.parse({
            id: 'm1', seq: null, localId: null,
            queueState: 'pending', submittedAt: 5,
            content: {}, createdAt: 1,
        } as Record<string, unknown>)
        expect('queueState' in msg).toBe(false)
        expect('submittedAt' in msg).toBe(false)
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
            nativeSessionId: 'session-1',
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

describe('SyncEventSchema messages-submitted', () => {
    it('parses messages-submitted event', () => {
        const evt = { type: 'messages-submitted', sessionId: 's1', localIds: ['a', 'b'], submittedAt: 999 }
        const parsed = SyncEventSchema.parse(evt)
        expect(parsed.type).toBe('messages-submitted')
        if (parsed.type === 'messages-submitted') {
            expect(parsed.localIds).toEqual(['a', 'b'])
            expect(parsed.submittedAt).toBe(999)
        }
    })

    it('解析 messages-submitted 事件', () => {
        const parsed = SyncEventSchema.safeParse({
            type: 'messages-submitted',
            sessionId: 's1',
            localIds: ['a', 'b'],
            submittedAt: 1234,
        })
        expect(parsed.success).toBe(true)
    })
})

describe('BackgroundTaskItemSchema', () => {
    it('解析有效的 background task', () => {
        const task = {
            taskId: 'bg-1',
            toolName: 'Bash',
            description: 'npm test',
            status: 'running',
            isBackground: true,
            startedAt: Date.now(),
        }
        const result = BackgroundTaskItemSchema.parse(task)
        expect(result.taskId).toBe('bg-1')
        expect(result.toolName).toBe('Bash')
        expect(result.isBackground).toBe(true)
    })

    it('解析含可选字段的 background task', () => {
        const task = {
            taskId: 'bg-2',
            toolName: 'Agent',
            description: 'researcher',
            subagentType: 'Explore',
            status: 'running',
            isBackground: true,
            metrics: { tokens: 100, toolUses: 3, durationMs: 5000 },
            startedAt: Date.now(),
        }
        const result = BackgroundTaskItemSchema.parse(task)
        expect(result.metrics?.tokens).toBe(100)
        expect(result.isBackground).toBe(true)
    })

    it('缺少 isBackground 时默认 true（兼容存量 DB 记录）', () => {
        const task = {
            taskId: 'bg-3',
            toolName: 'Bash',
            description: 'test',
            status: 'running',
            startedAt: Date.now(),
        }
        const result = BackgroundTaskItemSchema.parse(task)
        expect(result.isBackground).toBe(true)
    })
})

describe('RuntimeStateSchema with backgroundTasks', () => {
    it('包含 backgroundTasks 字段', () => {
        const state = {
            backgroundTasks: [
                { taskId: 'bg-1', toolName: 'Bash', description: 'test', status: 'running', isBackground: true, startedAt: 0 },
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

describe('ContextUsageSchema', () => {
    const validUsage = {
        totalTokens: 124000,
        maxTokens: 200000,
        percentage: 62,
        costUsd: 0.043,
    }

    it('合法用量解析成功并保留全部字段', () => {
        const result = ContextUsageSchema.parse(validUsage)
        expect(result.totalTokens).toBe(124000)
        expect(result.maxTokens).toBe(200000)
        expect(result.percentage).toBe(62)
        expect(result.costUsd).toBe(0.043)
    })

    it('缺少必填字段抛错', () => {
        expect(() => ContextUsageSchema.parse({ totalTokens: 1 })).toThrow()
    })

    it('不接受已废弃的 categories / autoCompactThreshold 等字段（静默忽略）', () => {
        // 重设计后这些字段不再属于 schema；parse 仍成功（zod 默认 strip），但结果不含它们
        const result = ContextUsageSchema.parse({
            ...validUsage,
            categories: [{ name: 'x', tokens: 1 }],
            autoCompactThreshold: 78,
            isAutoCompactEnabled: true,
        } as Record<string, unknown>)
        expect((result as Record<string, unknown>).categories).toBeUndefined()
        expect((result as Record<string, unknown>).autoCompactThreshold).toBeUndefined()
    })
})

describe('RuntimeStateSchema with contextUsage', () => {
    it('包含 contextUsage 字段', () => {
        const state = {
            contextUsage: { totalTokens: 100, maxTokens: 200, percentage: 50, costUsd: 0 },
        }
        const result = RuntimeStateSchema.parse(state)
        expect(result.contextUsage?.percentage).toBe(50)
    })

    it('contextUsage 可选', () => {
        const result = RuntimeStateSchema.parse({})
        expect(result.contextUsage).toBeUndefined()
    })
})

describe('PermissionUpdateSchema', () => {
    it('解析 addRules + session destination', () => {
        const update = {
            type: 'addRules',
            rules: [{ toolName: 'Bash', ruleContent: 'git:*' }],
            behavior: 'allow',
            destination: 'session',
        }
        expect(PermissionUpdateSchema.safeParse(update).success).toBe(true)
    })

    it('解析 setMode + projectSettings destination', () => {
        const update = { type: 'setMode', mode: 'acceptEdits', destination: 'projectSettings' }
        expect(PermissionUpdateSchema.safeParse(update).success).toBe(true)
    })

    it('解析 addDirectories', () => {
        const update = { type: 'addDirectories', directories: ['/tmp'], destination: 'localSettings' }
        expect(PermissionUpdateSchema.safeParse(update).success).toBe(true)
    })

    it('拒绝未知 destination', () => {
        const update = { type: 'addRules', rules: [], behavior: 'allow', destination: 'nowhere' }
        expect(PermissionUpdateSchema.safeParse(update).success).toBe(false)
    })

    it('拒绝未知 type', () => {
        const update = { type: 'bogus', rules: [], behavior: 'allow', destination: 'session' }
        expect(PermissionUpdateSchema.safeParse(update).success).toBe(false)
    })
})

describe('AgentStateRequestSchema suggestions', () => {
    it('接受 suggestions 字段', () => {
        const req = {
            tool: 'Bash',
            arguments: { command: 'git status' },
            createdAt: 1,
            suggestions: [
                { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'git:*' }], behavior: 'allow', destination: 'session' },
            ],
        }
        expect(AgentStateRequestSchema.safeParse(req).success).toBe(true)
    })

    it('suggestions 可选', () => {
        expect(AgentStateRequestSchema.safeParse({ tool: 'Bash', arguments: {} }).success).toBe(true)
    })
})

describe('GoalStatusSchema', () => {
    it('接受 met + condition', () => {
        const r = GoalStatusSchema.safeParse({ met: false, condition: 'all tests pass' })
        expect(r.success).toBe(true)
    })

    it('接受全部可选字段', () => {
        const r = GoalStatusSchema.safeParse({
            met: true,
            condition: 'x',
            reason: 'done',
            iterations: 3,
            durationMs: 12000,
            tokens: 1400,
        })
        expect(r.success).toBe(true)
    })

    it('拒绝缺 condition', () => {
        const r = GoalStatusSchema.safeParse({ met: false })
        expect(r.success).toBe(false)
    })

    it('拒绝缺 met', () => {
        const r = GoalStatusSchema.safeParse({ condition: 'x' })
        expect(r.success).toBe(false)
    })
})

describe('RuntimeStateSchema with goalStatus', () => {
    it('接受 goalStatus 字段并保留在解析结果中', () => {
        const result = RuntimeStateSchema.parse({ goalStatus: { met: false, condition: 'x' } })
        expect(result.goalStatus?.met).toBe(false)
        expect(result.goalStatus?.condition).toBe('x')
    })

    it('goalStatus 可为 null（无 goal 或已清空）', () => {
        const result = RuntimeStateSchema.parse({ goalStatus: null })
        expect(result.goalStatus).toBeNull()
    })

    it('goalStatus 可选（缺省时不报错）', () => {
        const result = RuntimeStateSchema.parse({})
        expect(result.goalStatus).toBeUndefined()
    })
})

describe('message-withdrawn SyncEvent', () => {
    it('解析合法载荷', () => {
        const ev = SyncEventSchema.safeParse({
            type: 'message-withdrawn', sessionId: 's1', localId: 'l1',
            blocks: [{ type: 'text', text: 'hi' }], originalText: 'hi',
        })
        expect(ev.success).toBe(true)
    })
    it('originalText 允许 null，blocks 必须为数组', () => {
        expect(SyncEventSchema.safeParse({ type: 'message-withdrawn', sessionId: 's1', localId: 'l1', blocks: [], originalText: null }).success).toBe(true)
        expect(SyncEventSchema.safeParse({ type: 'message-withdrawn', sessionId: 's1', localId: 'l1', blocks: 'x', originalText: null }).success).toBe(false)
    })
})

describe('BackgroundTaskItemSchema 枚举扩展（诚实降级，批次 B review fix2）', () => {
    it('toolName 接受 unknown（补建条目无法确证工具类型）', () => {
        const result = BackgroundTaskItemSchema.safeParse({
            taskId: 'bt-1', toolName: 'unknown', description: '',
            status: 'running', startedAt: 0,
        })
        expect(result.success).toBe(true)
    })

    it('status 接受 paused（patch.status 可携带 paused）', () => {
        const result = BackgroundTaskItemSchema.safeParse({
            taskId: 'bt-1', toolName: 'Bash', description: '',
            status: 'paused', startedAt: 0,
        })
        expect(result.success).toBe(true)
    })

    it('存量 DB 记录（无新枚举值）继续通过 safeParse（additive 兼容）', () => {
        const result = BackgroundTaskItemSchema.safeParse({
            taskId: 'bt-1', toolName: 'Bash', description: '',
            status: 'running', startedAt: 0,
        })
        expect(result.success).toBe(true)
    })
})

describe('extractLiveBackgroundTaskIds（CLI/Hub 共用规则，批次 B review fix2 A6）', () => {
    it('收集非空字符串 task_id，跳过 ambient 条目', () => {
        const ids = extractLiveBackgroundTaskIds([
            { task_id: 'bt-1', description: '用户任务' },
            { task_id: 'bt-2', description: 'checkpoint', ambient: true },
            { description: '无 id' },
            { task_id: '', description: '空串 id' },
            { task_id: 123 },
            'garbage',
            null,
        ])
        expect(ids.has('bt-1')).toBe(true)
        expect(ids.has('bt-2')).toBe(false)
        expect(ids.size).toBe(1)
    })

    it('非数组输入返回空集合（REPLACE 语义即清空）', () => {
        expect(extractLiveBackgroundTaskIds(undefined).size).toBe(0)
        expect(extractLiveBackgroundTaskIds('x').size).toBe(0)
        expect(extractLiveBackgroundTaskIds(null).size).toBe(0)
    })
})
