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

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ChatBlock, ChatToolCall, ToolCallBlock, UserTextBlock, AgentTextBlock, AgentEventBlock } from '@/domain/chat'
import type { ChatBlockContext } from '@/components/chat/blocks'
import { buildChatBubbleItems } from '@/components/chat/buildBubbleItems'
import { renderChatBlock } from '@/components/chat/blocks'

// Mock renderChatBlock：返回 block id 标记，方便断言 items 顺序与内容
vi.mock('@/components/chat/blocks', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/chat/blocks')>()
    return {
        ...actual,
        renderChatBlock: vi.fn((_block: ChatBlock, _ctx: ChatBlockContext) => `rendered:${_block.id}`),
    }
})

// Mock ToolCallGroupRenderer
vi.mock('@/components/chat/blocks/ToolCallBlock', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/chat/blocks/ToolCallBlock')>()
    return {
        ...actual,
        ToolCallGroupRenderer: (_props: { blocks: ToolCallBlock[] }) => `group:${_props.blocks.map(b => b.id).join(',')}`,
    }
})

/* ───── 工厂函数 ───── */

function createUserText(overrides: Partial<UserTextBlock> = {}): UserTextBlock {
    return {
        kind: 'user-text',
        id: 'user-1',
        localId: null,
        createdAt: 1000,
        blocks: [{ type: 'text', text: 'Hello' }],
        status: 'delivered',
        ...overrides,
    }
}

function createAgentText(overrides: Partial<AgentTextBlock> = {}): AgentTextBlock {
    return {
        kind: 'agent-text',
        id: 'agent-1',
        localId: null,
        createdAt: 1000,
        text: 'Hi there',
        isSnapshot: false,
        ...overrides,
    }
}

function createToolCall(overrides: Partial<ToolCallBlock> = {}): ToolCallBlock {
    const id = overrides.id ?? 'tc-1'
    const toolOverrides = overrides.tool ?? {}
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 1000,
        tool: {
            id,
            name: 'Bash',
            state: 'running',
            input: {},
            createdAt: 1000,
            startedAt: null,
            completedAt: null,
            description: null,
            ...toolOverrides,
        } satisfies ChatToolCall,
        children: [],
        ...overrides,
    }
}

function createCompletedToolCall(id: string, overrides: Partial<ToolCallBlock> = {}): ToolCallBlock {
    return createToolCall({
        id,
        ...overrides,
        tool: {
            id,
            name: 'Bash',
            state: 'completed',
            input: {},
            createdAt: 1000,
            startedAt: 1000,
            completedAt: 2000,
            description: null,
            result: 'done',
            ...(overrides.tool ?? {}),
        } satisfies ChatToolCall,
    })
}

function createAgentEvent(overrides: Partial<AgentEventBlock> = {}): AgentEventBlock {
    return {
        kind: 'agent-event',
        id: 'event-1',
        createdAt: 1000,
        event: { type: 'ready' },
        ...overrides,
    }
}

/* ───── 默认上下文 ───── */

const defaultCtx: ChatBlockContext = {
    metadata: null,
    isThinking: false,
    api: undefined,
    sessionId: 'test-session',
    disabled: false,
}

const defaultOptions = {
    contextResetLabel: 'Context cleared',
    rewoundToHereLabel: 'Rewound to here',
    rewindFailedLabel: 'Rewind failed',
    skippedLinksLabel: '{{count}} path(s) skipped',
}

/** 把 React span 的 children（可能是 string/number/array/嵌套）拍平成纯文本，便于子串断言 */
function childrenToText(children: unknown): string {
    if (children == null || children === false) return ''
    if (typeof children === 'string' || typeof children === 'number') return String(children)
    if (Array.isArray(children)) return children.map(childrenToText).join('')
    if (typeof children === 'object' && 'props' in children) {
        return childrenToText((children as React.ReactElement).props?.children)
    }
    return ''
}

/* ═══════════════════════════════════════════════════════════════
 * 测试用例
 * ═══════════════════════════════════════════════════════════════ */

describe('buildChatBubbleItems', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    /* ─── 1. 角色映射 ─── */

    describe('角色映射', () => {
        it('user-text → role: user', () => {
            const blocks = [createUserText({ id: 'u1' })]
            const items = buildChatBubbleItems(blocks, defaultCtx, false, defaultOptions)
            expect(items).toHaveLength(1)
            expect(items[0].role).toBe('user')
            expect(items[0].key).toBe('u1')
        })

        it('agent-text → role: assistant', () => {
            const blocks = [createAgentText({ id: 'a1' })]
            const items = buildChatBubbleItems(blocks, defaultCtx, false, defaultOptions)
            expect(items).toHaveLength(1)
            expect(items[0].role).toBe('assistant')
            expect(items[0].key).toBe('a1')
        })

        it('agent-event(turn-result) → role: assistant', () => {
            const blocks = [
                createAgentEvent({
                    id: 'ev1',
                    event: { type: 'turn-result', durationMs: 1000, tokens: 50 },
                }),
            ]
            const items = buildChatBubbleItems(blocks, defaultCtx, false, defaultOptions)
            expect(items).toHaveLength(1)
            expect(items[0].role).toBe('assistant')
        })

        it('agent-event(non-turn-result) → role: system', () => {
            const blocks = [
                createAgentEvent({
                    id: 'ev2',
                    event: { type: 'ready' },
                }),
            ]
            const items = buildChatBubbleItems(blocks, defaultCtx, false, defaultOptions)
            expect(items).toHaveLength(1)
            expect(items[0].role).toBe('system')
        })

        it('tool-call → role: assistant', () => {
            const blocks = [createToolCall({ id: 'tc1' })]
            const items = buildChatBubbleItems(blocks, defaultCtx, false, defaultOptions)
            expect(items).toHaveLength(1)
            expect(items[0].role).toBe('assistant')
        })
    })

    /* ─── 2. typing 标记 ─── */

    describe('typing 标记', () => {
        it('最后一个 agent-text + isRunning=true → typing=true', () => {
            const blocks = [createAgentText({ id: 'a1' })]
            const items = buildChatBubbleItems(blocks, defaultCtx, true, defaultOptions)
            expect(items).toHaveLength(1)
            expect(items[0].typing).toBe(true)
        })

        it('最后一个 agent-text + isRunning=false → typing 为 falsy', () => {
            const blocks = [createAgentText({ id: 'a1' })]
            const items = buildChatBubbleItems(blocks, defaultCtx, false, defaultOptions)
            expect(items).toHaveLength(1)
            expect(items[0].typing).toBeFalsy()
        })

        it('非最后一个 agent-text 即使 isRunning=true 也不标记 typing', () => {
            // tool-call 排在最后，所以 agent-text 不是最后一个 assistant block
            const blocks = [
                createAgentText({ id: 'a1' }),
                createToolCall({ id: 'tc1' }),
            ]
            const items = buildChatBubbleItems(blocks, defaultCtx, true, defaultOptions)
            // agent-text 不是最后一个 assistant block，所以 typing 为 falsy
            const agentItem = items.find(i => i.key === 'a1')
            expect(agentItem).toBeDefined()
            expect(agentItem!.typing).toBeFalsy()
        })

        it('最后一个 agent-reasoning + isRunning=true → typing=true', () => {
            const blocks = [
                {
                    kind: 'agent-reasoning' as const,
                    id: 'r1',
                    localId: null,
                    createdAt: 1000,
                    text: 'thinking...',
                    isSnapshot: false,
                },
            ]
            const items = buildChatBubbleItems(blocks, defaultCtx, true, defaultOptions)
            expect(items).toHaveLength(1)
            expect(items[0].typing).toBe(true)
        })

        // 取 renderChatBlock mock 最后一次调用收到的 ctx.isThinking
        const lastReasoningCtxIsThinking = () => {
            const call = vi.mocked(renderChatBlock).mock.calls.at(-1)!
            return (call[1] as ChatBlockContext).isThinking
        }

        it('agent-reasoning done:true（思考完成）即使 isRunning=true → isThinking=false（消除误判窗口）', () => {
            const blocks = [{
                kind: 'agent-reasoning' as const,
                id: 'r-done',
                localId: null,
                createdAt: 1000,
                text: '想完了',
                isSnapshot: false,
                done: true,
                durationMs: 1234,
            }]
            buildChatBubbleItems(blocks, defaultCtx, true, defaultOptions)
            expect(lastReasoningCtxIsThinking()).toBe(false)
        })

        it('agent-reasoning done 缺省（local/历史消息）+ isRunning=true → isThinking=true（退化为现有逻辑）', () => {
            const blocks = [{
                kind: 'agent-reasoning' as const,
                id: 'r-local',
                localId: null,
                createdAt: 1000,
                text: '本地思考',
                isSnapshot: false,
            }]
            buildChatBubbleItems(blocks, defaultCtx, true, defaultOptions)
            expect(lastReasoningCtxIsThinking()).toBe(true)
        })
    })

    /* ─── 3. 工具组折叠 ─── */

    describe('工具组折叠', () => {
        it('≥2 连续 completed tool-calls → tool-call-group (role: assistant)', () => {
            const tc1 = createCompletedToolCall('tc1', { tool: { name: 'Bash' } as ChatToolCall })
            const tc2 = createCompletedToolCall('tc2', { tool: { name: 'Read' } as ChatToolCall })
            const blocks = [tc1, tc2]

            const items = buildChatBubbleItems(blocks, defaultCtx, false, defaultOptions)
            // 折叠为一组
            expect(items).toHaveLength(1)
            expect(items[0].role).toBe('assistant')
            expect(items[0].key).toBe('group-tc1')
            expect(items[0].variant).toBe('borderless')
        })

        it('<2 completed → 不分组，各自独立', () => {
            const tc1 = createToolCall({
                id: 'tc1',
                tool: { name: 'Bash', state: 'running' } as ChatToolCall,
            })
            const tc2 = createCompletedToolCall('tc2', { tool: { name: 'Read' } as ChatToolCall })

            // 只有 1 个 completed，不满足 ≥2 条件
            const blocks = [tc1, tc2]
            const items = buildChatBubbleItems(blocks, defaultCtx, false, defaultOptions)

            // 两个单独的 tool-call，无折叠组
            expect(items).toHaveLength(2)
            expect(items.every(i => i.role === 'assistant')).toBe(true)
        })
    })

    /* ─── 4. context-cleared ─── */

    describe('context-cleared', () => {
        it('context-cleared 事件 → role: divider', () => {
            const blocks = [
                createAgentEvent({
                    id: 'ev-ctx',
                    event: { type: 'context-cleared' } as AgentEventBlock['event'],
                }),
            ]
            const items = buildChatBubbleItems(blocks, defaultCtx, false, defaultOptions)
            expect(items).toHaveLength(1)
            expect(items[0].role).toBe('divider')
            expect(items[0].key).toBe('ev-ctx')
        })

        it('context-cleared 的 content 包含翻译标签', () => {
            const blocks = [
                createAgentEvent({
                    id: 'ev-ctx',
                    event: { type: 'context-cleared' } as AgentEventBlock['event'],
                }),
            ]
            const items = buildChatBubbleItems(blocks, defaultCtx, false, defaultOptions)
            // 验证关联的原始 block
            expect(items[0].block).toBeDefined()
            expect(items[0].block!.kind).toBe('agent-event')
        })

        it('context-cleared 与其他 block 混合时顺序正确', () => {
            const blocks = [
                createUserText({ id: 'u1' }),
                createAgentEvent({
                    id: 'ev-ctx',
                    event: { type: 'context-cleared' } as AgentEventBlock['event'],
                }),
                createAgentText({ id: 'a1' }),
            ]
            const items = buildChatBubbleItems(blocks, defaultCtx, false, defaultOptions)
            expect(items).toHaveLength(3)
            expect(items[0].role).toBe('user')
            expect(items[1].role).toBe('divider')
            expect(items[2].role).toBe('assistant')
        })
    })

    /* ─── 5. rewind-completed 分隔线 ─── */

    describe('compact-started', () => {
        it('compact-started 是纯状态信号，不渲染气泡（压缩中视觉由 CommandProgressBubble 承担）', () => {
            const blocks = [
                createUserText({ id: 'u1' }),
                createAgentEvent({ id: 'ev-started', event: { type: 'compact-started' } as AgentEventBlock['event'] }),
                createAgentText({ id: 'a1' }),
            ]
            const items = buildChatBubbleItems(blocks, defaultCtx, false, defaultOptions)
            expect(items).toHaveLength(2)
            expect(items.map(i => i.key)).toEqual(['u1', 'a1'])
        })
    })

    describe('rewind-completed', () => {
        it('filesRestored=true → 显示「已回退至此」', () => {
            const blocks = [
                createAgentEvent({
                    id: 'ev-rw',
                    event: { type: 'rewind-completed', filesRestored: true } as AgentEventBlock['event'],
                }),
            ]
            const items = buildChatBubbleItems(blocks, defaultCtx, false, defaultOptions)
            expect(items).toHaveLength(1)
            expect(items[0].role).toBe('divider')
            const container = items[0].content as React.ReactElement<{ children: React.ReactNode }>
            const text = childrenToText(container.props.children)
            expect(text).toContain('Rewound to here')
        })

        it('filesRestored=false 且 error 存在 → 显示「回退失败」+ error 文本', () => {
            const blocks = [
                createAgentEvent({
                    id: 'ev-rw-fail',
                    event: {
                        type: 'rewind-completed',
                        filesRestored: false,
                        error: 'rewind rejected: Resume rejected by --resume-drops-turn: ...',
                    } as AgentEventBlock['event'],
                }),
            ]
            const items = buildChatBubbleItems(blocks, defaultCtx, false, defaultOptions)
            expect(items).toHaveLength(1)
            expect(items[0].role).toBe('divider')
            const container = items[0].content as React.ReactElement<{ children: React.ReactNode }>
            const text = childrenToText(container.props.children)
            expect(text).toContain('Rewind failed')
            expect(text).toContain('rewind rejected: Resume rejected')
            // 不应显示成功文案
            expect(text).not.toContain('Rewound to here')
        })

        it('filesRestored=true + skippedLinks>0 → 追加跳过提示', () => {
            const blocks = [
                createAgentEvent({
                    id: 'ev-rw-skip',
                    event: { type: 'rewind-completed', filesRestored: true, skippedLinks: 3 } as AgentEventBlock['event'],
                }),
            ]
            const items = buildChatBubbleItems(blocks, defaultCtx, false, defaultOptions)
            const container = items[0].content as React.ReactElement<{ children: React.ReactNode }>
            const text = childrenToText(container.props.children)
            expect(text).toContain('Rewound to here')
            expect(text).toContain('3 path(s) skipped')
        })

        it('filesRestored=false + error 时仍显失败文案（不因 skippedLinks 走成功分支）', () => {
            const blocks = [
                createAgentEvent({
                    id: 'ev-rw-fail-skip',
                    event: {
                        type: 'rewind-completed',
                        filesRestored: false,
                        error: 'rewind rejected: x',
                        skippedLinks: 2,
                    } as AgentEventBlock['event'],
                }),
            ]
            const items = buildChatBubbleItems(blocks, defaultCtx, false, defaultOptions)
            const container = items[0].content as React.ReactElement<{ children: React.ReactNode }>
            const text = childrenToText(container.props.children)
            expect(text).toContain('Rewind failed')
            expect(text).not.toContain('Rewound to here')
            // skippedLinks>0 时无论成败都追加跳过提示（文件回滚成功但截断失败的中间态也需展示）
            expect(text).toContain('2 path(s) skipped')
        })
    })
})
