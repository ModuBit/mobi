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
import { parseMCPToolName, formatMCPServerDisplay, getInputString, truncate } from '@/core/lib/toolInputUtils'

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
export type IsActiveReasoning = (block: AgentReasoningBlock) => boolean

/** 工具是否活跃（运行中/待审批）—— 组头「正在 xxx」动态标题的判定来源（仅供本文件与组渲染器内部使用） */
function isActiveTool(block: ToolCallBlock): boolean {
  return block.tool.state === 'running' || block.tool.state === 'pending'
}

/** 追加失败计数后缀（>0 时）——汇总/动态两种标题形态共用，保证失败计数不变式单一实现 */
function withFailedSuffix(text: string, failedCount: number | undefined, t: Translate): string {
  return failedCount != null && failedCount > 0
    ? `${text} · ${t('chat.group.failed', { count: failedCount })}`
    : text
}

/**
 * 组内失败工具数（state=error 的 tool-call；reasoning 不计）。
 * 组头红角标（hasError）与标题「· N 个失败」共用此函数，避免两处独立判定漂移。
 */
export function countFailedInGroup(blocks: CollapsibleBlock[]): number {
  return blocks.filter(b => b.kind === 'tool-call' && b.tool.state === 'error').length
}

/**
 * 类别元数据单源：目标 input 字段 + 计数语义。
 * 标题 i18n key 由类别名派生（chat.group.<cat> / chat.group.running.<cat>），不另设平行表。
 * countBy：文件操作类按「去重目标数」计数（同文件多次读/写/编辑计 1 个文件），
 * 其余类别语义即次数、按调用次数计。新增类别只改此表一处。
 */
const CATEGORY_META: Record<ToolCategory, { inputKey: string; countBy: 'unique-target' | 'calls' }> = {
  shell: { inputKey: 'command', countBy: 'calls' },
  read: { inputKey: 'file_path', countBy: 'unique-target' },
  glob: { inputKey: 'pattern', countBy: 'calls' },
  grep: { inputKey: 'pattern', countBy: 'calls' },
  webfetch: { inputKey: 'url', countBy: 'calls' },
  websearch: { inputKey: 'query', countBy: 'calls' },
  write: { inputKey: 'file_path', countBy: 'unique-target' },
  edit: { inputKey: 'file_path', countBy: 'unique-target' },
}

/** 运行态尾随目标内容的长度上限（经 truncate 截断） */
const ACTIVE_TARGET_MAX = 24

/** 提取类别目标内容原始值（不截断/不取首行）；拿不到（缺失/空串）返回 null */
function targetOf(category: ToolCategory, input: unknown): string | null {
  return getInputString(input, CATEGORY_META[category].inputKey) || null
}

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
  const raw = targetOf(category, input)
  if (raw == null) return ''
  const display = category === 'shell' ? raw.split('\n')[0] : raw
  return truncate(display, ACTIVE_TARGET_MAX)
}

/**
 * 格式化折叠组标题（汇总形态：全部落定或无活跃内容时）。
 * thinking 部分：组内 reasoning 的 durationMs 求和 —— 有（remote）展示「思考 X.X 秒」，全无（local/历史）兜底「思考」。
 * tool 部分：按类别计数——文件操作类按去重文件数（同文件多次编辑计 1 个文件，数量=真实文件数），其余按调用次数。
 * 失败计数：组内失败工具数 > 0 时追加「· N 个失败」；调用方可传预计算的 failedCount 免去内部重复遍历。
 * 文案经 i18n（t 由组件层传入 useTranslation 的 t）。
 */
export function formatGroupTitle(
  blocks: CollapsibleBlock[],
  t: Translate,
  opts: { failedCount?: number } = {},
): string {
  // thinking 总时长（仅 remote 打点的 durationMs；local/历史为 undefined → 求和得 0）
  const reasoningBlocks = blocks.filter((b): b is AgentReasoningBlock => b.kind === 'agent-reasoning')
  const hasThinkDuration = reasoningBlocks.some(b => b.durationMs != null)
  const totalThinkMs = reasoningBlocks.reduce((sum, b) => sum + (b.durationMs ?? 0), 0)

  // tool 计数：单次遍历同时累计调用次数、去重目标集合、无目标块数，读取端按计数语义取值
  const buckets = new Map<ToolCategory, { targets: Set<string>; unknown: number; calls: number }>()
  const mcpCounts: Record<string, number> = {}
  for (const block of blocks) {
    if (block.kind === 'agent-reasoning') continue
    const cat = TOOL_CATEGORY_MAP[block.tool.name]
    if (cat) {
      const bucket = buckets.get(cat) ?? { targets: new Set<string>(), unknown: 0, calls: 0 }
      bucket.calls++
      const target = targetOf(cat, block.tool.input)
      if (target == null) bucket.unknown++
      else bucket.targets.add(target)
      buckets.set(cat, bucket)
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
  // Object.keys 按 meta 表定义序输出（与既有时序文案顺序一致）
  for (const cat of Object.keys(CATEGORY_META) as ToolCategory[]) {
    const bucket = buckets.get(cat)
    if (!bucket) continue
    const meta = CATEGORY_META[cat]
    const n = meta.countBy === 'unique-target' ? bucket.targets.size + bucket.unknown : bucket.calls
    if (n) parts.push(t(`chat.group.${cat}`, { count: n }))
  }
  for (const [server, n] of Object.entries(mcpCounts)) {
    parts.push(t('chat.group.mcp', { server: formatMCPServerDisplay(server), count: n }))
  }

  const base = capitalize(parts.join(t('chat.group.separator')))
  // 含失败工具时追加失败计数（与主体同语言）
  const failedCount = opts.failedCount ?? countFailedInGroup(blocks)
  return withFailedSuffix(base, failedCount, t)
}

/**
 * 格式化折叠组标题（动态形态：有活跃块时展示「正在 xxx」/「等待审批」）。
 * 多个活跃块取时序最新的一个（数组序最后）；无活跃块返回 null（调用方回退汇总形态）。
 * 尾随目标内容拿不到时退回类别文案（如 Write 运行中尚未拿到 file_path → 「正在写入文件」）。
 * failedCount 传入时（组渲染器已预计算）动态标题同样追加「· N 个失败」，失败不变式两态通用。
 */
export function formatGroupActiveTitle(
  blocks: CollapsibleBlock[],
  opts: { t: Translate; isActiveReasoning?: IsActiveReasoning; failedCount?: number },
): string | null {
  const { t, isActiveReasoning, failedCount } = opts
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]
    if (block.kind === 'agent-reasoning') {
      if (isActiveReasoning?.(block)) return withFailedSuffix(t('chat.group.running.thinking'), failedCount, t)
      continue
    }
    if (!isActiveTool(block)) continue
    const target = extractActiveTarget(block.tool.name, block.tool.input)
    // 等待审批（pending）优先展示「等待审批」；运行中展示「正在 xxx」
    if (block.tool.state === 'pending') {
      return withFailedSuffix(target ? `${t('chat.group.waiting.approval')} ${target}` : t('chat.group.waiting.approval'), failedCount, t)
    }
    const category = TOOL_CATEGORY_MAP[block.tool.name]
    // MCP 的 server 目标走插值；其余类别拼在文案后（拿不到目标则只展示类别文案）
    if (!category) return withFailedSuffix(t('chat.group.running.mcp', { server: target }), failedCount, t)
    return withFailedSuffix(target ? `${t(`chat.group.running.${category}`)} ${target}` : t(`chat.group.running.${category}`), failedCount, t)
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
