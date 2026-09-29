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

/**
 * 流式 turn 文件投影（审查 v3 票05）：从消息块流实时投影「当前 turn 已编辑的文件」。
 *
 * 与 CLI 侧 turnDiffReporter.observeInner 是同一投影规则的两端实现（工具名单、file_path
 * 取法、structuredPatch 行数累加逐一同构，改一处须同步另一处）：数据源是已流式到达的
 * tool_use / tool-result 消息块（ChatToolCall.structuredPatch 由 normalizeAgent 落在
 * 工具调用上），零协议改动。turn 边界 = 最近一个 turn-result 事件块——result 到达即
 * 重置段，权威 turn-diff 卡（CLI 在 result 后合成）同帧到位，投影自然让位、不闪变。
 *
 * 纯派生函数：输入 blocks 输出文件列表，不持有状态（feedback_stale-state）；
 * 调用方负责 isRunning 门槛（历史残留段在会话中断后不该显示 live 卡）。
 */

import type { ChatBlock } from '@/domain/chat'
import { getField } from '@mobi/shared'

/** 记变更的编辑族工具（与 CLI turnDiffReporter.EDIT_TOOLS 同一名单） */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

export type LiveTurnFile = {
    path: string
    additions: number
    deletions: number
}

/** 从消息块流投影当前 turn 的编辑文件（按首次出现排序；同文件多次编辑行数累加） */
export function projectLiveTurnFiles(blocks: ChatBlock[]): LiveTurnFile[] {
    // turn 边界：最后一个 turn-result 事件之后的段才是当前 turn
    let start = 0
    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i]
        if (block?.kind === 'agent-event' && block.event.type === 'turn-result') {
            start = i + 1
            break
        }
    }

    const files = new Map<string, LiveTurnFile>()
    for (const block of blocks.slice(start)) {
        if (block.kind !== 'tool-call' || !EDIT_TOOLS.has(block.tool.name)) continue
        const input = block.tool.input
        const path = input !== null && typeof input === 'object'
            ? getField(input as Record<string, unknown>, 'file_path')
            : undefined
        if (typeof path !== 'string' || path.length === 0) continue
        let additions = 0
        let deletions = 0
        for (const hunk of block.tool.structuredPatch ?? []) {
            for (const line of hunk.lines) {
                if (line.startsWith('+')) additions += 1
                else if (line.startsWith('-')) deletions += 1
            }
        }
        const existing = files.get(path)
        if (existing) {
            existing.additions += additions
            existing.deletions += deletions
        } else {
            files.set(path, { path, additions, deletions })
        }
    }
    return [...files.values()]
}
