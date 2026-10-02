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
 * 基准 fixture 的不变量测试：确定性 + 重放输出总数声明一致。
 * 基准对「坏掉的行为计数」比没有基准更糟——这两个断言是基准可信性的下限。
 */

import { describe, test, expect } from 'vitest'
import { AssistantPartialAssembler } from '@/claude/utils/assistantPartialAssembler'
import { buildFixture } from '../../benchmarks/assistantPartialAssembler.fixture'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

describe('assembler bench fixture', () => {
    test('确定性：同参数两次生成深度相等', () => {
        expect(buildFixture(50)).toEqual(buildFixture(50))
    })

    test('重放输出总数与 fixture 声明一致（bench 的语义校验依据）', () => {
        const { messages, expectedOutputs } = buildFixture(120)
        const out: SDKMessage[] = []
        const assembler = new AssistantPartialAssembler(m => out.push(m))
        for (const message of messages) assembler.submit(message)
        assembler.flushAll()
        expect(out.length).toBe(expectedOutputs)
    })

    test('消息序列确实覆盖关键路径：含 partial assistant / 子 agent complete / 边界消息', () => {
        const { messages } = buildFixture(40)
        const types = messages.map(m => m.type)
        expect(types).toContain('user')
        expect(types).toContain('assistant')
        expect(types).toContain('result')
        // 子 agent complete（parent_tool_use_id 非空）存在
        expect(messages.some(m => (m as { parent_tool_use_id?: string }).parent_tool_use_id)).toBe(true)
        // 同 message.id 多 partial 存在（装配路径的主场景）
        const ids = messages
            .filter(m => m.type === 'assistant')
            .map(m => (m as { message?: { id?: string } }).message?.id)
        expect(new Set(ids).size).toBeLessThan(ids.length)
    })
})
