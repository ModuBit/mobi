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

import { buildActionUri } from '@mobi/shared'
import { isObject } from '@mobi/shared'
import { getInputStringAny, countLines } from './toolInputUtils'
import { resolveDisplayPath } from '@/core/utils/path'
import type { SessionMetadataSummary } from '@/core/data/api/types'

/**
 * 工具行新形态（Tool Row × File Chip，词汇见 packages/web/CONTEXT.md）的推导单源：
 * 由 tool_use input 静态推算「动词 + chip + 行附加信息 + diff 统计」，渲染层只消费不重复判定。
 *
 * - 跳转类工具（FILE_BEARING_TOOLS）：chip 携带 mobi://file/open URI，点击走守卫分发
 * - 其余工具（Bash/Glob/Grep…）：同款 chip 形态纯展示，无 URI 不暗示可点
 * - diff 统计由输入内容静态推算，非服务端权威值
 */

/** 跳转类工具：输入天然携带文件路径、chip 可点击打开文件的资格集合 */
export const FILE_BEARING_TOOLS = ['Read', 'Edit', 'MultiEdit', 'Write'] as const

/** 工具行 chip：text 必备；uri 存在即可点击（file/open 经守卫分发） */
export type ToolRowChip = { text: string; uri?: string }

/** diff 统计（增/删行数） */
export type ToolRowStats = { add: number; del: number }

/** 工具行新形态的完整推导产物；null = 该工具维持现状渲染 */
export type ToolRow = {
    /** 行首动词（工具名） */
    verb: string
    /** 动词后的自然语言摘要（纯展示工具的 description——Bash 的 title 语义就是它，
     *  新形态必须保留而非被 command chip 挤掉；跳转类路径 chip 即摘要，恒为 null） */
    summary: string | null
    /** 路径/命令 chip；null = 无 chip */
    chip: ToolRowChip | null
    /** 动词后附加信息（Read 行号区间 / MultiEdit 编辑数） */
    rowMeta: string | null
    /** 行尾 diff 统计 */
    stats: ToolRowStats | null
}

/** 跳转类工具的 file_path 键（与 knownTools title 的取键保持同源） */
function filePathOf(input: unknown): string | null {
    return getInputStringAny(input, ['file_path', 'path', 'file'])
}

/** 纯展示工具 → chip 文本键的映射（无 URI）。WebFetch 不入此表：其旧形态 title 是
 *  hostname（新形态完整 URL 属信息退化），维持原 title 渲染 */
const DISPLAY_ONLY_CHIP_KEYS: Record<string, string[]> = {
    Bash: ['command', 'cmd'],
    shell_command: ['command', 'cmd'],
    Glob: ['pattern'],
    Grep: ['pattern'],
    LS: ['path'],
    WebSearch: ['query'],
}

/** Edit 单次替换的增删行数：old 行数计删、new 行数计增（静态推算，非语义 diff） */
function editStats(oldString: string, newString: string): ToolRowStats {
    return { add: countLines(newString), del: countLines(oldString) }
}

/** Read 的行号区间（offset 0 基 → 1 基展示）；无 offset 不展示 */
function readRowMeta(input: unknown): string | null {
    if (!isObject(input) || typeof input.offset !== 'number') return null
    const from = input.offset + 1
    if (typeof input.limit === 'number') return `L${from}–${input.offset + input.limit}`
    if (typeof input.content === 'string') return `L${from}–${input.offset + countLines(input.content)}`
    return `L${from}–`
}

/** 跳转类工具的推导（四件套各自的能力差异在此收口）；路径 chip 即摘要，无 summary */
function inferFileBearingRow(toolName: string, input: unknown, metadata: SessionMetadataSummary | null): ToolRow | null {
    const filePath = filePathOf(input)
    if (!filePath) return null

    const chip: ToolRowChip = {
        text: resolveDisplayPath(filePath, metadata),
        uri: buildActionUri('file/open', { path: filePath }),
    }

    let rowMeta: string | null = null
    let stats: ToolRowStats | null = null
    // input 的对象形态统一收口一次，各工具分支只判字段
    const obj = isObject(input) ? input : null
    if (toolName === 'Read') {
        rowMeta = readRowMeta(input)
    } else if (toolName === 'Edit' && obj
        && typeof obj.old_string === 'string' && typeof obj.new_string === 'string') {
        stats = editStats(obj.old_string, obj.new_string)
    } else if (toolName === 'MultiEdit' && obj && Array.isArray(obj.edits)) {
        stats = obj.edits.reduce<ToolRowStats>((acc, edit) => {
            if (!isObject(edit) || typeof edit.old_string !== 'string' || typeof edit.new_string !== 'string') return acc
            const s = editStats(edit.old_string, edit.new_string)
            return { add: acc.add + s.add, del: acc.del + s.del }
        }, { add: 0, del: 0 })
        if (obj.edits.length > 1) rowMeta = `${obj.edits.length} edits`
    } else if (toolName === 'Write' && obj) {
        const content = typeof obj.content === 'string' ? obj.content : null
        if (content !== null) stats = { add: countLines(content), del: 0 }
    }

    return { verb: toolName, summary: null, chip, rowMeta, stats }
}

/** 纯展示工具的推导：同款 chip 形态、无 URI；description 语义收进 summary 不丢 */
function inferDisplayOnlyRow(toolName: string, input: unknown, description: string | null, metadata: SessionMetadataSummary | null): ToolRow | null {
    const keys = DISPLAY_ONLY_CHIP_KEYS[toolName]
    if (!keys) return null
    const text = getInputStringAny(input, keys)
    if (!text) return null
    // LS 的 path 是目录，cwd 内时同样转相对显示；其余（command/pattern）原样
    const display = toolName === 'LS' ? resolveDisplayPath(text, metadata) : text
    return { verb: toolName, summary: description, chip: { text: display }, rowMeta: null, stats: null }
}

/** 推导工具行新形态（位置参数，与 getPermissionDescription 同款）。跳转类工具缺 file_path、纯展示工具缺 chip 键、
 *  以及 Agent/Task 等不参与新形态的工具一律返回 null（渲染层维持现状）。 */
export function inferToolRow(toolName: string, input: unknown, metadata: SessionMetadataSummary | null, description: string | null = null): ToolRow | null {
    if ((FILE_BEARING_TOOLS as readonly string[]).includes(toolName)) {
        return inferFileBearingRow(toolName, input, metadata)
    }
    return inferDisplayOnlyRow(toolName, input, description, metadata)
}
