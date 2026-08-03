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

import type { AgentReasoningBlock, ChatBlock, ToolCallBlock } from '@/domain/chat'
import { capitalize } from '@/core/utils/sessionUtils'
import { parseMCPToolName, formatMCPServerDisplay } from '@/core/lib/toolInputUtils'

type ToolCategory = 'shell' | 'read' | 'glob' | 'grep'

const TOOL_CATEGORY_MAP: Record<string, ToolCategory> = {
  Bash: 'shell',
  shell_command: 'shell',
  Read: 'read',
  Glob: 'glob',
  Grep: 'grep',
}

const COLLAPSIBLE_TOOL_NAMES = new Set(Object.keys(TOOL_CATEGORY_MAP))

/** 可折叠块：可折叠工具 + reasoning（thinking） */
type CollapsibleBlock = ToolCallBlock | AgentReasoningBlock

/** 工具调用折叠组 */
export type ToolCallGroup = {
  kind: 'tool-call-group'
  id: string
  blocks: CollapsibleBlock[]
}

/** 分组后的消息块 */
export type GroupedBlock = ChatBlock | ToolCallGroup

/** 判断 reasoning 是否活跃（正在思考）—— 活跃块散落可见，不进组，与 running tool 一致 */
type IsActiveReasoning = (block: AgentReasoningBlock) => boolean

/**
 * 格式化折叠组标题。
 * thinking 部分：组内 reasoning 的 durationMs 求和 —— 有（remote）展示「thought X.Xs」，全无（local/历史）兜底「thought」。
 * tool 部分：按类别计数（现有逻辑）。
 */
export function formatGroupTitle(blocks: CollapsibleBlock[]): string {
  // thinking 总时长（仅 remote 打点的 durationMs；local/历史为 undefined → 求和得 0）
  const reasoningBlocks = blocks.filter((b): b is AgentReasoningBlock => b.kind === 'agent-reasoning')
  const hasThinkDuration = reasoningBlocks.some(b => b.durationMs != null)
  const totalThinkMs = reasoningBlocks.reduce((sum, b) => sum + (b.durationMs ?? 0), 0)

  // tool 类别计数
  const counts: Partial<Record<ToolCategory, number>> = {}
  const mcpCounts: Record<string, number> = {}
  for (const block of blocks) {
    if (block.kind === 'agent-reasoning') continue
    const cat = TOOL_CATEGORY_MAP[block.tool.name]
    if (cat) {
      counts[cat] = (counts[cat] ?? 0) + 1
    } else {
      const parsed = parseMCPToolName(block.tool.name)
      if (parsed) {
        mcpCounts[parsed.server] = (mcpCounts[parsed.server] ?? 0) + 1
      }
    }
  }

  const parts: string[] = []
  // thinking 置首（思考在工具之前，符合时序）
  if (reasoningBlocks.length > 0) {
    parts.push(hasThinkDuration ? `thought ${(totalThinkMs / 1000).toFixed(1)}s` : 'thought')
  }
  if (counts.shell) {
    const n = counts.shell
    parts.push(`run ${n} shell command${n !== 1 ? 's' : ''}`)
  }
  if (counts.read) {
    const n = counts.read
    parts.push(`read ${n} file${n !== 1 ? 's' : ''}`)
  }
  if (counts.glob) {
    const n = counts.glob
    parts.push(`find ${n} pattern${n !== 1 ? 's' : ''}`)
  }
  if (counts.grep) {
    const n = counts.grep
    parts.push(`search ${n} pattern${n !== 1 ? 's' : ''}`)
  }
  for (const [server, n] of Object.entries(mcpCounts)) {
    parts.push(`called ${formatMCPServerDisplay(server)} ${n} time${n !== 1 ? 's' : ''}`)
  }

  return capitalize(parts.join(', '))
}

/** 判断是否为可折叠块（可折叠工具 或 reasoning） */
function isCollapsibleBlock(block: ChatBlock): block is CollapsibleBlock {
  if (block.kind === 'agent-reasoning') return true
  if (block.kind !== 'tool-call') return false
  const name = block.tool.name
  return COLLAPSIBLE_TOOL_NAMES.has(name) || name.startsWith('mcp__')
}

/** 可折叠块是否「已完成」（可进组归档）—— tool 看 state，reasoning 看是否非活跃 */
function isCollapsibleCompleted(
  block: CollapsibleBlock,
  isActiveReasoning?: IsActiveReasoning,
): boolean {
  if (block.kind === 'agent-reasoning') {
    // 活跃（正在思考）→ 未完成，散落；默认无谓词 → 视为已完成（向后兼容）
    return !(isActiveReasoning?.(block) ?? false)
  }
  return block.tool.state === 'completed'
}

/** 检测连续可折叠块 Zone 并分组（reasoning + 可折叠工具共享 zone） */
export function groupCollapsibleToolCalls(
  blocks: ChatBlock[],
  opts: { isActiveReasoning?: IsActiveReasoning } = {},
): GroupedBlock[] {
  const { isActiveReasoning } = opts
  const result: GroupedBlock[] = []
  let i = 0

  while (i < blocks.length) {
    const block = blocks[i]

    if (isCollapsibleBlock(block)) {
      // 收集连续可折叠块（不论状态）→ Zone
      const zone: CollapsibleBlock[] = []
      while (i < blocks.length) {
        const current = blocks[i]
        if (!isCollapsibleBlock(current)) break
        zone.push(current)
        i++
      }

      // 按完成态拆分，各自保持原始相对顺序
      const completed = zone.filter(b => isCollapsibleCompleted(b, isActiveReasoning))
      const others = zone.filter(b => !isCollapsibleCompleted(b, isActiveReasoning))

      if (completed.length >= 2) {
        result.push({
          kind: 'tool-call-group',
          // 锚定 zone 起始块（而非 completed 首块）：zone 边界由非可折叠块决定，
          // 流式中稳定；completed 首块会随工具状态翻转而变，作 key 会导致组重挂载、折叠态丢失
          id: `group-${zone[0].id}`,
          blocks: completed,
        })
        result.push(...others)
      } else {
        result.push(...zone)
      }
    } else {
      result.push(block)
      i++
    }
  }

  return result
}
