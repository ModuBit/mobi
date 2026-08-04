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
import type { AgentReasoningBlock, ToolCallBlock } from '@/domain/chat'
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

function makeReasoning(overrides: Partial<{
  id: string
  text: string
  durationMs?: number
  done?: boolean
}> = {}): AgentReasoningBlock {
  const id = overrides.id ?? 'rs-1'
  return {
    kind: 'agent-reasoning',
    id,
    localId: null,
    createdAt: 1000,
    text: overrides.text ?? '思考内容',
    ...(overrides.durationMs != null ? { durationMs: overrides.durationMs } : {}),
    ...(overrides.done != null ? { done: overrides.done } : {}),
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
    const nonCollapsible = makeToolCall({ id: 'nc1', name: 'AskUserQuestion' })
    const tc2 = makeToolCall({ id: 'tc2', name: 'Read' })
    const result = groupCollapsibleToolCalls([tc1, nonCollapsible, tc2])
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual(tc1)
    expect(result[1]).toEqual(nonCollapsible)
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

  it('Zone 内 completed 与 error 归入折叠，running/pending 排在后面', () => {
    const tc1 = makeToolCall({ id: 'tc1', name: 'Read', state: 'completed' })
    const tc2 = makeToolCall({ id: 'tc2', name: 'Read', state: 'running' })
    const tc3 = makeToolCall({ id: 'tc3', name: 'Read', state: 'completed' })
    const tc4 = makeToolCall({ id: 'tc4', name: 'Read', state: 'error' })
    const tc5 = makeToolCall({ id: 'tc5', name: 'Read', state: 'completed' })
    const result = groupCollapsibleToolCalls([tc1, tc2, tc3, tc4, tc5])
    // completed + error 均归入折叠（失败工具也进组），running/pending 排后
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({
      kind: 'tool-call-group',
      blocks: [tc1, tc3, tc4, tc5],
    })
    expect(result[1]).toEqual(tc2)
  })

  it('group id 锚定 Zone 起始块（即使首个未完成），避免 completed 首成员翻转导致 key 抖动', () => {
    // zone 首块是 running、completed 在其后 —— 组 id 应锚定 zone[0](tc1)，而非 completed[0](tc2)
    const tc1 = makeToolCall({ id: 'tc1', name: 'Read', state: 'running' })
    const tc2 = makeToolCall({ id: 'tc2', name: 'Read', state: 'completed' })
    const tc3 = makeToolCall({ id: 'tc3', name: 'Read', state: 'completed' })
    const result = groupCollapsibleToolCalls([tc1, tc2, tc3])
    expect(result).toHaveLength(2)
    const group = result[0] as Extract<typeof result[0], { kind: 'tool-call-group' }>
    // tc2/tc3 是 completed 归组；id 锚定 zone 起始 tc1
    expect(group.id).toBe('group-tc1')
    expect(group.blocks).toEqual([tc2, tc3])
    expect(result[1]).toEqual(tc1)
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

  describe('reasoning 与 tool 混组', () => {
    it('reasoning 与可折叠工具在同一 Zone 内混组成一组', () => {
      const rs = makeReasoning({ id: 'rs1', done: true })
      const bash = makeToolCall({ id: 'b1', name: 'Bash' })
      const result = groupCollapsibleToolCalls([rs, bash])
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        kind: 'tool-call-group',
        id: 'group-rs1', // 锚定 zone 起始块（reasoning）
        blocks: [rs, bash],
      })
    })

    it('纯 reasoning（连续 ≥2）也成组', () => {
      const rs1 = makeReasoning({ id: 'rs1', done: true })
      const rs2 = makeReasoning({ id: 'rs2', done: true })
      const result = groupCollapsibleToolCalls([rs1, rs2])
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ kind: 'tool-call-group', blocks: [rs1, rs2] })
    })

    it('活跃 reasoning（isActiveReasoning=true）散落可见、不进组，与 running tool 一致', () => {
      const rsActive = makeReasoning({ id: 'rs1', done: false })
      const bash = makeToolCall({ id: 'b1', name: 'Bash' })
      const read = makeToolCall({ id: 'r1', name: 'Read' })
      const result = groupCollapsibleToolCalls([rsActive, bash, read], {
        isActiveReasoning: b => b.id === 'rs1',
      })
      // bash/read completed 进组；活跃 rs1 散落在后
      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({ kind: 'tool-call-group', blocks: [bash, read] })
      expect(result[1]).toEqual(rsActive)
    })

    it('活跃 reasoning 打断 completed 计数：仅 1 个 completed 时不分组', () => {
      const rsActive = makeReasoning({ id: 'rs1', done: false })
      const bash = makeToolCall({ id: 'b1', name: 'Bash' })
      const result = groupCollapsibleToolCalls([rsActive, bash], {
        isActiveReasoning: b => b.id === 'rs1',
      })
      // completed 只有 bash 一个（<2），整个 zone 散落，保持原始顺序
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual(rsActive)
      expect(result[1]).toEqual(bash)
    })

    it('非活跃 reasoning（done 或默认）视为已完成，进组归档', () => {
      const rs = makeReasoning({ id: 'rs1', done: true })
      const bash = makeToolCall({ id: 'b1', name: 'Bash' })
      const result = groupCollapsibleToolCalls([rs, bash], {
        isActiveReasoning: () => false, // 无活跃
      })
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ kind: 'tool-call-group', blocks: [rs, bash] })
    })

    it('默认无谓词时 reasoning 视为已完成（向后兼容）', () => {
      const rs = makeReasoning({ id: 'rs1' }) // 无 done
      const bash = makeToolCall({ id: 'b1', name: 'Bash' })
      const result = groupCollapsibleToolCalls([rs, bash])
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ kind: 'tool-call-group', blocks: [rs, bash] })
    })
  })

  describe('MCP 工具折叠', () => {
    it('两个同 server 的 MCP 工具折叠为一组', () => {
      const tc1 = makeToolCall({ id: 'tc1', name: 'mcp__github__search' })
      const tc2 = makeToolCall({ id: 'tc2', name: 'mcp__github__read' })
      const result = groupCollapsibleToolCalls([tc1, tc2])
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        kind: 'tool-call-group',
        id: 'group-tc1',
        blocks: [tc1, tc2],
      })
    })

    it('不同 server 的 MCP 工具在同一 Zone 内折叠', () => {
      const tc1 = makeToolCall({ id: 'tc1', name: 'mcp__serverA__tool1' })
      const tc2 = makeToolCall({ id: 'tc2', name: 'mcp__serverB__tool2' })
      const result = groupCollapsibleToolCalls([tc1, tc2])
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        kind: 'tool-call-group',
        blocks: [tc1, tc2],
      })
    })

    it('MCP 工具与内置工具在同一 Zone 内折叠', () => {
      const bash = makeToolCall({ id: 'b1', name: 'Bash' })
      const mcp = makeToolCall({ id: 'm1', name: 'mcp__github__search' })
      const result = groupCollapsibleToolCalls([bash, mcp])
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        kind: 'tool-call-group',
        blocks: [bash, mcp],
      })
    })

    it('MCP 工具被非可折叠工具打断为两个 Zone', () => {
      const tc1 = makeToolCall({ id: 'tc1', name: 'mcp__github__search' })
      const nonCollapsible = makeToolCall({ id: 'nc1', name: 'AskUserQuestion' })
      const tc2 = makeToolCall({ id: 'tc2', name: 'mcp__github__read' })
      const result = groupCollapsibleToolCalls([tc1, nonCollapsible, tc2])
      expect(result).toHaveLength(3)
      expect(result[0]).toEqual(tc1)
      expect(result[1]).toEqual(nonCollapsible)
      expect(result[2]).toEqual(tc2)
    })

    it('MCP running 状态不参与折叠', () => {
      const tc1 = makeToolCall({ id: 'tc1', name: 'mcp__github__search', state: 'completed' })
      const tc2 = makeToolCall({ id: 'tc2', name: 'mcp__github__read', state: 'running' })
      const result = groupCollapsibleToolCalls([tc1, tc2])
      // completed < 2，不折叠
      expect(result).toHaveLength(2)
      expect(result[0]).toEqual(tc1)
      expect(result[1]).toEqual(tc2)
    })

    it('Plugin MCP 工具名正确识别', () => {
      const tc1 = makeToolCall({ id: 'tc1', name: 'mcp__plugin_chrome-devtools-mcp_chrome-devtools__click' })
      const tc2 = makeToolCall({ id: 'tc2', name: 'mcp__plugin_chrome-devtools-mcp_chrome-devtools__screenshot' })
      const result = groupCollapsibleToolCalls([tc1, tc2])
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ kind: 'tool-call-group' })
    })
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

  describe('reasoning 标题（thinking 总时长，非次数）', () => {
    it('reasoning durationMs 求和，与 tool 计数共存', () => {
      const blocks = [
        makeReasoning({ id: 'rs1', durationMs: 6000, done: true }),
        makeReasoning({ id: 'rs2', durationMs: 5000, done: true }),
        makeToolCall({ id: 'b1', name: 'Bash' }),
        makeToolCall({ id: 'b2', name: 'Bash' }),
      ]
      expect(formatGroupTitle(blocks)).toBe('Thought 11.0s, run 2 shell commands')
    })

    it('全无 durationMs（local/历史）兜底为 thought，无时长', () => {
      const blocks = [
        makeReasoning({ id: 'rs1' }),
        makeReasoning({ id: 'rs2' }),
        makeToolCall({ id: 'r1', name: 'Read' }),
        makeToolCall({ id: 'r2', name: 'Read' }),
        makeToolCall({ id: 'r3', name: 'Read' }),
      ]
      expect(formatGroupTitle(blocks)).toBe('Thought, read 3 files')
    })

    it('纯 reasoning 有时长', () => {
      const blocks = [
        makeReasoning({ id: 'rs1', durationMs: 6000 }),
        makeReasoning({ id: 'rs2', durationMs: 6000 }),
        makeReasoning({ id: 'rs3', durationMs: 6000 }),
      ]
      expect(formatGroupTitle(blocks)).toBe('Thought 18.0s')
    })

    it('纯 reasoning 无时长兜底', () => {
      const blocks = [
        makeReasoning({ id: 'rs1' }),
        makeReasoning({ id: 'rs2' }),
      ]
      expect(formatGroupTitle(blocks)).toBe('Thought')
    })

    it('部分有 durationMs 部分无（混合）按有值求和', () => {
      const blocks = [
        makeReasoning({ id: 'rs1', durationMs: 4000 }),
        makeReasoning({ id: 'rs2' }), // undefined 按 0
      ]
      expect(formatGroupTitle(blocks)).toBe('Thought 4.0s')
    })
  })

  describe('失败计数（formatFailedCount 回调）', () => {
    it('含 error 时追加失败计数', () => {
      const blocks = [
        makeToolCall({ id: 'r1', name: 'Read', state: 'error' }),
        makeToolCall({ id: 'r2', name: 'Read', state: 'completed' }),
        makeToolCall({ id: 'r3', name: 'Read', state: 'completed' }),
      ]
      expect(formatGroupTitle(blocks, { formatFailedCount: n => `${n} failed` })).toBe('Read 3 files · 1 failed')
    })

    it('全 error 时计数为组大小', () => {
      const blocks = [
        makeToolCall({ id: 'r1', name: 'Read', state: 'error' }),
        makeToolCall({ id: 'r2', name: 'Read', state: 'error' }),
      ]
      expect(formatGroupTitle(blocks, { formatFailedCount: n => `${n} failed` })).toBe('Read 2 files · 2 failed')
    })

    it('无 error 时不追加（即使传了回调）', () => {
      const blocks = [
        makeToolCall({ id: 'r1', name: 'Read', state: 'completed' }),
        makeToolCall({ id: 'r2', name: 'Read', state: 'completed' }),
      ]
      expect(formatGroupTitle(blocks, { formatFailedCount: n => `${n} failed` })).toBe('Read 2 files')
    })

    it('含 error 但未传回调时不追加', () => {
      const blocks = [
        makeToolCall({ id: 'r1', name: 'Read', state: 'error' }),
        makeToolCall({ id: 'r2', name: 'Read', state: 'completed' }),
      ]
      expect(formatGroupTitle(blocks)).toBe('Read 2 files')
    })

    it('含 error 与 reasoning 混合：reasoning 不计入失败', () => {
      const blocks = [
        makeReasoning({ id: 'rs1', durationMs: 1000 }),
        makeToolCall({ id: 'r1', name: 'Read', state: 'error' }),
        makeToolCall({ id: 'r2', name: 'Read', state: 'completed' }),
      ]
      expect(formatGroupTitle(blocks, { formatFailedCount: n => `${n} failed` })).toBe('Thought 1.0s, read 2 files · 1 failed')
    })
  })

  describe('MCP 标题格式', () => {
    it('单个 MCP server 计数', () => {
      const blocks = [
        makeToolCall({ id: 'm1', name: 'mcp__github__search' }),
        makeToolCall({ id: 'm2', name: 'mcp__github__read' }),
        makeToolCall({ id: 'm3', name: 'mcp__github__write' }),
      ]
      expect(formatGroupTitle(blocks)).toBe('Called github 3 times')
    })

    it('多个 MCP server 分别计数', () => {
      const blocks = [
        makeToolCall({ id: 'm1', name: 'mcp__serverA__tool1' }),
        makeToolCall({ id: 'm2', name: 'mcp__serverA__tool2' }),
        makeToolCall({ id: 'm3', name: 'mcp__serverB__tool1' }),
      ]
      expect(formatGroupTitle(blocks)).toBe('Called serverA 2 times, called serverB 1 time')
    })

    it('Plugin MCP server 显示名用冒号分隔', () => {
      const blocks = [
        makeToolCall({ id: 'm1', name: 'mcp__plugin_chrome-devtools-mcp_chrome-devtools__click' }),
        makeToolCall({ id: 'm2', name: 'mcp__plugin_chrome-devtools-mcp_chrome-devtools__screenshot' }),
        makeToolCall({ id: 'm3', name: 'mcp__plugin_chrome-devtools-mcp_chrome-devtools__navigate' }),
        makeToolCall({ id: 'm4', name: 'mcp__plugin_chrome-devtools-mcp_chrome-devtools__type' }),
      ]
      expect(formatGroupTitle(blocks)).toBe('Called plugin:chrome-devtools-mcp:chrome-devtools 4 times')
    })

    it('MCP + 内置工具混合计数', () => {
      const blocks = [
        makeToolCall({ id: 'b1', name: 'Bash' }),
        makeToolCall({ id: 'm1', name: 'mcp__github__search' }),
        makeToolCall({ id: 'm2', name: 'mcp__github__read' }),
      ]
      expect(formatGroupTitle(blocks)).toBe('Run 1 shell command, called github 2 times')
    })

    it('非 MCP 工具不影响现有行为', () => {
      const blocks = [
        makeToolCall({ id: 'r1', name: 'Read' }),
        makeToolCall({ id: 'r2', name: 'Read' }),
        makeToolCall({ id: 'r3', name: 'Read' }),
      ]
      expect(formatGroupTitle(blocks)).toBe('Read 3 files')
    })
  })

  describe('Web 与文件操作工具', () => {
    it('WebFetch/WebSearch 是可折叠工具，能成组', () => {
      const result = groupCollapsibleToolCalls([
        makeToolCall({ id: 'w1', name: 'WebFetch' }),
        makeToolCall({ id: 'w2', name: 'WebSearch' }),
      ])
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ kind: 'tool-call-group' })
    })

    it('Write/Edit/MultiEdit 是可折叠工具，能成组', () => {
      const result = groupCollapsibleToolCalls([
        makeToolCall({ id: 'e1', name: 'Write' }),
        makeToolCall({ id: 'e2', name: 'Edit' }),
        makeToolCall({ id: 'e3', name: 'MultiEdit' }),
      ])
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ kind: 'tool-call-group' })
    })

    it('Write/Edit 与 Read 同 Zone 混合成组', () => {
      const result = groupCollapsibleToolCalls([
        makeToolCall({ id: 'r1', name: 'Read' }),
        makeToolCall({ id: 'e1', name: 'Edit' }),
        makeToolCall({ id: 'w1', name: 'Write' }),
      ])
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({ kind: 'tool-call-group' })
    })

    it('WebFetch 计数（单数/复数）', () => {
      expect(formatGroupTitle([makeToolCall({ id: 'w1', name: 'WebFetch' })])).toBe('Fetch 1 page')
      expect(formatGroupTitle([
        makeToolCall({ id: 'w1', name: 'WebFetch' }),
        makeToolCall({ id: 'w2', name: 'WebFetch' }),
      ])).toBe('Fetch 2 pages')
    })

    it('WebSearch 计数', () => {
      expect(formatGroupTitle([
        makeToolCall({ id: 'w1', name: 'WebSearch' }),
        makeToolCall({ id: 'w2', name: 'WebSearch' }),
        makeToolCall({ id: 'w3', name: 'WebSearch' }),
      ])).toBe('Search the web 3 times')
    })

    it('Write/Edit/MultiEdit 合并 write 类别计数', () => {
      const blocks = [
        makeToolCall({ id: 'e1', name: 'Write' }),
        makeToolCall({ id: 'e2', name: 'Edit' }),
      ]
      expect(formatGroupTitle(blocks)).toBe('Edit 2 files')
    })

    it('read + websearch + edit 混合按固定顺序拼接', () => {
      const blocks = [
        makeToolCall({ id: 'r1', name: 'Read' }),
        makeToolCall({ id: 'w1', name: 'WebSearch' }),
        makeToolCall({ id: 'e1', name: 'Edit' }),
      ]
      expect(formatGroupTitle(blocks)).toBe('Read 1 file, search the web 1 time, edit 1 file')
    })

    it('全类别混合', () => {
      const blocks = [
        makeToolCall({ id: 'b1', name: 'Bash' }),
        makeToolCall({ id: 'r1', name: 'Read' }),
        makeToolCall({ id: 'gl1', name: 'Glob' }),
        makeToolCall({ id: 'gr1', name: 'Grep' }),
        makeToolCall({ id: 'wf1', name: 'WebFetch' }),
        makeToolCall({ id: 'ws1', name: 'WebSearch' }),
        makeToolCall({ id: 'e1', name: 'Edit' }),
      ]
      expect(formatGroupTitle(blocks)).toBe('Run 1 shell command, read 1 file, find 1 pattern, search 1 pattern, fetch 1 page, search the web 1 time, edit 1 file')
    })
  })
})
