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
 * reducerTools 单元测试
 * 测试 ensureToolBlock、getPermissions、collectToolIdsFromMessages 等核心函数
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
    ensureToolBlock,
    getPermissions,
    collectToolIdsFromMessages,
    isChangeTitleToolName,
    extractTitleFromChangeTitleInput,
} from '@/domain/chat/reducerTools'
import type { ToolCallBlock, NormalizedMessage } from '@/domain/chat/types'
import type { AgentState } from '@/core/data/api/types'
import { enableDiag, disableDiag, dumpDiag } from '@/core/lib/diag'

describe('ensureToolBlock', () => {
    describe('首次创建', () => {
        it('应创建新的 ToolCallBlock 并加入 blocks 数组和 toolBlocksById Map', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            const result = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Read',
                input: { file_path: '/test.ts' },
                description: null,
            })

            // 返回的 block 应有正确的结构
            expect(result.kind).toBe('tool-call')
            expect(result.id).toBe('tool-1')
            expect(result.tool.name).toBe('Read')
            expect(result.tool.state).toBe('running')
            expect(result.tool.input).toEqual({ file_path: '/test.ts' })

            // blocks 数组应包含该 block
            expect(blocks).toHaveLength(1)
            expect(blocks[0]).toBe(result)

            // Map 中也应存在
            expect(toolBlocksById.get('tool-1')).toBe(result)
        })

        it('无 permission 时默认状态为 running', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            const result = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Bash',
                input: {},
                description: null,
            })

            expect(result.tool.state).toBe('running')
            expect(result.tool.startedAt).toBe(1000)
        })

        it('permission status 为 pending 时初始状态为 pending', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            const result = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Bash',
                input: {},
                description: null,
                permission: { id: 'tool-1', status: 'pending' },
            })

            expect(result.tool.state).toBe('pending')
            expect(result.tool.startedAt).toBeNull()
        })

        it('permission status 为 denied 时初始状态为 error', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            const result = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Bash',
                input: {},
                description: null,
                permission: { id: 'tool-1', status: 'denied' },
            })

            expect(result.tool.state).toBe('error')
        })

        it('permission status 为 canceled 时初始状态为 error', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            const result = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Bash',
                input: {},
                description: null,
                permission: { id: 'tool-1', status: 'canceled' },
            })

            expect(result.tool.state).toBe('error')
        })
    })

    describe('不突变已有 block', () => {
        it('传入已有 id 时应返回浅拷贝，原 block 引用不变', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            // 首次创建
            const original = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Read',
                input: {},
                description: null,
            })

            // 再次调用相同 id
            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 2000,
                localId: null,
                name: 'Read',
                input: { file_path: '/new.ts' },
                description: '读取文件',
            })

            // 应返回新的引用（浅拷贝）
            expect(updated).not.toBe(original)
            // 但 blocks 数组中仍是同一个引用（push 只执行一次）
            expect(blocks).toHaveLength(1)

            // Map 中的引用应更新为新 block
            expect(toolBlocksById.get('tool-1')).toBe(updated)
        })
    })

    describe('createdAt 保留最小值', () => {
        it('已有 block createdAt=100，传入 seed.createdAt=50，应更新为 50', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 100,
                localId: null,
                name: 'Read',
                input: {},
                description: null,
            })

            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 50,
                localId: null,
                name: 'Read',
                input: {},
                description: null,
            })

            expect(updated.createdAt).toBe(50)
            expect(updated.tool.createdAt).toBe(50)
        })

        it('已有 block createdAt=50，传入 seed.createdAt=100，不应更新', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 50,
                localId: null,
                name: 'Read',
                input: {},
                description: null,
            })

            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 100,
                localId: null,
                name: 'Read',
                input: {},
                description: null,
            })

            expect(updated.createdAt).toBe(50)
            expect(updated.tool.createdAt).toBe(50)
        })
    })

    describe('permission 合并', () => {
        it('应合并 permission 字段', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Read',
                input: {},
                description: null,
            })

            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Read',
                input: {},
                description: null,
                permission: { id: 'tool-1', status: 'approved', mode: 'auto' },
            })

            expect(updated.tool.permission).toEqual({
                id: 'tool-1',
                status: 'approved',
                mode: 'auto',
            })
        })

        it('新的 permission 应与已有 permission 浅合并', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Read',
                input: {},
                description: null,
                permission: { id: 'tool-1', status: 'pending', reason: 'waiting' },
            })

            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Read',
                input: {},
                description: null,
                permission: { id: 'tool-1', status: 'approved' },
            })

            // 浅合并：reason 保留，status 被覆盖
            expect(updated.tool.permission?.status).toBe('approved')
            expect(updated.tool.permission?.reason).toBe('waiting')
        })
    })

    describe('pending 优先于 running', () => {
        it('已有 state=running，传入 permission.status=pending，应更新为 pending', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Bash',
                input: {},
                description: null,
            })

            expect(blocks[0].tool.state).toBe('running')

            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Bash',
                input: {},
                description: null,
                permission: { id: 'tool-1', status: 'pending' },
            })

            expect(updated.tool.state).toBe('pending')
        })

        it('已有 state=pending，传入无 permission（审批已通过，agentState.requests 已移除），应清除 permission 并翻 running', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Bash',
                input: {},
                description: null,
                permission: { id: 'tool-1', status: 'pending' },
            })

            expect(blocks[0].tool.state).toBe('pending')

            // 审批通过后 agentState.requests 移除该请求，getPermissions 不再返回 → seed.permission 为 undefined。
            // 此时若保持 pending，ToolCallBlock 会因 hasPermission=true 持续不渲染，工具执行窗口不可见（等 tool_result 才出现）。
            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Bash',
                input: {},
                description: null,
            })

            expect(updated.tool.state).toBe('running')
            expect(updated.tool.permission).toBeUndefined()
        })
    })

    describe('tool name 更新规则', () => {
        it('空名应被真实名替换', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: '',
                input: {},
                description: null,
            })

            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Read',
                input: {},
                description: null,
            })

            expect(updated.tool.name).toBe('Read')
        })

        it('placeholder 名（Tool）应被真实名替换', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Tool',
                input: {},
                description: null,
            })

            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Bash',
                input: {},
                description: null,
            })

            expect(updated.tool.name).toBe('Bash')
        })

        it('placeholder 名（unknown）应被真实名替换', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'unknown',
                input: {},
                description: null,
            })

            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Write',
                input: {},
                description: null,
            })

            expect(updated.tool.name).toBe('Write')
        })

        it('已有真实名不应被 placeholder 名替换', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Read',
                input: {},
                description: null,
            })

            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Tool',
                input: {},
                description: null,
            })

            expect(updated.tool.name).toBe('Read')
        })

        it('已有真实名不应被空名替换', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Bash',
                input: {},
                description: null,
            })

            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: '',
                input: {},
                description: null,
            })

            expect(updated.tool.name).toBe('Bash')
        })

        it('placeholder 名可以替换另一个 placeholder 名', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Tool',
                input: {},
                description: null,
            })

            // 空名也是 placeholder，但 seed.name 为空字符串时条件判断 `seed.name` 为 false
            // 所以空名不会触发更新。这里测试 'unknown' 替换 'Tool'
            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'unknown',
                input: {},
                description: null,
            })

            // 'unknown' 是 placeholder 名，已有 'Tool' 也是 placeholder 名
            // 条件：isPlaceholderToolName(seed.name) || isPlaceholderToolName(updatedTool.name)
            // isPlaceholderToolName('unknown') = true, 所以整个条件为 true
            expect(updated.tool.name).toBe('unknown')
        })
    })

    describe('input 更新', () => {
        it('非 null/undefined 的 input 应覆盖', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Read',
                input: { file_path: '/old.ts' },
                description: null,
            })

            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Read',
                input: { file_path: '/new.ts' },
                description: null,
            })

            expect(updated.tool.input).toEqual({ file_path: '/new.ts' })
        })

        it('null input 不应覆盖已有 input', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Read',
                input: { file_path: '/keep.ts' },
                description: null,
            })

            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Read',
                input: null,
                description: null,
            })

            expect(updated.tool.input).toEqual({ file_path: '/keep.ts' })
        })

        it('undefined input 不应覆盖已有 input', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Read',
                input: { file_path: '/keep.ts' },
                description: null,
            })

            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Read',
                input: undefined,
                description: null,
            })

            expect(updated.tool.input).toEqual({ file_path: '/keep.ts' })
        })

        it('空对象 input 应覆盖（非 null/undefined）', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Read',
                input: { file_path: '/keep.ts' },
                description: null,
            })

            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Read',
                input: {},
                description: null,
            })

            expect(updated.tool.input).toEqual({})
        })
    })

    describe('description 更新', () => {
        it('非 null description 应覆盖', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Bash',
                input: {},
                description: null,
            })

            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Bash',
                input: {},
                description: '执行命令',
            })

            expect(updated.tool.description).toBe('执行命令')
        })

        it('null description 不应覆盖已有 description', () => {
            const blocks: ToolCallBlock[] = []
            const toolBlocksById = new Map<string, ToolCallBlock>()

            ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Bash',
                input: {},
                description: '执行命令',
            })

            const updated = ensureToolBlock(blocks, toolBlocksById, 'tool-1', {
                createdAt: 1000,
                localId: null,
                name: 'Bash',
                input: {},
                description: null,
            })

            expect(updated.tool.description).toBe('执行命令')
        })
    })
})

describe('getPermissions', () => {
    it('应从 AgentState 提取 pending 请求', () => {
        const agentState: AgentState = {
            requests: {
                'tool-2': {
                    tool: 'Write',
                    arguments: { file_path: '/test.ts' },
                    createdAt: 3000,
                },
            },
        }

        const result = getPermissions(agentState)
        expect(result.size).toBe(1)

        const entry = result.get('tool-2')
        expect(entry).toBeDefined()
        expect(entry?.toolName).toBe('Write')
        expect(entry?.permission.status).toBe('pending')
        expect(entry?.permission.createdAt).toBe(3000)
    })

    it('应返回多个 pending 请求', () => {
        const agentState: AgentState = {
            requests: {
                'tool-1': {
                    tool: 'Bash',
                    arguments: {},
                    createdAt: 1000,
                },
                'tool-2': {
                    tool: 'Read',
                    arguments: {},
                    createdAt: 2000,
                },
            },
        }

        const result = getPermissions(agentState)
        expect(result.size).toBe(2)
        expect(result.get('tool-1')?.permission.status).toBe('pending')
        expect(result.get('tool-2')?.permission.status).toBe('pending')
    })

    it('null 输入应返回空 Map', () => {
        expect(getPermissions(null).size).toBe(0)
    })

    it('undefined 输入应返回空 Map', () => {
        expect(getPermissions(undefined).size).toBe(0)
    })

    it('空 AgentState 应返回空 Map', () => {
        expect(getPermissions({}).size).toBe(0)
    })

    it('把 agentState.requests[id].suggestions 填进 ToolPermission.suggestions', () => {
        const agentState = {
            requests: {
                r1: {
                    tool: 'Bash',
                    arguments: { command: 'git status' },
                    suggestions: [{
                        type: 'addRules',
                        rules: [{ toolName: 'Bash', ruleContent: 'git:*' }],
                        behavior: 'allow',
                        destination: 'session',
                    }],
                },
            },
        } as unknown as AgentState

        const map = getPermissions(agentState)
        expect(map.get('r1')?.permission.suggestions).toHaveLength(1)
        expect(map.get('r1')?.permission.suggestions?.[0].destination).toBe('session')
    })

    it('无 suggestions 时 permission.suggestions undefined', () => {
        const map = getPermissions({ requests: { r1: { tool: 'Bash', arguments: {} } } } as unknown as AgentState)
        expect(map.get('r1')?.permission.suggestions).toBeUndefined()
    })
})

describe('collectToolIdsFromMessages', () => {
    it('应从 agent 消息中收集 tool-call ID', () => {
        const messages: NormalizedMessage[] = [
            {
                id: 'msg-1',
                localId: null,
                createdAt: 1000,
                role: 'agent',
                isSidechain: false,
                content: [
                    { type: 'tool-call', id: 'tool-1', name: 'Read', input: {}, description: null, uuid: 'uuid-1', parentUUID: null },
                ],
            },
        ]

        const ids = collectToolIdsFromMessages(messages)
        expect(ids.has('tool-1')).toBe(true)
        expect(ids.size).toBe(1)
    })

    it('应从 agent 消息中收集 tool-result ID', () => {
        const messages: NormalizedMessage[] = [
            {
                id: 'msg-1',
                localId: null,
                createdAt: 1000,
                role: 'agent',
                isSidechain: false,
                content: [
                    { type: 'tool-result', tool_use_id: 'tool-1', content: 'result', is_error: false, uuid: 'uuid-1', parentUUID: null },
                ],
            },
        ]

        const ids = collectToolIdsFromMessages(messages)
        expect(ids.has('tool-1')).toBe(true)
    })

    it('应跳过非 agent 消息', () => {
        const messages: NormalizedMessage[] = [
            {
                id: 'msg-1',
                localId: null,
                createdAt: 1000,
                role: 'user',
                content: { type: 'text', text: 'hello' },
                isSidechain: false,
            },
        ]

        const ids = collectToolIdsFromMessages(messages)
        expect(ids.size).toBe(0)
    })

    it('应收集多条消息中的所有工具 ID', () => {
        const messages: NormalizedMessage[] = [
            {
                id: 'msg-1',
                localId: null,
                createdAt: 1000,
                role: 'agent',
                isSidechain: false,
                content: [
                    { type: 'tool-call', id: 'tool-1', name: 'Read', input: {}, description: null, uuid: 'uuid-1', parentUUID: null },
                    { type: 'tool-call', id: 'tool-2', name: 'Write', input: {}, description: null, uuid: 'uuid-2', parentUUID: null },
                ],
            },
            {
                id: 'msg-2',
                localId: null,
                createdAt: 2000,
                role: 'agent',
                isSidechain: false,
                content: [
                    { type: 'tool-result', tool_use_id: 'tool-1', content: 'ok', is_error: false, uuid: 'uuid-3', parentUUID: null },
                    { type: 'tool-call', id: 'tool-3', name: 'Bash', input: {}, description: null, uuid: 'uuid-4', parentUUID: null },
                ],
            },
        ]

        const ids = collectToolIdsFromMessages(messages)
        expect(ids.size).toBe(3)
        expect(ids.has('tool-1')).toBe(true)
        expect(ids.has('tool-2')).toBe(true)
        expect(ids.has('tool-3')).toBe(true)
    })
})

describe('isChangeTitleToolName', () => {
    it('应识别 mcp__mobi__change_title', () => {
        expect(isChangeTitleToolName('mcp__mobi__change_title')).toBe(true)
    })

    it('应识别 mobi__change_title', () => {
        expect(isChangeTitleToolName('mobi__change_title')).toBe(true)
    })

    it('不应识别其他工具名', () => {
        expect(isChangeTitleToolName('Bash')).toBe(false)
        expect(isChangeTitleToolName('Read')).toBe(false)
        expect(isChangeTitleToolName('change_title')).toBe(false)
        expect(isChangeTitleToolName('')).toBe(false)
    })
})

describe('extractTitleFromChangeTitleInput', () => {
    it('应从有效输入中提取标题', () => {
        expect(extractTitleFromChangeTitleInput({ title: '新标题' })).toBe('新标题')
    })

    it('应 trim 标题', () => {
        expect(extractTitleFromChangeTitleInput({ title: '  带空格的标题  ' })).toBe('带空格的标题')
    })

    it('空标题应返回 null', () => {
        expect(extractTitleFromChangeTitleInput({ title: '' })).toBeNull()
        expect(extractTitleFromChangeTitleInput({ title: '   ' })).toBeNull()
    })

    it('非字符串 title 应返回 null', () => {
        expect(extractTitleFromChangeTitleInput({ title: 123 })).toBeNull()
        expect(extractTitleFromChangeTitleInput({ title: null })).toBeNull()
        expect(extractTitleFromChangeTitleInput({ title: true })).toBeNull()
    })

    it('无 title 字段应返回 null', () => {
        expect(extractTitleFromChangeTitleInput({})).toBeNull()
        expect(extractTitleFromChangeTitleInput({ name: 'test' })).toBeNull()
    })

    it('非对象输入应返回 null', () => {
        expect(extractTitleFromChangeTitleInput(null)).toBeNull()
        expect(extractTitleFromChangeTitleInput(undefined)).toBeNull()
        expect(extractTitleFromChangeTitleInput('string')).toBeNull()
        expect(extractTitleFromChangeTitleInput(42)).toBeNull()
    })
})

describe('ensureToolBlock 诊断埋点', () => {
    beforeEach(() => {
        disableDiag()
        localStorage.clear()
        enableDiag()
    })
    afterEach(() => {
        disableDiag()
        localStorage.clear()
    })

    it('新建 block 时记录 created 事件（含状态）', () => {
        const blocks: ToolCallBlock[] = []
        const toolBlocksById = new Map<string, ToolCallBlock>()
        ensureToolBlock(blocks, toolBlocksById, 'tool-x', {
            createdAt: 1000,
            localId: 'l1',
            name: 'Write',
            input: { file_path: '/a.txt' },
            description: null,
        })
        const d = dumpDiag()
        const tr = d.tools.find(t => t.toolUseId === 'tool-x')
        expect(tr).toBeDefined()
        expect(tr!.name).toBe('Write')
        expect(tr!.events[0]).toContain('created:running')
    })

    it('permission-only 建块记录 pending 状态', () => {
        const blocks: ToolCallBlock[] = []
        const toolBlocksById = new Map<string, ToolCallBlock>()
        ensureToolBlock(blocks, toolBlocksById, 'tool-p', {
            createdAt: 1000,
            localId: null,
            name: 'Edit',
            input: undefined,
            description: null,
            permission: { id: 'tool-p', status: 'pending' },
        })
        const tr = dumpDiag().tools.find(t => t.toolUseId === 'tool-p')
        expect(tr).toBeDefined()
        expect(tr!.events[0]).toContain('created:pending')
    })

    it('已有 block 状态迁移记录 state 事件（pending → running 翻转为审批已通过）', () => {
        const blocks: ToolCallBlock[] = []
        const toolBlocksById = new Map<string, ToolCallBlock>()
        // 先以 permission-only 建 pending 块
        ensureToolBlock(blocks, toolBlocksById, 'tool-p', {
            createdAt: 1000,
            localId: null,
            name: 'Edit',
            input: undefined,
            description: null,
            permission: { id: 'tool-p', status: 'pending' },
        })
        // 审批已通过：permission 无，state 从 pending 翻 running（根因 1 的修复分支）
        ensureToolBlock(blocks, toolBlocksById, 'tool-p', {
            createdAt: 1000,
            localId: null,
            name: 'Edit',
            input: undefined,
            description: null,
        })
        const tr = dumpDiag().tools.find(t => t.toolUseId === 'tool-p')
        expect(tr).toBeDefined()
        expect(tr!.events).toHaveLength(2)
        expect(tr!.events[1]).toContain('state:running')
        // permission 已清除 → 状态史不含 pending 权限残留
        expect(tr!.events[1]).not.toContain('pending')
    })

    it('状态无变化时不记录冗余事件', () => {
        const blocks: ToolCallBlock[] = []
        const toolBlocksById = new Map<string, ToolCallBlock>()
        ensureToolBlock(blocks, toolBlocksById, 'tool-x', {
            createdAt: 1000,
            localId: 'l1',
            name: 'Write',
            input: { file_path: '/a.txt' },
            description: null,
        })
        // 重复跑同输入，state 无变化 → 只保留 created 一条
        ensureToolBlock(blocks, toolBlocksById, 'tool-x', {
            createdAt: 1000,
            localId: 'l1',
            name: 'Write',
            input: { file_path: '/a.txt' },
            description: null,
        })
        const tr = dumpDiag().tools.find(t => t.toolUseId === 'tool-x')
        expect(tr).toBeDefined()
        expect(tr!.events).toHaveLength(1)
    })
})
