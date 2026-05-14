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

import type { ChatBlock, ToolCallBlock } from '@/domain/chat'
import { capitalize } from '@/core/utils/sessionUtils'

type ToolCategory = 'shell' | 'read' | 'glob' | 'grep'

const TOOL_CATEGORY_MAP: Record<string, ToolCategory> = {
  Bash: 'shell',
  shell_command: 'shell',
  Read: 'read',
  Glob: 'glob',
  Grep: 'grep',
}

const COLLAPSIBLE_TOOL_NAMES = new Set(Object.keys(TOOL_CATEGORY_MAP))

/** 工具调用折叠组 */
export type ToolCallGroup = {
  kind: 'tool-call-group'
  id: string
  blocks: ToolCallBlock[]
}

/** 分组后的消息块 */
export type GroupedBlock = ChatBlock | ToolCallGroup

/** 格式化折叠组标题 */
export function formatGroupTitle(blocks: ToolCallBlock[]): string {
  const counts: Partial<Record<ToolCategory, number>> = {}
  for (const block of blocks) {
    const cat = TOOL_CATEGORY_MAP[block.tool.name]
    if (cat) {
      counts[cat] = (counts[cat] ?? 0) + 1
    }
  }

  const parts: string[] = []
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

  return capitalize(parts.join(', '))
}

/** 判断是否为可折叠工具 */
function isCollapsibleTool(block: ChatBlock): block is ToolCallBlock {
  return block.kind === 'tool-call' && COLLAPSIBLE_TOOL_NAMES.has(block.tool.name)
}

/** 检测连续可折叠工具 Zone 并分组 */
export function groupCollapsibleToolCalls(blocks: ChatBlock[]): GroupedBlock[] {
  const result: GroupedBlock[] = []
  let i = 0

  while (i < blocks.length) {
    const block = blocks[i]

    if (isCollapsibleTool(block)) {
      // 收集连续可折叠工具（不论状态）→ Zone
      const zone: ToolCallBlock[] = []
      while (i < blocks.length) {
        const current = blocks[i]
        if (!isCollapsibleTool(current)) break
        zone.push(current)
        i++
      }

      // 按状态拆分，各自保持原始相对顺序
      const completed = zone.filter(b => b.tool.state === 'completed')
      const others = zone.filter(b => b.tool.state !== 'completed')

      if (completed.length >= 2) {
        result.push({
          kind: 'tool-call-group',
          id: `group-${completed[0].id}`,
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
