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

import { describe, expect, it } from 'vitest'
import { groupCollapsibleToolCalls, formatGroupTitle } from '@/domain/chat/groupToolCalls'
import type { ToolCallBlock } from '@/domain/chat'
import type { ChatBlock } from '@/domain/chat'

function makeToolCall(overrides: Partial<{
  id: string
  name: string
  state: ToolCallBlock['tool']['state']
}> = {}): ToolCallBlock {
  const id = overrides.id ?? 'tc-1'
  return {
    kind: 'tool-call',
    id,
    localId: null,
    createdAt: 1000,
    tool: {
      id,
      name: overrides.name ?? 'Bash',
      state: overrides.state ?? 'completed',
      input: {},
      createdAt: 1000,
      startedAt: null,
      completedAt: null,
      description: null,
    },
    children: [],
  }
}

function makeTextBlock(id = 'text-1'): ChatBlock {
  return {
    kind: 'agent-text',
    id,
    localId: null,
    createdAt: 1000,
    text: 'hello',
  }
}

describe('groupCollapsibleToolCalls', () => {
  it('无工具调用时不分组', () => {
    const blocks: ChatBlock[] = [makeTextBlock('t1'), makeTextBlock('t2')]
    const result = groupCollapsibleToolCalls(blocks)
    expect(result).toEqual(blocks)
    expect(result).toHaveLength(2)
  })

  it('单个可折叠工具不分组', () => {
    const blocks: ChatBlock[] = [
      makeToolCall({ id: 'tc1', name: 'Bash' }),
    ]
    const result = groupCollapsibleToolCalls(blocks)
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(blocks[0])
  })

  it('两个连续 completed 可折叠工具分为一组', () => {
    const tc1 = makeToolCall({ id: 'tc1', name: 'Bash' })
    const tc2 = makeToolCall({ id: 'tc2', name: 'Read' })
    const result = groupCollapsibleToolCalls([tc1, tc2])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'tool-call-group',
      id: 'group-tc1',
      blocks: [tc1, tc2],
    })
  })

  it('非可折叠工具打断 Zone', () => {
    const tc1 = makeToolCall({ id: 'tc1', name: 'Bash' })
    const edit = makeToolCall({ id: 'edit1', name: 'Edit' })
    const tc2 = makeToolCall({ id: 'tc2', name: 'Read' })
    const result = groupCollapsibleToolCalls([tc1, edit, tc2])
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual(tc1)
    expect(result[1]).toEqual(edit)
    expect(result[2]).toEqual(tc2)
  })

  it('其他类型 block 打断 Zone', () => {
    const tc1 = makeToolCall({ id: 'tc1', name: 'Bash' })
    const text = makeTextBlock('t1')
    const tc2 = makeToolCall({ id: 'tc2', name: 'Read' })
    const result = groupCollapsibleToolCalls([tc1, text, tc2])
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual(tc1)
    expect(result[1]).toEqual(text)
    expect(result[2]).toEqual(tc2)
  })

  it('Zone 内 completed 归入折叠，其余排在后面', () => {
    const tc1 = makeToolCall({ id: 'tc1', name: 'Read', state: 'completed' })
    const tc2 = makeToolCall({ id: 'tc2', name: 'Read', state: 'running' })
    const tc3 = makeToolCall({ id: 'tc3', name: 'Read', state: 'completed' })
    const tc4 = makeToolCall({ id: 'tc4', name: 'Read', state: 'error' })
    const tc5 = makeToolCall({ id: 'tc5', name: 'Read', state: 'completed' })
    const result = groupCollapsibleToolCalls([tc1, tc2, tc3, tc4, tc5])
    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({
      kind: 'tool-call-group',
      blocks: [tc1, tc3, tc5],
    })
    expect(result[1]).toEqual(tc2)
    expect(result[2]).toEqual(tc4)
  })

  it('Zone 内 completed < 2 时全部单独展示，保持原始顺序', () => {
    const tc1 = makeToolCall({ id: 'tc1', name: 'Read', state: 'running' })
    const tc2 = makeToolCall({ id: 'tc2', name: 'Read', state: 'completed' })
    const tc3 = makeToolCall({ id: 'tc3', name: 'Read', state: 'running' })
    const result = groupCollapsibleToolCalls([tc1, tc2, tc3])
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual(tc1)
    expect(result[1]).toEqual(tc2)
    expect(result[2]).toEqual(tc3)
  })

  it('全部 running 时不分组', () => {
    const blocks = [
      makeToolCall({ id: 'tc1', name: 'Bash', state: 'running' }),
      makeToolCall({ id: 'tc2', name: 'Read', state: 'running' }),
      makeToolCall({ id: 'tc3', name: 'Grep', state: 'running' }),
    ]
    const result = groupCollapsibleToolCalls(blocks)
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual(blocks[0])
    expect(result[1]).toEqual(blocks[1])
    expect(result[2]).toEqual(blocks[2])
  })

  it('多个 Zone 各自独立分组', () => {
    const bash1 = makeToolCall({ id: 'b1', name: 'Bash' })
    const bash2 = makeToolCall({ id: 'b2', name: 'Bash' })
    const text = makeTextBlock('t1')
    const read1 = makeToolCall({ id: 'r1', name: 'Read' })
    const read2 = makeToolCall({ id: 'r2', name: 'Read' })
    const result = groupCollapsibleToolCalls([bash1, bash2, text, read1, read2])
    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({ kind: 'tool-call-group', blocks: [bash1, bash2] })
    expect(result[1]).toEqual(text)
    expect(result[2]).toMatchObject({ kind: 'tool-call-group', blocks: [read1, read2] })
  })

  it('shell_command 也是可折叠工具', () => {
    const tc1 = makeToolCall({ id: 'tc1', name: 'shell_command' })
    const tc2 = makeToolCall({ id: 'tc2', name: 'shell_command' })
    const result = groupCollapsibleToolCalls([tc1, tc2])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ kind: 'tool-call-group' })
  })

  it('空数组返回空数组', () => {
    expect(groupCollapsibleToolCalls([])).toEqual([])
  })

  it('pending 状态等同于 running，不参与折叠', () => {
    const tc1 = makeToolCall({ id: 'tc1', name: 'Bash', state: 'completed' })
    const tc2 = makeToolCall({ id: 'tc2', name: 'Bash', state: 'pending' })
    const tc3 = makeToolCall({ id: 'tc3', name: 'Bash', state: 'completed' })
    const result = groupCollapsibleToolCalls([tc1, tc2, tc3])
    // completed(tc1, tc3) 归入折叠，pending(tc2) 排在后面
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      kind: 'tool-call-group',
      blocks: [tc1, tc3],
    })
    expect(result[1]).toEqual(tc2)
  })

  it('混合工具名在同一 Zone 内折叠', () => {
    const bash = makeToolCall({ id: 'b1', name: 'Bash' })
    const read = makeToolCall({ id: 'r1', name: 'Read' })
    const grep = makeToolCall({ id: 'g1', name: 'Grep' })
    const glob = makeToolCall({ id: 'gl1', name: 'Glob' })
    const result = groupCollapsibleToolCalls([bash, read, grep, glob])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'tool-call-group',
      id: 'group-b1',
      blocks: [bash, read, grep, glob],
    })
  })

  it('Glob 和 Grep 是可折叠工具', () => {
    const g1 = makeToolCall({ id: 'g1', name: 'Glob' })
    const g2 = makeToolCall({ id: 'g2', name: 'Grep' })
    const result = groupCollapsibleToolCalls([g1, g2])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ kind: 'tool-call-group' })
  })

  it('多个 Zone 的 group ID 互不相同', () => {
    const b1 = makeToolCall({ id: 'b1', name: 'Bash' })
    const b2 = makeToolCall({ id: 'b2', name: 'Bash' })
    const text = makeTextBlock('t1')
    const r1 = makeToolCall({ id: 'r1', name: 'Read' })
    const r2 = makeToolCall({ id: 'r2', name: 'Read' })
    const result = groupCollapsibleToolCalls([b1, b2, text, r1, r2])
    const group1 = result[0] as Extract<typeof result[0], { kind: 'tool-call-group' }>
    const group2 = result[2] as Extract<typeof result[2], { kind: 'tool-call-group' }>
    expect(group1.id).toBe('group-b1')
    expect(group2.id).toBe('group-r1')
    expect(group1.id).not.toBe(group2.id)
  })
})

describe('formatGroupTitle', () => {
  it('混合工具类别', () => {
    const blocks = [
      makeToolCall({ id: 'b1', name: 'Bash' }),
      makeToolCall({ id: 'b2', name: 'shell_command' }),
      makeToolCall({ id: 'r1', name: 'Read' }),
      makeToolCall({ id: 'r2', name: 'Read' }),
      makeToolCall({ id: 'r3', name: 'Read' }),
    ]
    expect(formatGroupTitle(blocks)).toBe('Run 2 shell commands, read 3 files')
  })

  it('单一工具类别单数', () => {
    const blocks = [makeToolCall({ id: 'r1', name: 'Read' })]
    expect(formatGroupTitle(blocks)).toBe('Read 1 file')
  })

  it('Glob 和 Grep 分开统计', () => {
    const blocks = [
      makeToolCall({ id: 'g1', name: 'Glob' }),
      makeToolCall({ id: 'g2', name: 'Grep' }),
    ]
    expect(formatGroupTitle(blocks)).toBe('Find 1 pattern, search 1 pattern')
  })

  it('全四类混合', () => {
    const blocks = [
      makeToolCall({ id: 'b1', name: 'Bash' }),
      makeToolCall({ id: 'r1', name: 'Read' }),
      makeToolCall({ id: 'r2', name: 'Read' }),
      makeToolCall({ id: 'gl1', name: 'Glob' }),
      makeToolCall({ id: 'gr1', name: 'Grep' }),
      makeToolCall({ id: 'gr2', name: 'Grep' }),
    ]
    expect(formatGroupTitle(blocks)).toBe('Run 1 shell command, read 2 files, find 1 pattern, search 2 patterns')
  })

  it('空数组返回空字符串', () => {
    expect(formatGroupTitle([])).toBe('')
  })

  it('复数形式正确', () => {
    const blocks = [
      makeToolCall({ id: 'b1', name: 'Bash' }),
      makeToolCall({ id: 'b2', name: 'Bash' }),
      makeToolCall({ id: 'b3', name: 'Bash' }),
    ]
    expect(formatGroupTitle(blocks)).toBe('Run 3 shell commands')
  })
})
