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
 * reconcileChatBlocks 单元测试
 * 验证结构化共享：相同 block 保持引用、变更 block 返回新引用
 */

import { describe, expect, it } from 'vitest'
import { reconcileChatBlocks, indexBlocks } from '@/domain/chat/reconcile'
import type {
    ChatBlock,
    UserTextBlock,
    AgentTextBlock,
    AgentReasoningBlock,
    CliOutputBlock,
    AgentEventBlock,
    ToolCallBlock,
    CompactSummaryBlock,
} from '@/domain/chat/types'

/* ------------------------------------------------------------------ */
/*  工具函数                                                          */
/* ------------------------------------------------------------------ */

/** 用 indexBlocks 构造 prevById Map */
function buildPrevById(blocks: ChatBlock[]) {
    const map = new Map<string, ChatBlock>()
    indexBlocks(blocks, map)
    return map
}

/* ------------------------------------------------------------------ */
/*  Block 工厂                                                        */
/* ------------------------------------------------------------------ */

function userText(overrides: Partial<UserTextBlock> & { id: string }): UserTextBlock {
    return {
        kind: 'user-text',
        localId: null,
        createdAt: 1000,
        blocks: [{ type: 'text', text: 'hello' }],
        status: 'delivered',
        meta: undefined,
        isSynthetic: false,
        ...overrides,
    }
}

function agentText(overrides: Partial<AgentTextBlock> & { id: string }): AgentTextBlock {
    return {
        kind: 'agent-text',
        localId: null,
        createdAt: 2000,
        text: 'response',
        meta: undefined,
        isSynthetic: false,
        ...overrides,
    }
}

function agentReasoning(overrides: Partial<AgentReasoningBlock> & { id: string }): AgentReasoningBlock {
    return {
        kind: 'agent-reasoning',
        localId: null,
        createdAt: 3000,
        text: 'thinking...',
        meta: undefined,
        ...overrides,
    }
}

function cliOutput(overrides: Partial<CliOutputBlock> & { id: string }): CliOutputBlock {
    return {
        kind: 'cli-output',
        localId: null,
        createdAt: 4000,
        text: '$ ls',
        source: 'user',
        meta: undefined,
        ...overrides,
    }
}

function agentEvent(overrides: Partial<AgentEventBlock> & { id: string }): AgentEventBlock {
    return {
        kind: 'agent-event',
        createdAt: 5000,
        event: { type: 'ready' },
        meta: undefined,
        ...overrides,
    }
}

function toolCall(overrides: Partial<ToolCallBlock> & { id: string }): ToolCallBlock {
    return {
        kind: 'tool-call',
        localId: null,
        createdAt: 6000,
        tool: {
            id: `${overrides.id}-tool`,
            name: 'Bash',
            state: 'running',
            input: { command: 'echo hi' },
            createdAt: 6000,
            startedAt: 6001,
            completedAt: null,
            description: null,
        },
        children: [],
        meta: undefined,
        ...overrides,
    }
}

function compactSummary(overrides: Partial<CompactSummaryBlock> & { id: string }): CompactSummaryBlock {
    return {
        kind: 'compact-summary',
        localId: null,
        createdAt: 7000,
        text: 'summary text',
        preTokens: 100,
        postTokens: 20,
        durationMs: 50,
        meta: undefined,
        ...overrides,
    }
}

/* ================================================================== */
/*  测试                                                              */
/* ================================================================== */

describe('reconcileChatBlocks', () => {
    /* -------------------------------------------------------------- */
    /*  引用保持：字段相同时返回旧引用                                  */
    /* -------------------------------------------------------------- */
    describe('引用保持 — 字段完全相同时返回旧引用', () => {
        it('user-text', () => {
            const prev = userText({ id: 'u1', blocks: [{ type: 'text', text: 'hello' }] })
            const next = userText({ id: 'u1', blocks: [{ type: 'text', text: 'hello' }] })
            const prevById = buildPrevById([prev])
            const { blocks } = reconcileChatBlocks([next], prevById)
            // 引用必须是 prev，不是 next
            expect(blocks[0]).toBe(prev)
        })

        it('agent-text', () => {
            const prev = agentText({ id: 'a1', text: 'response' })
            const next = agentText({ id: 'a1', text: 'response' })
            const prevById = buildPrevById([prev])
            const { blocks } = reconcileChatBlocks([next], prevById)
            expect(blocks[0]).toBe(prev)
        })

        it('agent-reasoning', () => {
            const prev = agentReasoning({ id: 'r1', text: 'thinking...' })
            const next = agentReasoning({ id: 'r1', text: 'thinking...' })
            const prevById = buildPrevById([prev])
            const { blocks } = reconcileChatBlocks([next], prevById)
            expect(blocks[0]).toBe(prev)
        })

        it('cli-output', () => {
            const prev = cliOutput({ id: 'c1', text: '$ ls' })
            const next = cliOutput({ id: 'c1', text: '$ ls' })
            const prevById = buildPrevById([prev])
            const { blocks } = reconcileChatBlocks([next], prevById)
            expect(blocks[0]).toBe(prev)
        })

        it('agent-event', () => {
            const prev = agentEvent({ id: 'e1', event: { type: 'ready' } })
            const next = agentEvent({ id: 'e1', event: { type: 'ready' } })
            const prevById = buildPrevById([prev])
            const { blocks } = reconcileChatBlocks([next], prevById)
            expect(blocks[0]).toBe(prev)
        })

        it('tool-call (children 相同)', () => {
            const child = agentText({ id: 'tc-child', text: 'output' })
            // tool 对象需要共享引用，因为 areToolCallsEqual 用 === 比较 tool.input
            const sharedTool = {
                id: 't1-tool',
                name: 'Bash',
                state: 'running' as const,
                input: { command: 'echo hi' },
                createdAt: 6000,
                startedAt: 6001,
                completedAt: null,
                description: null,
            }
            const prev = toolCall({ id: 't1', children: [child], tool: sharedTool })
            const next = toolCall({ id: 't1', children: [child], tool: sharedTool })
            const prevById = buildPrevById([prev, child])
            const { blocks } = reconcileChatBlocks([next], prevById)
            // tool-call 引用保持
            expect(blocks[0]).toBe(prev)
        })
    })

    /* -------------------------------------------------------------- */
    /*  引用更新：字段变化时返回新引用                                  */
    /* -------------------------------------------------------------- */
    describe('引用更新 — 字段变化时返回新引用', () => {
        it('user-text text 变化', () => {
            const prev = userText({ id: 'u1', blocks: [{ type: 'text', text: 'hello' }] })
            const next = userText({ id: 'u1', blocks: [{ type: 'text', text: 'world' }] })
            const prevById = buildPrevById([prev])
            const { blocks } = reconcileChatBlocks([next], prevById)
            expect(blocks[0]).toBe(next)
            expect(blocks[0]).not.toBe(prev)
        })

        it('agent-text text 变化', () => {
            const prev = agentText({ id: 'a1', text: 'response' })
            const next = agentText({ id: 'a1', text: 'new response' })
            const prevById = buildPrevById([prev])
            const { blocks } = reconcileChatBlocks([next], prevById)
            expect(blocks[0]).toBe(next)
        })

        it('tool-call state 变化 (running → completed)', () => {
            const prev = toolCall({
                id: 't1',
                tool: {
                    id: 't1-tool',
                    name: 'Bash',
                    state: 'running',
                    input: { command: 'echo hi' },
                    createdAt: 6000,
                    startedAt: 6001,
                    completedAt: null,
                    description: null,
                },
            })
            const next = toolCall({
                id: 't1',
                tool: {
                    id: 't1-tool',
                    name: 'Bash',
                    state: 'completed',
                    input: { command: 'echo hi' },
                    createdAt: 6000,
                    startedAt: 6001,
                    completedAt: 7000,
                    description: null,
                    result: 'hi',
                },
            })
            const prevById = buildPrevById([prev])
            const { blocks } = reconcileChatBlocks([next], prevById)
            expect(blocks[0]).toBe(next)
        })
    })

    /* -------------------------------------------------------------- */
    /*  新增 block                                                      */
    /* -------------------------------------------------------------- */
    describe('新增 block — prevById 中无对应 id', () => {
        it('直接返回新 block', () => {
            const newBlock = agentText({ id: 'new-1', text: 'fresh' })
            const prevById = buildPrevById([]) // 空的 prevById
            const { blocks } = reconcileChatBlocks([newBlock], prevById)
            expect(blocks[0]).toBe(newBlock)
        })
    })

    /* -------------------------------------------------------------- */
    /*  kind 变化                                                       */
    /* -------------------------------------------------------------- */
    describe('kind 变化 — 同 id 不同 kind 返回新 block', () => {
        it('user-text → agent-text (同 id)', () => {
            const prev = userText({ id: 'x1', text: 'hello' })
            const next = agentText({ id: 'x1', text: 'hello' })
            const prevById = buildPrevById([prev])
            const { blocks } = reconcileChatBlocks([next], prevById)
            // kind 不同，不匹配，直接返回 next
            expect(blocks[0]).toBe(next)
        })
    })

    /* -------------------------------------------------------------- */
    /*  嵌套 reconcile                                                  */
    /* -------------------------------------------------------------- */
    describe('嵌套 reconcile — children 影响 tool-call 引用', () => {
        it('children 变化 → tool-call 引用也变', () => {
            const oldChild = agentText({ id: 'tc-c1', text: 'old output' })
            const prev = toolCall({ id: 't1', children: [oldChild] })
            const prevById = buildPrevById([prev, oldChild])

            const newChild = agentText({ id: 'tc-c1', text: 'new output' })
            const next = toolCall({ id: 't1', children: [newChild] })

            const { blocks } = reconcileChatBlocks([next], prevById)
            // tool-call 引用变了
            expect(blocks[0]).not.toBe(prev)
            // 但还是 tool-call
            expect(blocks[0].kind).toBe('tool-call')
            // children 是新引用
            expect((blocks[0] as ToolCallBlock).children[0]).toBe(newChild)
        })

        it('children 不变 → tool-call 引用保持', () => {
            const child = agentText({ id: 'tc-c2', text: 'same output' })
            // 共享 tool 对象以使 areToolCallsEqual 通过
            const sharedTool = {
                id: 't2-tool',
                name: 'Bash',
                state: 'running' as const,
                input: { command: 'ls' },
                createdAt: 6000,
                startedAt: 6001,
                completedAt: null,
                description: null,
            }
            const prev = toolCall({ id: 't2', children: [child], tool: sharedTool })
            // 用完全相同的 child + tool 对象构造 next
            const next = toolCall({ id: 't2', children: [child], tool: sharedTool })
            const prevById = buildPrevById([prev, child])
            const { blocks } = reconcileChatBlocks([next], prevById)
            // 引用保持
            expect(blocks[0]).toBe(prev)
        })

        it('children 内容相同但引用不同 → tool-call 引用保持', () => {
            const child = agentText({ id: 'tc-c3', text: 'output' })
            // 共享 tool 对象
            const sharedTool = {
                id: 't3-tool',
                name: 'Bash',
                state: 'running' as const,
                input: { command: 'pwd' },
                createdAt: 6000,
                startedAt: 6001,
                completedAt: null,
                description: null,
            }
            const prev = toolCall({ id: 't3', children: [child], tool: sharedTool })
            const prevById = buildPrevById([prev, child])

            // 新 child 内容相同但不同引用
            const newChild = agentText({ id: 'tc-c3', text: 'output' })
            const next = toolCall({ id: 't3', children: [newChild], tool: sharedTool })

            const { blocks } = reconcileChatBlocks([next], prevById)
            // children 被 reconcile 为 prev 的 child（引用保持）
            // 所以 tool-call 引用也保持
            expect(blocks[0]).toBe(prev)
        })
    })

    /* -------------------------------------------------------------- */
    /*  混合场景                                                        */
    /* -------------------------------------------------------------- */
    describe('混合场景 — 部分 block 变化、部分不变', () => {
        it('多变一不变', () => {
            const prevUser = userText({ id: 'u1', blocks: [{ type: 'text', text: 'hello' }] })
            const prevAgent = agentText({ id: 'a1', text: 'response' })
            const prevEvent = agentEvent({ id: 'e1', event: { type: 'ready' } })

            const prevById = buildPrevById([prevUser, prevAgent, prevEvent])

            // u1 不变、a1 text 变化、e1 不变
            const nextUser = userText({ id: 'u1', blocks: [{ type: 'text', text: 'hello' }] })
            const nextAgent = agentText({ id: 'a1', text: 'new response' })
            const nextEvent = agentEvent({ id: 'e1', event: { type: 'ready' } })

            const { blocks } = reconcileChatBlocks([nextUser, nextAgent, nextEvent], prevById)
            expect(blocks[0]).toBe(prevUser)    // 引用保持
            expect(blocks[1]).toBe(nextAgent)   // 引用更新
            expect(blocks[2]).toBe(prevEvent)   // 引用保持
        })
    })

    /* -------------------------------------------------------------- */
    /*  byId 返回值                                                     */
    /* -------------------------------------------------------------- */
    describe('byId 返回值', () => {
        it('包含所有 block（含嵌套 children）', () => {
            const child = agentText({ id: 'inner-1', text: 'child text' })
            const parent = toolCall({ id: 'tc-1', children: [child] })
            const topBlock = userText({ id: 'u1', text: 'hi' })

            const { byId } = reconcileChatBlocks([topBlock, parent], new Map())
            expect(byId.size).toBe(3)
            expect(byId.has('u1')).toBe(true)
            expect(byId.has('tc-1')).toBe(true)
            expect(byId.has('inner-1')).toBe(true)
        })

        it('引用保持的 block 在 byId 中也是旧引用', () => {
            const prev = agentText({ id: 'a1', text: 'same' })
            const next = agentText({ id: 'a1', text: 'same' })
            const prevById = buildPrevById([prev])

            const { byId } = reconcileChatBlocks([next], prevById)
            expect(byId.get('a1')).toBe(prev)
        })
    })

    /* -------------------------------------------------------------- */
    /*  compact-summary                                                 */
    /* -------------------------------------------------------------- */
    describe('compact-summary — 跳过比较，始终返回新 block', () => {
        it('内容完全相同也返回新引用', () => {
            const prev = compactSummary({ id: 'cs1', text: 'summary' })
            const next = compactSummary({ id: 'cs1', text: 'summary' })
            const prevById = buildPrevById([prev])
            const { blocks } = reconcileChatBlocks([next], prevById)
            // compact-summary 不做比较，直接返回 next
            expect(blocks[0]).toBe(next)
            expect(blocks[0]).not.toBe(prev)
        })
    })
})
