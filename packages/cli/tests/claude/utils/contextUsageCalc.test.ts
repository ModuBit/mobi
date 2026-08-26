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
import { calcContextUsageFromAssistant, calcContextUsageFromCompact, calcContextUsageFromResult, hasAssistantUsage } from '../../../src/claude/utils/contextUsageCalc'
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'

describe('calcContextUsageFromAssistant', () => {
    it('正常值：三项输入 + output 为水位（消息完成后的实际占用），算百分比', () => {
        const r = calcContextUsageFromAssistant(
            { input_tokens: 310, cache_creation_input_tokens: 0, cache_read_input_tokens: 127488, output_tokens: 42 }, 1_000_000, 0.42)
        expect(r).toEqual({
            totalTokens: 127840, maxTokens: 1_000_000, percentage: 12.784, costUsd: 0.42,
            // 四项细分随水位上报（web Popover 展示 + 命中率计算）
            inputTokens: 310, outputTokens: 42, cacheReadTokens: 127488, cacheCreationTokens: 0,
        })
    })

    it('output 缺失（delta 未到/abort）→ 回退三项输入之和', () => {
        const r = calcContextUsageFromAssistant(
            { input_tokens: 310, cache_creation_input_tokens: 0, cache_read_input_tokens: 127488 }, 1_000_000, 0.42)
        expect(r?.totalTokens).toBe(127798)
    })

    it('四项全 0（渠道不返回）→ null', () => {
        expect(calcContextUsageFromAssistant({ input_tokens: 0 }, 1_000_000, 0.42)).toBeNull()
        expect(calcContextUsageFromAssistant(undefined, 1_000_000, 0.42)).toBeNull()
    })

    it('窗口未知（lastMaxTokens=0，首 turn 前）→ null', () => {
        expect(calcContextUsageFromAssistant({ input_tokens: 310 }, 0, 0)).toBeNull()
    })
})

describe('calcContextUsageFromCompact（行为锁定）', () => {
    it('post_tokens + 记忆窗口 → 压缩后水位（无细分：post_tokens 只有总量）', () => {
        const u = calcContextUsageFromCompact(18000, 1_000_000, 0.42)
        expect(u).toMatchObject({ totalTokens: 18000, maxTokens: 1_000_000, costUsd: 0.42 })
        expect(u!.percentage).toBeCloseTo(1.8, 10)
        expect(u!.inputTokens).toBeUndefined()
        expect(u!.cacheReadTokens).toBeUndefined()
    })
    it('post_tokens 缺失或无窗口记忆 → null', () => {
        expect(calcContextUsageFromCompact(undefined, 1_000_000, 0)).toBeNull()
        expect(calcContextUsageFromCompact(18000, 0, 0)).toBeNull()
    })
})

describe('calcContextUsageFromResult（新口径）', () => {
    const makeResult = (usage: unknown, contextWindow = 1_000_000): SDKResultMessage => ({
        type: 'result', subtype: 'success', uuid: 'u', session_id: 's',
        duration_ms: 1000, duration_api_ms: 900, is_error: false, num_turns: 2,
        result: '', stop_reason: null, total_cost_usd: 0.5,
        usage: usage as SDKResultMessage['usage'],
        modelUsage: { 'claude-opus-4-8[1m]': {
            inputTokens: 1509, outputTokens: 353, cacheReadInputTokens: 11092608,
            cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0.5,
            contextWindow, maxOutputTokens: 64000,
        } },
        permission_denials: [],
    } as unknown as SDKResultMessage)

    it('水位取 lastAssistantUsage，绝不用 result.usage 累计值（255232 回归）', () => {
        const r = calcContextUsageFromResult(
            makeResult({ input_tokens: 1509, cache_creation_input_tokens: 0, cache_read_input_tokens: 255232, output_tokens: 353 }),
            { input_tokens: 1199, cache_creation_input_tokens: 0, cache_read_input_tokens: 127744 },
            0, 0)
        // 128943 = 1199+127744（assistant 瞬时），不是 256741（result 累计）
        expect(r.usage).toEqual({
            totalTokens: 128943, maxTokens: 1_000_000, percentage: 12.8943, costUsd: 0.5,
            inputTokens: 1199, outputTokens: 0, cacheReadTokens: 127744, cacheCreationTokens: 0,
        })
        expect(r.maxTokens).toBe(1_000_000)
        expect(r.costUsd).toBe(0.5)
    })

    it('无可靠 assistant usage → usage 为 null 但记忆字段仍返回', () => {
        const r = calcContextUsageFromResult(makeResult({ input_tokens: 1509, cache_read_input_tokens: 255232 }), undefined, 0, 0)
        expect(r.usage).toBeNull()
        expect(r.maxTokens).toBe(1_000_000)
    })

    it('result 无 modelUsage → 沿用旧窗口记忆；两者皆无 → usage 为 null', () => {
        const noMu = makeResult({ input_tokens: 1 }) as SDKResultMessage
        delete (noMu as { modelUsage?: unknown }).modelUsage
        expect(calcContextUsageFromResult(noMu, { input_tokens: 10, cache_read_input_tokens: 100 }, 800000, 0).maxTokens).toBe(800000)
        expect(calcContextUsageFromResult(noMu, { input_tokens: 10, cache_read_input_tokens: 100 }, 0, 0).usage).toBeNull()
    })

    it('result 缺 total_cost_usd（部分错误 result）→ costUsd 为 undefined 不覆写记忆，兜底水位成本用旧记忆', () => {
        const noCost = makeResult({ input_tokens: 5 }) as SDKResultMessage
        delete (noCost as { total_cost_usd?: unknown }).total_cost_usd
        const r = calcContextUsageFromResult(noCost, { input_tokens: 10, cache_read_input_tokens: 100 }, 1_000_000, 1.23)
        expect(r.costUsd).toBeUndefined()          // 调用方据此保持旧记忆，不归零
        expect(r.usage?.costUsd).toBe(1.23)        // 兜底水位用最新已知成本，不报 $0.00
    })
})

describe('hasAssistantUsage（判据单一来源）', () => {
    it('四项和 > 0 → true；全 0/缺失/undefined → false', () => {
        expect(hasAssistantUsage({ input_tokens: 5 })).toBe(true)
        expect(hasAssistantUsage({ output_tokens: 7 })).toBe(true)
        expect(hasAssistantUsage({ input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 })).toBe(false)
        expect(hasAssistantUsage({})).toBe(false)
        expect(hasAssistantUsage(undefined)).toBe(false)
    })
})
