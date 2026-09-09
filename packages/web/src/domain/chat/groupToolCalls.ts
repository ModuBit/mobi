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
import { isObject } from '@mobi/shared'

/** 最小翻译函数签名（结构上兼容 i18next 的 t，保持 domain 层纯净可测） */
export type Translate = (key: string, opts?: Record<string, unknown>) => string

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

/** 判断 reasoning 是否活跃（正在思考）—— 由调用方（buildBubbleItems）构造，供组头动态标题与组内 thinking 展开态使用 */
type IsActiveReasoning = (block: AgentReasoningBlock) => boolean

export type { IsActiveReasoning }

/** 工具是否活跃（运行中/待审批）—— 组头「正在 xxx」动态标题的判定来源 */
export function isActiveTool(block: ToolCallBlock): boolean {
  return block.tool.state === 'running' || block.tool.state === 'pending'
}

/**
 * 组内失败工具数（state=error 的 tool-call；reasoning 不计）。
 * 组头红角标（hasError）与标题「· N failed」共用此函数，避免两处独立判定漂移。
 */
export function countFailedInGroup(blocks: CollapsibleBlock[]): number {
  return blocks.filter(b => b.kind === 'tool-call' && b.tool.state === 'error').length
}

/** 组头汇总文案的各类别 i18n key（key 本身带 _one/_other 复数后缀，由 i18next count 解析） */
const TITLE_KEYS: Record<ToolCategory, string> = {
  shell: 'chat.group.shell',
  read: 'chat.group.read',
  glob: 'chat.group.glob',
  grep: 'chat.group.grep',
  webfetch: 'chat.group.webfetch',
  websearch: 'chat.group.websearch',
  write: 'chat.group.write',
  edit: 'chat.group.edit',
}

/** 组头「正在 xxx」动态文案的各类别 i18n key */
const RUNNING_TITLE_KEYS: Record<ToolCategory, string> = {
  shell: 'chat.group.running.shell',
  read: 'chat.group.running.read',
  glob: 'chat.group.running.glob',
  grep: 'chat.group.running.grep',
  webfetch: 'chat.group.running.webfetch',
  websearch: 'chat.group.running.websearch',
  write: 'chat.group.running.write',
  edit: 'chat.group.running.edit',
}

/** 运行态尾随目标内容的长度上限（超长截断加省略号） */
const ACTIVE_TARGET_MAX = 24

/**
 * 提取运行中工具的尾随目标内容（命令/文件路径/模式等），拿不到返回空串（组头退回类别文案）。
 * 多行命令取首行；超长截断。
 */
function extractActiveTarget(name: string, input: unknown): string {
  const category = TOOL_CATEGORY_MAP[name]
  // MCP 工具：目标即 server 显示名（从工具名必然可解析，无 input 依赖）
  if (!category) {
    const parsed = parseMCPToolName(name)
    return parsed ? formatMCPServerDisplay(parsed.server) : ''
  }
  if (!isObject(input)) return ''
  const get = (key: string): string =>
    typeof input[key] === 'string' ? (input[key] as string) : ''
  let raw = ''
  switch (category) {
    case 'shell': raw = get('command').split('\n')[0]; break
    case 'read':
    case 'write':
    case 'edit': raw = get('file_path'); break
    case 'glob':
    case 'grep': raw = get('pattern'); break
    case 'webfetch': raw = get('url'); break
    case 'websearch': raw = get('query'); break
  }
  if (!raw) return ''
  return raw.length > ACTIVE_TARGET_MAX ? `${raw.slice(0, ACTIVE_TARGET_MAX - 1)}…` : raw
}

/**
 * 格式化折叠组标题（汇总形态：全部落定或无活跃内容时）。
 * thinking 部分：组内 reasoning 的 durationMs 求和 —— 有（remote）展示「思考 X.X 秒」，全无（local/历史）兜底「思考」。
 * tool 部分：按类别计数。失败计数：组内失败工具数 > 0 时追加「· N 个失败」。
 * 文案经 i18n（t 由组件层传入 useTranslation 的 t）。
 */
export function formatGroupTitle(blocks: CollapsibleBlock[], t: Translate): string {
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
    parts.push(hasThinkDuration
      ? t('chat.group.thoughtDuration', { secs: (totalThinkMs / 1000).toFixed(1) })
      : t('chat.group.thought'))
  }
  for (const [cat, key] of Object.entries(TITLE_KEYS) as [ToolCategory, string][]) {
    const n = counts[cat]
    if (n) parts.push(t(key, { count: n }))
  }
  for (const [server, n] of Object.entries(mcpCounts)) {
    parts.push(t('chat.group.mcp', { server: formatMCPServerDisplay(server), count: n }))
  }

  const base = capitalize(parts.join(String(t('chat.group.separator'))))
  // 含失败工具时追加失败计数（与主体同语言）
  const failedCount = countFailedInGroup(blocks)
  if (failedCount > 0) {
    return `${base} · ${t('chat.group.failed', { count: failedCount })}`
  }
  return base
}

/**
 * 格式化折叠组标题（动态形态：有活跃块时展示「正在 xxx」/「等待审批」）。
 * 多个活跃块取时序最新的一个（数组序最后）；无活跃块返回 null（调用方回退汇总形态）。
 * 尾随目标内容拿不到时退回类别文案（如 Write 运行中尚未拿到 file_path → 「正在写入文件」）。
 */
export function formatGroupActiveTitle(
  blocks: CollapsibleBlock[],
  opts: { t: Translate; isActiveReasoning?: IsActiveReasoning },
): string | null {
  const { t, isActiveReasoning } = opts
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    if (block.kind === 'agent-reasoning') {
      if (isActiveReasoning?.(block)) return t('chat.group.running.thinking')
      continue
    }
    if (!isActiveTool(block)) continue
    const category = TOOL_CATEGORY_MAP[block.tool.name]
    const target = extractActiveTarget(block.tool.name, block.tool.input)
    // 等待审批（pending）优先展示「等待审批」；运行中展示「正在 xxx」
    if (block.tool.state === 'pending') {
      return target ? `${t('chat.group.waiting.approval')} ${target}` : t('chat.group.waiting.approval')
    }
    const key = category ? RUNNING_TITLE_KEYS[category] : 'chat.group.running.mcp'
    // MCP 的 server 目标走插值；其余类别拼在文案后（拿不到目标则只展示类别文案）
    if (!category) return t(key, { server: target })
    return target ? `${t(key)} ${target}` : t(key)
  }
  return null
}

/** 判断是否为可折叠块（可折叠工具 或 reasoning） */
function isCollapsibleBlock(block: ChatBlock): block is CollapsibleBlock {
  if (block.kind === 'agent-reasoning') return true
  if (block.kind !== 'tool-call') return false
  const name = block.tool.name
  return COLLAPSIBLE_TOOL_NAMES.has(name) || name.startsWith('mcp__')
}

/** 检测连续可折叠块 Zone 并分组（reasoning + 可折叠工具共享 zone）。
 * 成组只看「连续可折叠块 ≥ 2」，与执行状态无关——运行中、待审批、已落定均进组；
 * 单个可折叠块不成组，保持散落。 */
export function groupCollapsibleToolCalls(blocks: ChatBlock[]): GroupedBlock[] {
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

      if (zone.length >= 2) {
        result.push({
          kind: 'tool-call-group',
          // 锚定 zone 起始块：zone 边界由非可折叠块决定，流式中稳定；
          // 起始块 id 随组员增删不变，作 key 不会导致组重挂载、折叠态丢失
          id: `group-${zone[0].id}`,
          blocks: zone,
        })
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
