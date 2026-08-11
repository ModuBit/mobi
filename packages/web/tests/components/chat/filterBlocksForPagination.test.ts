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
import { filterBlocksForPagination } from '@/components/chat/filterBlocksForPagination'
import type { ChatBlock, ToolCallBlock } from '@/domain/chat/types'

/** 构造 tool-call 块的辅助函数 */
function toolCall(id: string, state: 'running' | 'completed' | 'error' | 'pending'): ToolCallBlock {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 0,
        children: [],
        tool: {
            id,
            name: 'Write',
            state,
            input: null,
            createdAt: 0,
            startedAt: state === 'running' ? 0 : null,
            completedAt: state === 'completed' ? 0 : null,
            description: null,
        },
    }
}

/** 构造 agent-text 块的辅助函数 */
function text(id: string): ChatBlock {
    return { kind: 'agent-text', id, localId: null, createdAt: 0, text: 'x' } as ChatBlock
}

describe('filterBlocksForPagination', () => {
    it('hasNextPage=false 时原样返回（无孤儿风险）', () => {
        const blocks: ChatBlock[] = [text('t1'), toolCall('w1', 'running')]
        expect(filterBlocksForPagination(blocks, false)).toBe(blocks)
    })

    it('保留尾部的活跃 running 工具块（核心修复点：等 result 才渲染）', () => {
        // 模拟真实场景：历史文本 + 一个正在执行的 Write（尾部）
        const blocks: ChatBlock[] = [text('t1'), text('t2'), toolCall('w-active', 'running')]
        const out = filterBlocksForPagination(blocks, true)
        expect(out.map(b => b.id)).toEqual(['t1', 't2', 'w-active'])
    })

    it('过滤中部的孤儿 running 工具块（结果被分页切走）', () => {
        // w-orphan 在中部，其后还有更新的文本块 → 结果应已到达却未到 → 孤儿，过滤
        const blocks: ChatBlock[] = [
            text('t1'),
            toolCall('w-orphan', 'running'),
            text('t2-newer'),
        ]
        const out = filterBlocksForPagination(blocks, true)
        expect(out.map(b => b.id)).toEqual(['t1', 't2-newer'])
    })

    it('活跃与孤儿并存：只过滤中部孤儿，保留尾部活跃', () => {
        const blocks: ChatBlock[] = [
            toolCall('w-orphan', 'running'),  // 中部孤儿
            text('middle'),
            toolCall('w-active', 'running'),  // 尾部活跃
        ]
        const out = filterBlocksForPagination(blocks, true)
        expect(out.map(b => b.id)).toEqual(['middle', 'w-active'])
    })

    it('保留尾部连续的多个并行 running 工具块（活跃组）', () => {
        // 同一 turn 内并行调用多工具，全部 running，全在尾部 → 全保留
        const blocks: ChatBlock[] = [
            text('t1'),
            toolCall('w-a', 'running'),
            toolCall('w-b', 'running'),
            toolCall('w-c', 'running'),
        ]
        const out = filterBlocksForPagination(blocks, true)
        expect(out.map(b => b.id)).toEqual(['t1', 'w-a', 'w-b', 'w-c'])
    })

    it('completed/error/pending 工具块一律不受影响', () => {
        const blocks: ChatBlock[] = [
            toolCall('w-done', 'completed'),
            toolCall('w-err', 'error'),
            toolCall('w-pend', 'pending'),
            text('tail'),
        ]
        expect(filterBlocksForPagination(blocks, true).map(b => b.id)).toEqual([
            'w-done', 'w-err', 'w-pend', 'tail',
        ])
    })

    it('无 running 工具块时原样返回', () => {
        const blocks: ChatBlock[] = [text('t1'), toolCall('w-done', 'completed')]
        expect(filterBlocksForPagination(blocks, true).map(b => b.id)).toEqual(['t1', 'w-done'])
    })

    it('尾部最后一个块非 running 时，所有中部 running 工具块都视为孤儿过滤', () => {
        const blocks: ChatBlock[] = [
            toolCall('w-orphan1', 'running'),
            toolCall('w-orphan2', 'running'),
            text('newer-tail'),
        ]
        expect(filterBlocksForPagination(blocks, true).map(b => b.id)).toEqual(['newer-tail'])
    })

    it('全部是 running 工具块（无尾部非 running 边界）原样返回保引用', () => {
        const blocks: ChatBlock[] = [toolCall('w1', 'running'), toolCall('w2', 'running')]
        expect(filterBlocksForPagination(blocks, true)).toBe(blocks)
    })

    it('空数组原样返回', () => {
        const blocks: ChatBlock[] = []
        expect(filterBlocksForPagination(blocks, true)).toBe(blocks)
    })
})
