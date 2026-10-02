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
 * AssistantPartialAssembler 基准 fixture：确定性 SDK 消息序列生成器
 *
 * 设计约束（docs/conventions/performance.md：确定性计数才有资格进门禁）：
 * - 零随机、零时钟：内容全部由索引算术派生（repeat/slice/取模），同参数两次生成
 *   深度相等——指令计数模式下不确定的输入等于废纸
 * - 形状贴近真实会话流：user 边界、多 partial assistant（thinking/text/tool_use）、
 *   子 agent complete（parent_tool_use_id 非空）、tool_result user 消息、result 收尾
 */

import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

/** 基础文本池：中英混合 + 代码味片段，按索引切片派生所有内容，保证确定性 */
const TEXT_POOL = ('流式渲染性能基准fixture。The quick brown fox jumps over the lazy dog. '
    + 'function render(chunk) { return chunk.map(x => x * 2); } '
    + '消息装配器按 message.id 累积 content block，在边界 flush 成完整消息。').repeat(8)

function slice(i: number, len: number): string {
    const start = (i * 13) % (TEXT_POOL.length - len)
    return TEXT_POOL.slice(start, start + len)
}

function asst(id: string, blocks: unknown[], parentToolUseId?: string): SDKMessage {
    return {
        type: 'assistant',
        uuid: `u-${id}`,
        parent_tool_use_id: parentToolUseId,
        message: { id, type: 'message', role: 'assistant', content: blocks },
    } as unknown as SDKMessage
}

export interface AssemblerFixture {
    messages: SDKMessage[]
    /** 重放后 assembler 应产出的消息总数（供 bench/test 做不变量断言） */
    expectedOutputs: number
}

/**
 * 生成 `turns` 个回合的确定性消息序列。回合结构（索引算术驱动变化）：
 * - user 消息（message 边界，触发 flushAll）
 * - 1-3 条 assistant message，各拆 4-9 个 partial（thinking/text/tool_use 混合）
 * - 每 4 回合一条子 agent complete（立即透传路径）
 * - 每 4 回合一条 tool_result user 消息（另一条边界路径）
 * - 末尾 result 收尾
 */
export function buildFixture(turns: number): AssemblerFixture {
    const messages: SDKMessage[] = []
    let expectedOutputs = 0
    let seq = 0

    for (let t = 0; t < turns; t++) {
        // user 边界消息
        messages.push({
            type: 'user',
            uuid: `uu-${seq++}`,
            message: { role: 'user', content: [{ type: 'text', text: slice(t, 40) }] },
        } as unknown as SDKMessage)
        expectedOutputs++

        const msgCount = 1 + (t % 3)
        for (let m = 0; m < msgCount; m++) {
            const id = `msg_${t}_${m}`
            const partialCount = 4 + ((t + m) % 6)
            for (let p = 0; p < partialCount; p++) {
                const kind = (t + m + p) % 4
                const block
                    = kind === 0
                        ? { type: 'thinking', thinking: slice(seq, 30 + (p * 11) % 80), signature: 'sig' }
                        : kind === 1
                            ? { type: 'text', text: slice(seq, 25 + (p * 17) % 90) }
                            : kind === 2
                                ? { type: 'text', text: slice(seq, 20) }
                                : { type: 'tool_use', id: `tu_${seq}`, name: 'Read', input: { file_path: slice(seq, 24) } }
                messages.push(asst(id, [block]))
                seq++
            }
            // 每条 message 的 partial 由装配器累积，flush 时产出 1 条完整消息
            expectedOutputs++
        }

        if (t % 4 === 0) {
            // 子 agent complete：立即透传路径
            messages.push(asst(`sub_${t}`, [{ type: 'tool_use', id: `tu_sub_${t}`, name: 'Bash', input: {} }], `toolu_${t}`))
            expectedOutputs++
        }
        if (t % 4 === 1) {
            // tool_result user 消息：非 assistant 边界
            messages.push({
                type: 'user',
                uuid: `uu-${seq++}`,
                message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tu_${seq}`, content: slice(t, 50) }] },
            } as unknown as SDKMessage)
            expectedOutputs++
        }
    }

    messages.push({ type: 'result', subtype: 'success' } as unknown as SDKMessage)
    expectedOutputs++

    return { messages, expectedOutputs }
}
