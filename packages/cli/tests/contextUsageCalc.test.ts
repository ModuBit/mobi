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

import { describe, it, expect } from 'vitest'
import { calcContextUsageFromResult, calcContextUsageFromCompact } from '../src/claude/utils/contextUsageCalc'
import type { SDKResultMessage, ModelUsage } from '@anthropic-ai/claude-agent-sdk'

const model = (over: Partial<ModelUsage> = {}): ModelUsage => ({
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    webSearchRequests: 0,
    costUSD: 0.01,
    contextWindow: 200000,
    maxOutputTokens: 8000,
    ...over,
})

const makeResult = (over: Record<string, unknown> = {}): SDKResultMessage =>
    ({
        type: 'result',
        subtype: 'success',
        usage: {
            input_tokens: 1000,
            output_tokens: 200,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
        },
        modelUsage: { glm: model() },
        total_cost_usd: 0.01,
        ...over,
    }) as unknown as SDKResultMessage

describe('calcContextUsageFromResult', () => {
    it('正常 result 组装用量并回传 maxTokens/costUsd 供 compact 复用', () => {
        const r = calcContextUsageFromResult(makeResult())
        expect(r).not.toBeNull()
        expect(r!.usage.totalTokens).toBe(1000)
        expect(r!.usage.maxTokens).toBe(200000)
        expect(r!.usage.percentage).toBeCloseTo(0.5, 5)
        expect(r!.usage.costUsd).toBe(0.01)
        expect(r!.maxTokens).toBe(200000)
        expect(r!.costUsd).toBe(0.01)
    })

    it('本地命令 usage 全 0 → null（判据数据特征，不维护命令清单）', () => {
        const r = calcContextUsageFromResult(makeResult({
            usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }))
        expect(r).toBeNull()
    })

    it('usage 缺失 → null', () => {
        const r = calcContextUsageFromResult(makeResult({ usage: undefined }))
        expect(r).toBeNull()
    })

    it('窗口大小未知（modelUsage 空）→ null，避免误导性 0%', () => {
        const r = calcContextUsageFromResult(makeResult({ modelUsage: {} }))
        expect(r).toBeNull()
    })

    it('多模型取累计 inputTokens 最大的为主模型', () => {
        const r = calcContextUsageFromResult(makeResult({
            modelUsage: {
                small: model({ inputTokens: 100, contextWindow: 8000 }),
                big: model({ inputTokens: 5000, contextWindow: 200000 }),
            },
        }))
        expect(r!.usage.maxTokens).toBe(200000)
    })
})

describe('calcContextUsageFromCompact', () => {
    it('用 post_tokens + 记忆组装压缩后用量', () => {
        const u = calcContextUsageFromCompact(1900, 200000, 0.05)
        expect(u).not.toBeNull()
        expect(u!.totalTokens).toBe(1900)
        expect(u!.maxTokens).toBe(200000)
        expect(u!.percentage).toBeCloseTo(0.95, 5)
        expect(u!.costUsd).toBe(0.05)
    })

    it('post_tokens 缺失（压缩失败）→ null，保持上一轮', () => {
        expect(calcContextUsageFromCompact(undefined, 200000, 0.05)).toBeNull()
    })

    it('未知窗口大小（尚无真实 turn 记忆）→ null', () => {
        expect(calcContextUsageFromCompact(1900, 0, 0)).toBeNull()
    })
})
