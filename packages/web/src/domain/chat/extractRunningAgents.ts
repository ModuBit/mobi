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

import type { ChatBlock } from './types'
import { isAgentTool } from '@/components/tool-card/knownTools'
import { getInputStringAny } from '@/core/lib/toolInputUtils'

/** 正在运行或等待中的 Agent 信息 */
export type RunningAgent = {
    block: Extract<ChatBlock, { kind: 'tool-call' }>
    subagentType: string | null
    description: string | null
    summary: string | null
}

/**
 * 从 ChatBlock 列表中提取所有 running/pending 状态的 Agent 工具调用
 */
export function extractRunningAgents(blocks: ChatBlock[]): RunningAgent[] {
    const result: RunningAgent[] = []
    for (const block of blocks) {
        if (block.kind !== 'tool-call') continue
        if (!isAgentTool(block.tool.name)) continue
        if (block.tool.state !== 'running' && block.tool.state !== 'pending') continue

        result.push({
            block,
            subagentType: getInputStringAny(block.tool.input, ['subagent_type', 'subagentType']),
            description: getInputStringAny(block.tool.input, ['description']),
            summary: block.tool.agentSummary ?? null,
        })
    }
    return result
}
