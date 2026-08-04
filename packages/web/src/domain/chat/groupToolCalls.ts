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

type ToolCategory = 'shell' | 'read' | 'glob' | 'grep' | 'webfetch' | 'websearch' | 'write' | 'edit'

const TOOL_CATEGORY_MAP: Record<string, ToolCategory> = {
  Bash: 'shell',
  shell_command: 'shell',
  Read: 'read',
  Glob: 'glob',
  Grep: 'grep',
  WebFetch: 'webfetch',
  WebSearch: 'websearch',
  Write: 'write',
  Edit: 'edit',
  MultiEdit: 'edit',
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
 * 组内失败工具数（state=error 的 tool-call；reasoning 不计）。
 * 组头红角标（hasError）与标题「· N failed」共用此函数，避免两处独立判定漂移。
 */
export function countFailedInGroup(blocks: CollapsibleBlock[]): number {
  return blocks.filter(b => b.kind === 'tool-call' && b.tool.state === 'error').length
}

/**
 * 格式化折叠组标题。
 * thinking 部分：组内 reasoning 的 durationMs 求和 —— 有（remote）展示「thought X.Xs」，全无（local/历史）兜底「thought」。
 * tool 部分：按类别计数。
 * 失败计数：组内失败工具数 > 0 时追加「· N failed」。
 *
 * 注：标题主体文案（read N files 等）目前为硬编码英文，与既有动词一致；
 * 失败计数同样硬编码英文以避免中英混排（中文 locale 下出现「Read 3 files · 1 个失败」）。
 * 若后续整体 i18n 化标题动词，失败计数应一并接入。
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
  if (counts.webfetch) {
    const n = counts.webfetch
    parts.push(`fetch ${n} page${n !== 1 ? 's' : ''}`)
  }
  if (counts.websearch) {
    const n = counts.websearch
    parts.push(`search the web ${n} time${n !== 1 ? 's' : ''}`)
  }
  if (counts.write) {
    const n = counts.write
    parts.push(`wrote ${n} file${n !== 1 ? 's' : ''}`)
  }
  if (counts.edit) {
    const n = counts.edit
    parts.push(`edited ${n} file${n !== 1 ? 's' : ''}`)
  }
  for (const [server, n] of Object.entries(mcpCounts)) {
    parts.push(`called ${formatMCPServerDisplay(server)} ${n} time${n !== 1 ? 's' : ''}`)
  }

  const base = capitalize(parts.join(', '))
  // 含失败工具时追加失败计数（与主体同语言，避免中英混排）
  const failedCount = countFailedInGroup(blocks)
  if (failedCount > 0) {
    return `${base} · ${failedCount} failed`
  }
  return base
}

/** 判断是否为可折叠块（可折叠工具 或 reasoning） */
function isCollapsibleBlock(block: ChatBlock): block is CollapsibleBlock {
  if (block.kind === 'agent-reasoning') return true
  if (block.kind !== 'tool-call') return false
  const name = block.tool.name
  return COLLAPSIBLE_TOOL_NAMES.has(name) || name.startsWith('mcp__')
}

/** 可折叠块是否「已落定」（可进组归档）—— tool 看 completed/error，reasoning 看是否非活跃 */
function isCollapsibleSettled(
  block: CollapsibleBlock,
  isActiveReasoning?: IsActiveReasoning,
): boolean {
  if (block.kind === 'agent-reasoning') {
    // 活跃（正在思考）→ 未落定，散落；默认无谓词 → 视为已落定（向后兼容）
    return !(isActiveReasoning?.(block) ?? false)
  }
  // completed 成功、error 失败均归档进组；pending/running 仍散落可见
  return block.tool.state === 'completed' || block.tool.state === 'error'
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

      // 按落定态拆分，各自保持原始相对顺序
      const settled = zone.filter(b => isCollapsibleSettled(b, isActiveReasoning))
      const others = zone.filter(b => !isCollapsibleSettled(b, isActiveReasoning))

      if (settled.length >= 2) {
        result.push({
          kind: 'tool-call-group',
          // 锚定 zone 起始块（而非 settled 首块）：zone 边界由非可折叠块决定，
          // 流式中稳定；settled 首块会随工具状态翻转而变，作 key 会导致组重挂载、折叠态丢失
          id: `group-${zone[0].id}`,
          blocks: settled,
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
