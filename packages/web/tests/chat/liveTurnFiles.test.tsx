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
 * 流式 turn 文件投影测试（审查 v3 票05）：投影纯函数 + buildChatBubbleItems 接线
 * （isRunning 门槛 / turn-result 边界重置 / 权威卡让位）。
 */

import { describe, expect, it, vi } from 'vitest'
import type { ChatBlock, ChatToolCall, ToolCallBlock, AgentEventBlock } from '@/domain/chat'
import type { ChatBlockContext } from '@/components/chat/blocks'
import { buildChatBubbleItems } from '@/components/chat/buildBubbleItems'
import { projectLiveTurnFiles } from '@/components/chat/liveTurnFiles'

vi.mock('@/components/chat/blocks', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/chat/blocks')>()
    return {
        ...actual,
        renderChatBlock: vi.fn((_block: ChatBlock) => `rendered:${_block.id}`),
    }
})

function createEditToolCall(id: string, filePath: string, lines: string[], name = 'Edit'): ToolCallBlock {
    const tool = {
        id,
        name,
        state: 'completed',
        input: { file_path: filePath },
        createdAt: 1000,
        startedAt: 1000,
        completedAt: 2000,
        description: null,
        result: 'done',
        structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines }],
    } satisfies ChatToolCall
    return { kind: 'tool-call', id, localId: null, createdAt: 1000, tool, children: [] }
}

function createTurnResult(id: string): AgentEventBlock {
    return { kind: 'agent-event', id, createdAt: 1000, event: { type: 'turn-result', summary: 'done' } } as unknown as AgentEventBlock
}

const defaultCtx: ChatBlockContext = { metadata: null, isThinking: false }
const defaultOptions = {
    contextResetLabel: 'ctx',
    rewoundToHereLabel: 'rw',
    rewindFailedLabel: 'rwfail',
    skippedLinksLabel: '{{count}}',
}

describe('projectLiveTurnFiles', () => {
    it('Edit 族工具投影文件与行数；非编辑族跳过', () => {
        const blocks: ChatBlock[] = [
            createEditToolCall('t1', '/p/a.ts', ['+one', '-x', ' ctx']),
            createEditToolCall('t2', '/p/b.sh', ['+run'], 'Bash'),
        ]
        expect(projectLiveTurnFiles(blocks)).toEqual([{ path: '/p/a.ts', additions: 1, deletions: 1 }])
    })

    it('同文件多次编辑行数累加；无 structuredPatch 计 0 但文件在列', () => {
        const blocks: ChatBlock[] = [
            createEditToolCall('t1', '/p/a.ts', ['+one']),
            createEditToolCall('t2', '/p/a.ts', ['+two', '-old']),
        ]
        expect(projectLiveTurnFiles(blocks)).toEqual([{ path: '/p/a.ts', additions: 2, deletions: 1 }])
    })

    it('turn-result 事件重置段：上一轮的编辑不再投影', () => {
        const blocks: ChatBlock[] = [
            createEditToolCall('prev', '/p/old.ts', ['+x']),
            createTurnResult('r1'),
            createEditToolCall('cur', '/p/new.ts', ['+y']),
        ]
        expect(projectLiveTurnFiles(blocks)).toEqual([{ path: '/p/new.ts', additions: 1, deletions: 0 }])
    })
})

describe('buildChatBubbleItems 接线（live turn 文件卡）', () => {
    it('isRunning 且本轮有编辑：列表尾追加 live-turn-files 项', () => {
        const blocks: ChatBlock[] = [createEditToolCall('t1', '/p/a.ts', ['+one'])]
        const items = buildChatBubbleItems(blocks, defaultCtx, true, defaultOptions)
        expect(items.at(-1)!.key).toBe('live-turn-files')
    })

    it('非运行态：不追加（会话中断后的历史残留段不显示 live 卡）', () => {
        const blocks: ChatBlock[] = [createEditToolCall('t1', '/p/a.ts', ['+one'])]
        expect(buildChatBubbleItems(blocks, defaultCtx, false, defaultOptions).filter((i) => i.key === 'live-turn-files')).toHaveLength(0)
    })

    it('result 到达（段重置）：live 卡消失，权威 turn-diff 卡让位不闪变', () => {
        const blocks: ChatBlock[] = [
            createEditToolCall('t1', '/p/a.ts', ['+one']),
            createTurnResult('r1'),
        ]
        expect(buildChatBubbleItems(blocks, defaultCtx, true, defaultOptions).filter((i) => i.key === 'live-turn-files')).toHaveLength(0)
    })
})
