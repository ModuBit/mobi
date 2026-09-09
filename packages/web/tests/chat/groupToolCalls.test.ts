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
import { groupCollapsibleToolCalls, formatGroupTitle, formatGroupActiveTitle, countFailedInGroup } from '@/domain/chat/groupToolCalls'
import zhLocale from '@/core/config/i18n/locales/zh.json'
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

  it('Zone 内各状态（completed/error/running/pending）均归入折叠，保持原始顺序', () => {
    const tc1 = makeToolCall({ id: 'tc1', name: 'Read', state: 'completed' })
    const tc2 = makeToolCall({ id: 'tc2', name: 'Read', state: 'running' })
    const tc3 = makeToolCall({ id: 'tc3', name: 'Read', state: 'completed' })
    const tc4 = makeToolCall({ id: 'tc4', name: 'Read', state: 'error' })
    const tc5 = makeToolCall({ id: 'tc5', name: 'Read', state: 'completed' })
    const result = groupCollapsibleToolCalls([tc1, tc2, tc3, tc4, tc5])
    // 成组只看连续可折叠块数量，与执行状态无关
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'tool-call-group',
      blocks: [tc1, tc2, tc3, tc4, tc5],
    })
  })

  it('group id 锚定 Zone 起始块（即使首个未完成），避免状态翻转导致 key 抖动', () => {
    // zone 首块是 running —— 组 id 应锚定 zone[0](tc1)
    const tc1 = makeToolCall({ id: 'tc1', name: 'Read', state: 'running' })
    const tc2 = makeToolCall({ id: 'tc2', name: 'Read', state: 'completed' })
    const tc3 = makeToolCall({ id: 'tc3', name: 'Read', state: 'completed' })
    const result = groupCollapsibleToolCalls([tc1, tc2, tc3])
    expect(result).toHaveLength(1)
    const group = result[0] as Extract<typeof result[0], { kind: 'tool-call-group' }>
    expect(group.id).toBe('group-tc1')
    expect(group.blocks).toEqual([tc1, tc2, tc3])
  })

  it('运行中与已完成混合（≥2）即成组，保持原始顺序', () => {
    const tc1 = makeToolCall({ id: 'tc1', name: 'Read', state: 'running' })
    const tc2 = makeToolCall({ id: 'tc2', name: 'Read', state: 'completed' })
    const tc3 = makeToolCall({ id: 'tc3', name: 'Read', state: 'running' })
    const result = groupCollapsibleToolCalls([tc1, tc2, tc3])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'tool-call-group',
      blocks: [tc1, tc2, tc3],
    })
  })

  it('全部 running 也成组', () => {
    const blocks = [
      makeToolCall({ id: 'tc1', name: 'Bash', state: 'running' }),
      makeToolCall({ id: 'tc2', name: 'Read', state: 'running' }),
      makeToolCall({ id: 'tc3', name: 'Grep', state: 'running' }),
    ]
    const result = groupCollapsibleToolCalls(blocks)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'tool-call-group',
      blocks,
    })
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

  it('pending 状态同样参与折叠', () => {
    const tc1 = makeToolCall({ id: 'tc1', name: 'Bash', state: 'completed' })
    const tc2 = makeToolCall({ id: 'tc2', name: 'Bash', state: 'pending' })
    const tc3 = makeToolCall({ id: 'tc3', name: 'Bash', state: 'completed' })
    const result = groupCollapsibleToolCalls([tc1, tc2, tc3])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      kind: 'tool-call-group',
      blocks: [tc1, tc2, tc3],
    })
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

    it('活跃 reasoning（isActiveReasoning 由调用方传入）也进组，与运行中工具一致', () => {
      const rsActive = makeReasoning({ id: 'rs1', done: false })
      const bash = makeToolCall({ id: 'b1', name: 'Bash' })
      const read = makeToolCall({ id: 'r1', name: 'Read' })
      const result = groupCollapsibleToolCalls([rsActive, bash, read])
      // 成组不看执行状态，活跃 reasoning 保持 zone 原序进组
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        kind: 'tool-call-group',
        blocks: [rsActive, bash, read],
      })
    })

    it('单个活跃 reasoning 不成组，保持散落', () => {
      const rsActive = makeReasoning({ id: 'rs1', done: false })
      const result = groupCollapsibleToolCalls([rsActive])
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(rsActive)
    })

    it('非活跃 reasoning（done 或默认）视为已完成，进组归档', () => {
      const rs = makeReasoning({ id: 'rs1', done: true })
      const bash = makeToolCall({ id: 'b1', name: 'Bash' })
      const result = groupCollapsibleToolCalls([rs, bash])
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

    it('MCP running 状态同样参与折叠', () => {
      const tc1 = makeToolCall({ id: 'tc1', name: 'mcp__github__search', state: 'completed' })
      const tc2 = makeToolCall({ id: 'tc2', name: 'mcp__github__read', state: 'running' })
      const result = groupCollapsibleToolCalls([tc1, tc2])
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        kind: 'tool-call-group',
        blocks: [tc1, tc2],
      })
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

/** 测试用 t 桩：按 zh.json 解析 key + 插值；count 传参时对齐 i18next 复数后缀（zh 单复数同形，只配 _other） */
function makeT() {
  const zh = zhLocale as Record<string, unknown>
  const resolve = (key: string): unknown =>
    key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], zh)
  return (key: string, opts?: Record<string, unknown>): string => {
    let tpl = resolve(key)
    if (opts?.count != null) {
      const plural = resolve(`${key}_other`)
      if (typeof plural === 'string') tpl = plural
    }
    if (typeof tpl !== 'string') return key
    return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts?.[k] ?? ''))
  }
}

describe('formatGroupTitle', () => {
  const t = makeT()

  it('混合工具类别', () => {
    const blocks = [
      makeToolCall({ id: 'b1', name: 'Bash' }),
      makeToolCall({ id: 'b2', name: 'shell_command' }),
      makeToolCall({ id: 'r1', name: 'Read' }),
      makeToolCall({ id: 'r2', name: 'Read' }),
      makeToolCall({ id: 'r3', name: 'Read' }),
    ]
    expect(formatGroupTitle(blocks, t)).toBe('运行了 2 个命令、读取了 3 个文件')
  })

  it('单一工具类别单数', () => {
    const blocks = [makeToolCall({ id: 'r1', name: 'Read' })]
    expect(formatGroupTitle(blocks, t)).toBe('读取了 1 个文件')
  })

  it('Glob 和 Grep 分开统计', () => {
    const blocks = [
      makeToolCall({ id: 'g1', name: 'Glob' }),
      makeToolCall({ id: 'g2', name: 'Grep' }),
    ]
    expect(formatGroupTitle(blocks, t)).toBe('匹配了 1 个模式、搜索了 1 处内容')
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
    expect(formatGroupTitle(blocks, t)).toBe('运行了 1 个命令、读取了 2 个文件、匹配了 1 个模式、搜索了 2 处内容')
  })

  it('空数组返回空字符串', () => {
    expect(formatGroupTitle([], t)).toBe('')
  })

  it('复数形式正确', () => {
    const blocks = [
      makeToolCall({ id: 'b1', name: 'Bash' }),
      makeToolCall({ id: 'b2', name: 'Bash' }),
      makeToolCall({ id: 'b3', name: 'Bash' }),
    ]
    expect(formatGroupTitle(blocks, t)).toBe('运行了 3 个命令')
  })

  describe('reasoning 标题（thinking 总时长，非次数）', () => {
    it('reasoning durationMs 求和，与 tool 计数共存', () => {
      const blocks = [
        makeReasoning({ id: 'rs1', durationMs: 6000, done: true }),
        makeReasoning({ id: 'rs2', durationMs: 5000, done: true }),
        makeToolCall({ id: 'b1', name: 'Bash' }),
        makeToolCall({ id: 'b2', name: 'Bash' }),
      ]
      expect(formatGroupTitle(blocks, t)).toBe('思考 11.0 秒、运行了 2 个命令')
    })

    it('全无 durationMs（local/历史）兜底为思考，无时长', () => {
      const blocks = [
        makeReasoning({ id: 'rs1' }),
        makeReasoning({ id: 'rs2' }),
        makeToolCall({ id: 'r1', name: 'Read' }),
        makeToolCall({ id: 'r2', name: 'Read' }),
        makeToolCall({ id: 'r3', name: 'Read' }),
      ]
      expect(formatGroupTitle(blocks, t)).toBe('思考、读取了 3 个文件')
    })

    it('纯 reasoning 有时长', () => {
      const blocks = [
        makeReasoning({ id: 'rs1', durationMs: 6000 }),
        makeReasoning({ id: 'rs2', durationMs: 6000 }),
        makeReasoning({ id: 'rs3', durationMs: 6000 }),
      ]
      expect(formatGroupTitle(blocks, t)).toBe('思考 18.0 秒')
    })

    it('纯 reasoning 无时长兜底', () => {
      const blocks = [
        makeReasoning({ id: 'rs1' }),
        makeReasoning({ id: 'rs2' }),
      ]
      expect(formatGroupTitle(blocks, t)).toBe('思考')
    })

    it('部分有 durationMs 部分无（混合）按有值求和', () => {
      const blocks = [
        makeReasoning({ id: 'rs1', durationMs: 4000 }),
        makeReasoning({ id: 'rs2' }), // undefined 按 0
      ]
      expect(formatGroupTitle(blocks, t)).toBe('思考 4.0 秒')
    })
  })

  describe('失败计数', () => {
    it('含 error 时追加「· N 个失败」', () => {
      const blocks = [
        makeToolCall({ id: 'r1', name: 'Read', state: 'error' }),
        makeToolCall({ id: 'r2', name: 'Read', state: 'completed' }),
        makeToolCall({ id: 'r3', name: 'Read', state: 'completed' }),
      ]
      expect(formatGroupTitle(blocks, t)).toBe('读取了 3 个文件 · 1 个失败')
    })

    it('全 error 时计数为组大小', () => {
      const blocks = [
        makeToolCall({ id: 'r1', name: 'Read', state: 'error' }),
        makeToolCall({ id: 'r2', name: 'Read', state: 'error' }),
      ]
      expect(formatGroupTitle(blocks, t)).toBe('读取了 2 个文件 · 2 个失败')
    })

    it('无 error 时不追加', () => {
      const blocks = [
        makeToolCall({ id: 'r1', name: 'Read', state: 'completed' }),
        makeToolCall({ id: 'r2', name: 'Read', state: 'completed' }),
      ]
      expect(formatGroupTitle(blocks, t)).toBe('读取了 2 个文件')
    })

    it('含 error 与 reasoning 混合：reasoning 不计入失败', () => {
      const blocks = [
        makeReasoning({ id: 'rs1', durationMs: 1000 }),
        makeToolCall({ id: 'r1', name: 'Read', state: 'error' }),
        makeToolCall({ id: 'r2', name: 'Read', state: 'completed' }),
      ]
      expect(formatGroupTitle(blocks, t)).toBe('思考 1.0 秒、读取了 2 个文件 · 1 个失败')
    })
  })

  describe('目标去重计数（文件/模式/命令按真实数量，非调用次数）', () => {
    it('同一文件 edit 三次计 1 个文件', () => {
      const blocks = [1, 2, 3].map(i => {
        const b = makeToolCall({ id: `e${i}`, name: 'Edit' })
        b.tool.input = { file_path: 'src/a.md' }
        return b
      })
      expect(formatGroupTitle(blocks, t)).toBe('编辑了 1 个文件')
    })

    it('同一文件多次 write 与另一文件混合计 2 个文件', () => {
      const w1 = makeToolCall({ id: 'w1', name: 'Write' })
      w1.tool.input = { file_path: 'src/a.md' }
      const w2 = makeToolCall({ id: 'w2', name: 'Write' })
      w2.tool.input = { file_path: 'src/a.md' }
      const w3 = makeToolCall({ id: 'w3', name: 'Write' })
      w3.tool.input = { file_path: 'src/b.md' }
      expect(formatGroupTitle([w1, w2, w3], t)).toBe('写入了 2 个文件')
    })

    it('read 按文件路径去重，MultiEdit 与 Edit 合并到 edit 类别后再去重', () => {
      const r1 = makeToolCall({ id: 'r1', name: 'Read' })
      r1.tool.input = { file_path: 'src/a.md' }
      const r2 = makeToolCall({ id: 'r2', name: 'Read' })
      r2.tool.input = { file_path: 'src/a.md' }
      const e1 = makeToolCall({ id: 'e1', name: 'Edit' })
      e1.tool.input = { file_path: 'src/a.md' }
      const e2 = makeToolCall({ id: 'e2', name: 'MultiEdit' })
      e2.tool.input = { file_path: 'src/a.md' }
      expect(formatGroupTitle([r1, r2, e1, e2], t)).toBe('读取了 1 个文件、编辑了 1 个文件')
    })

    it('拿不到目标内容的块各自计 1（无法合并）', () => {
      const w1 = makeToolCall({ id: 'w1', name: 'Write' })
      w1.tool.input = {}
      const w2 = makeToolCall({ id: 'w2', name: 'Write' })
      w2.tool.input = {}
      expect(formatGroupTitle([w1, w2], t)).toBe('写入了 2 个文件')
    })

    it('有路径与无路径混合：去重路径数 + 无路径块数', () => {
      const w1 = makeToolCall({ id: 'w1', name: 'Write' })
      w1.tool.input = { file_path: 'src/a.md' }
      const w2 = makeToolCall({ id: 'w2', name: 'Write' })
      w2.tool.input = { file_path: 'src/a.md' }
      const w3 = makeToolCall({ id: 'w3', name: 'Write' })
      w3.tool.input = {}
      expect(formatGroupTitle([w1, w2, w3], t)).toBe('写入了 2 个文件')
    })

    it('shell/glob/grep/webfetch/websearch 保持调用次数计数（不参与文件去重）', () => {
      const b1 = makeToolCall({ id: 'b1', name: 'Bash' })
      b1.tool.input = { command: 'bun test' }
      const b2 = makeToolCall({ id: 'b2', name: 'Bash' })
      b2.tool.input = { command: 'bun test' }
      const g1 = makeToolCall({ id: 'g1', name: 'Glob' })
      g1.tool.input = { pattern: '**/*.ts' }
      const g2 = makeToolCall({ id: 'g2', name: 'Glob' })
      g2.tool.input = { pattern: '**/*.ts' }
      expect(formatGroupTitle([b1, b2], t)).toBe('运行了 2 个命令')
      expect(formatGroupTitle([g1, g2], t)).toBe('匹配了 2 个模式')
    })

    it('MCP 仍按调用次数计数', () => {
      const m1 = makeToolCall({ id: 'm1', name: 'mcp__github__search' })
      m1.tool.input = { query: 'x' }
      const m2 = makeToolCall({ id: 'm2', name: 'mcp__github__search' })
      m2.tool.input = { query: 'y' }
      expect(formatGroupTitle([m1, m2], t)).toBe('调用了 github 2 次')
    })
  })

  describe('countFailedInGroup', () => {
    it('统计 error 态 tool-call 数量', () => {
      const blocks = [
        makeToolCall({ id: 'r1', name: 'Read', state: 'error' }),
        makeToolCall({ id: 'r2', name: 'Read', state: 'completed' }),
        makeToolCall({ id: 'r3', name: 'Bash', state: 'error' }),
      ]
      expect(countFailedInGroup(blocks)).toBe(2)
    })

    it('reasoning 不计入失败', () => {
      const blocks = [
        makeReasoning({ id: 'rs1' }),
        makeToolCall({ id: 'r1', name: 'Read', state: 'error' }),
      ]
      expect(countFailedInGroup(blocks)).toBe(1)
    })

    it('无失败返回 0', () => {
      const blocks = [makeToolCall({ id: 'r1', name: 'Read', state: 'completed' })]
      expect(countFailedInGroup(blocks)).toBe(0)
    })
  })

  describe('MCP 标题格式', () => {
    it('单个 MCP server 计数', () => {
      const blocks = [
        makeToolCall({ id: 'm1', name: 'mcp__github__search' }),
        makeToolCall({ id: 'm2', name: 'mcp__github__read' }),
        makeToolCall({ id: 'm3', name: 'mcp__github__write' }),
      ]
      expect(formatGroupTitle(blocks, t)).toBe('调用了 github 3 次')
    })

    it('多个 MCP server 分别计数', () => {
      const blocks = [
        makeToolCall({ id: 'm1', name: 'mcp__serverA__tool1' }),
        makeToolCall({ id: 'm2', name: 'mcp__serverA__tool2' }),
        makeToolCall({ id: 'm3', name: 'mcp__serverB__tool1' }),
      ]
      expect(formatGroupTitle(blocks, t)).toBe('调用了 serverA 2 次、调用了 serverB 1 次')
    })

    it('Plugin MCP server 显示名用冒号分隔', () => {
      const blocks = [
        makeToolCall({ id: 'm1', name: 'mcp__plugin_chrome-devtools-mcp_chrome-devtools__click' }),
        makeToolCall({ id: 'm2', name: 'mcp__plugin_chrome-devtools-mcp_chrome-devtools__screenshot' }),
        makeToolCall({ id: 'm3', name: 'mcp__plugin_chrome-devtools-mcp_chrome-devtools__navigate' }),
        makeToolCall({ id: 'm4', name: 'mcp__plugin_chrome-devtools-mcp_chrome-devtools__type' }),
      ]
      expect(formatGroupTitle(blocks, t)).toBe('调用了 plugin:chrome-devtools-mcp:chrome-devtools 4 次')
    })

    it('MCP + 内置工具混合计数', () => {
      const blocks = [
        makeToolCall({ id: 'b1', name: 'Bash' }),
        makeToolCall({ id: 'm1', name: 'mcp__github__search' }),
        makeToolCall({ id: 'm2', name: 'mcp__github__read' }),
      ]
      expect(formatGroupTitle(blocks, t)).toBe('运行了 1 个命令、调用了 github 2 次')
    })

    it('非 MCP 工具不影响现有行为', () => {
      const blocks = [
        makeToolCall({ id: 'r1', name: 'Read' }),
        makeToolCall({ id: 'r2', name: 'Read' }),
        makeToolCall({ id: 'r3', name: 'Read' }),
      ]
      expect(formatGroupTitle(blocks, t)).toBe('读取了 3 个文件')
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
      expect(formatGroupTitle([makeToolCall({ id: 'w1', name: 'WebFetch' })], t)).toBe('抓取了 1 个网页')
      expect(formatGroupTitle([
        makeToolCall({ id: 'w1', name: 'WebFetch' }),
        makeToolCall({ id: 'w2', name: 'WebFetch' }),
      ], t)).toBe('抓取了 2 个网页')
    })

    it('WebSearch 计数', () => {
      expect(formatGroupTitle([
        makeToolCall({ id: 'w1', name: 'WebSearch' }),
        makeToolCall({ id: 'w2', name: 'WebSearch' }),
        makeToolCall({ id: 'w3', name: 'WebSearch' }),
      ], t)).toBe('网页搜索 3 次')
    })

    it('Write 与 Edit/MultiEdit 分开计数（write=新建 / edit=修改）', () => {
      expect(formatGroupTitle([
        makeToolCall({ id: 'w1', name: 'Write' }),
        makeToolCall({ id: 'w2', name: 'Write' }),
      ], t)).toBe('写入了 2 个文件')
      expect(formatGroupTitle([
        makeToolCall({ id: 'e1', name: 'Edit' }),
        makeToolCall({ id: 'e2', name: 'MultiEdit' }),
      ], t)).toBe('编辑了 2 个文件')
      // 混合：各自计数并列
      expect(formatGroupTitle([
        makeToolCall({ id: 'w1', name: 'Write' }),
        makeToolCall({ id: 'e1', name: 'Edit' }),
      ], t)).toBe('写入了 1 个文件、编辑了 1 个文件')
    })

    it('read + websearch + edit 混合按固定顺序拼接', () => {
      const blocks = [
        makeToolCall({ id: 'r1', name: 'Read' }),
        makeToolCall({ id: 'w1', name: 'WebSearch' }),
        makeToolCall({ id: 'e1', name: 'Edit' }),
      ]
      expect(formatGroupTitle(blocks, t)).toBe('读取了 1 个文件、网页搜索 1 次、编辑了 1 个文件')
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
      expect(formatGroupTitle(blocks, t)).toBe('运行了 1 个命令、读取了 1 个文件、匹配了 1 个模式、搜索了 1 处内容、抓取了 1 个网页、网页搜索 1 次、编辑了 1 个文件')
    })
  })
})

describe('formatGroupActiveTitle', () => {
  const t = makeT()

  it('无活跃块返回 null', () => {
    const blocks = [
      makeReasoning({ id: 'rs1', durationMs: 1000 }),
      makeToolCall({ id: 'b1', name: 'Bash' }),
    ]
    expect(formatGroupActiveTitle(blocks, { t })).toBeNull()
  })

  it('running 工具：带命令内容（shell）', () => {
    const block = makeToolCall({ id: 'b1', name: 'Bash', state: 'running' })
    block.tool.input = { command: 'bun run test' }
    expect(formatGroupActiveTitle([block], { t })).toBe('正在执行命令 bun run test')
  })

  it('running 工具：优先展示人话描述（description），无描述回退 input 目标内容', () => {
    const block = makeToolCall({ id: 'b1', name: 'Bash', state: 'running' })
    block.tool.input = { command: 'bun run typecheck 2>&1 | tail -1' }
    block.tool.description = 'typecheck + web 全量'
    expect(formatGroupActiveTitle([block], { t })).toBe('正在执行命令 typecheck + web 全量')

    block.tool.description = null
    block.tool.input = { command: 'c'.repeat(30) }
    expect(formatGroupActiveTitle([block], { t })).toBe(`正在执行命令 ${'c'.repeat(21)}...`)
  })

  it('running 工具：带文件路径（write）', () => {
    const block = makeToolCall({ id: 'w1', name: 'Write', state: 'running' })
    block.tool.input = { file_path: 'src/a.md' }
    expect(formatGroupActiveTitle([block], { t })).toBe('正在写入文件 src/a.md')
  })

  it('pending 状态（等待审批）展示「等待审批」+ 目标内容', () => {
    const block = makeToolCall({ id: 'e1', name: 'Edit', state: 'pending' })
    block.tool.input = { file_path: 'src/a.ts' }
    expect(formatGroupActiveTitle([block], { t })).toBe('等待审批 src/a.ts')
  })

  it('pending 无目标内容时只展示「等待审批」', () => {
    const block = makeToolCall({ id: 'e1', name: 'Edit', state: 'pending' })
    block.tool.input = {}
    expect(formatGroupActiveTitle([block], { t })).toBe('等待审批')
  })

  it('input 尚无目标内容时退回类别文案', () => {
    const block = makeToolCall({ id: 'w1', name: 'Write', state: 'running' })
    block.tool.input = {}
    expect(formatGroupActiveTitle([block], { t })).toBe('正在写入文件')
  })

  it('多行命令取首行', () => {
    const block = makeToolCall({ id: 'b1', name: 'Bash', state: 'running' })
    block.tool.input = { command: 'cd /very/long/path/to/somewhere/deeper\necho done' }
    // 首行 38 字符，按既有 truncate 规则截为 24 字符（21 + '...'）
    expect(formatGroupActiveTitle([block], { t })).toBe('正在执行命令 cd /very/long/path/to...')
  })

  it('超长目标内容截断', () => {
    const block = makeToolCall({ id: 'r1', name: 'Read', state: 'running' })
    block.tool.input = { file_path: 'a'.repeat(40) }
    expect(formatGroupActiveTitle([block], { t })).toBe(`正在读取文件 ${'a'.repeat(21)}...`)
  })

  it('多个活跃块取时序最新的一个（数组序最后）', () => {
    const b1 = makeToolCall({ id: 'b1', name: 'Bash', state: 'completed' })
    b1.tool.input = { command: 'x' }
    const b2 = makeToolCall({ id: 'b2', name: 'Read', state: 'running' })
    b2.tool.input = { file_path: 'src/a.ts' }
    const b3 = makeToolCall({ id: 'b3', name: 'Bash', state: 'running' })
    b3.tool.input = { command: 'bun run build' }
    expect(formatGroupActiveTitle([b1, b2, b3], { t })).toBe('正在执行命令 bun run build')
  })

  it('活跃 reasoning：正在思考（isActiveReasoning 判定）', () => {
    const rs = makeReasoning({ id: 'rs1', done: false })
    const b1 = makeToolCall({ id: 'b1', name: 'Bash' })
    expect(formatGroupActiveTitle([rs, b1], { t, isActiveReasoning: b => b.id === 'rs1' })).toBe('正在思考')
  })

  it('非活跃 reasoning 不算活跃', () => {
    const rs = makeReasoning({ id: 'rs1', done: true })
    const b1 = makeToolCall({ id: 'b1', name: 'Bash', state: 'completed' })
    expect(formatGroupActiveTitle([rs, b1], { t, isActiveReasoning: () => false })).toBeNull()
  })

  it('各类别目标内容提取（glob/grep/webfetch/websearch）', () => {
    const glob = makeToolCall({ id: 'g1', name: 'Glob', state: 'running' })
    glob.tool.input = { pattern: '**/*.ts' }
    const grep = makeToolCall({ id: 'g2', name: 'Grep', state: 'running' })
    grep.tool.input = { pattern: 'useState' }
    const wf = makeToolCall({ id: 'w1', name: 'WebFetch', state: 'running' })
    wf.tool.input = { url: 'https://example.com/docs' }
    const ws = makeToolCall({ id: 'w2', name: 'WebSearch', state: 'running' })
    ws.tool.input = { query: 'bun test api' }
    expect(formatGroupActiveTitle([glob], { t })).toBe('正在匹配模式 **/*.ts')
    expect(formatGroupActiveTitle([grep], { t })).toBe('正在搜索内容 useState')
    expect(formatGroupActiveTitle([wf], { t })).toBe('正在抓取网页 https://example.com/docs')
    expect(formatGroupActiveTitle([ws], { t })).toBe('正在搜索网页 bun test api')
  })

  it('MCP 工具：正在调用 server 显示名', () => {
    const block = makeToolCall({ id: 'm1', name: 'mcp__github__search', state: 'running' })
    expect(formatGroupActiveTitle([block], { t })).toBe('正在调用 github')
  })

  it('failedCount 传入时动态标题同样追加失败后缀（不变式两态通用）', () => {
    const block = makeToolCall({ id: 'b1', name: 'Bash', state: 'running' })
    block.tool.input = { command: 'bun test' }
    expect(formatGroupActiveTitle([block], { t, failedCount: 2 })).toBe('正在执行命令 bun test · 2 个失败')
    // 无失败（0 / 未传）不追加
    expect(formatGroupActiveTitle([block], { t, failedCount: 0 })).toBe('正在执行命令 bun test')
  })

  it('waiting 审批 + failedCount 同样追加', () => {
    const block = makeToolCall({ id: 'e1', name: 'Edit', state: 'pending' })
    block.tool.input = { file_path: 'src/a.ts' }
    expect(formatGroupActiveTitle([block], { t, failedCount: 1 })).toBe('等待审批 src/a.ts · 1 个失败')
  })
})
