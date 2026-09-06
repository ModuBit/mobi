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

import { describe, it, expect, vi } from 'vitest'
import { ContextUsageTracker } from '../../src/claude/contextUsageTracker'
import type { SDKControlGetContextUsageResponse, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'

/**
 * ContextUsageTracker 编排 characterization：锁定水位采集的「何时上报、更新哪块记忆、
 * 怎么防乱序」——纯计算契约已由 contextUsageCalc.test.ts / modelContextWindow 覆盖，
 * 这里只测编排（mock 两个通道 + 喂事件序列断言上报序列）。
 * 每条测试对应原 claudeRemoteLauncher 内联实现的一段行为，迁移时不得漂移。
 */

/** assistant usage 四项（与 calcContextUsageFromAssistant 的输入契约一致） */
const U = (input = 310, read = 127488, output = 42, creation = 0) => ({
    input_tokens: input,
    cache_creation_input_tokens: creation,
    cache_read_input_tokens: read,
    output_tokens: output,
})

const makeResult = (overrides: {
    usage?: unknown
    totalCostUsd?: number | null
    contextWindow?: number
    modelKey?: string
} = {}): SDKResultMessage => ({
    type: 'result', subtype: 'success', uuid: 'u', session_id: 's',
    duration_ms: 1000, duration_api_ms: 900, is_error: false, num_turns: 2,
    result: '', stop_reason: null, total_cost_usd: overrides.totalCostUsd ?? 0.5,
    usage: (overrides.usage ?? { input_tokens: 1509, cache_read_input_tokens: 255232 }) as SDKResultMessage['usage'],
    modelUsage: {
        [overrides.modelKey ?? 'claude-opus-4-8[1m]']: {
            inputTokens: 1509, outputTokens: 353, cacheReadInputTokens: 11092608,
            cacheCreationInputTokens: 0, webSearchRequests: 0, costUSD: 0.5,
            contextWindow: overrides.contextWindow ?? 1_000_000, maxOutputTokens: 64000,
        },
    },
    permission_denials: [],
} as unknown as SDKResultMessage)

/** 带 rawMaxTokens + 类目细分的 getContextUsage summary（extractBreakdown 可提取出 breakdown） */
const SUMMARY_WITH_BREAKDOWN = (rawMaxTokens: number): SDKControlGetContextUsageResponse => ({
    rawMaxTokens,
    totalTokens: 40_000,
    model: 'claude-opus-4-8[1m]',
    categories: [
        { name: 'System prompt', tokens: 20_000 },
        { name: 'Messages', tokens: 20_000 },
    ],
} as SDKControlGetContextUsageResponse)

const EXPECTED_BREAKDOWN = {
    categories: [
        { key: 'systemPrompt', tokens: 20_000 },
        { key: 'messages', tokens: 20_000 },
    ],
    freeTokens: 0,
    mcpTools: [],
    skills: [],
    memoryFiles: [],
}

const makeTracker = () => {
    const fetchSummary = vi.fn<() => Promise<SDKControlGetContextUsageResponse | undefined>>()
    const reportUsage = vi.fn()
    const tracker = new ContextUsageTracker({ fetchSummary, reportUsage })
    return { tracker, fetchSummary, reportUsage }
}

describe('onAssistantUsage（流式实时上报）', () => {
    it('窗口未知时按请求名猜测预填；猜测输入优先 init 请求名而非 assistant.model（网关上游名不同源）', () => {
        const { tracker, reportUsage } = makeTracker()
        tracker.onInit('claude-opus-4-8[1m]')
        tracker.onAssistantUsage(U(100, 0, 10, 0), 'glm-5.3')
        expect(reportUsage).toHaveBeenCalledTimes(1)
        expect(reportUsage).toHaveBeenCalledWith({
            totalTokens: 110, maxTokens: 1_000_000, percentage: 110 / 1_000_000 * 100, costUsd: 0,
            inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0,
        })
    })

    it('无 init 请求名 → 回落 assistant.message.model 猜测', () => {
        const { tracker, reportUsage } = makeTracker()
        tracker.onAssistantUsage(U(100, 0, 10, 0), 'claude-opus-4-8')
        expect(reportUsage).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 200_000 }))
    })

    it('模型名全缺 → 不上报（等 result 兜底）', () => {
        const { tracker, reportUsage } = makeTracker()
        tracker.onAssistantUsage(U(100, 0, 10, 0))
        expect(reportUsage).not.toHaveBeenCalled()
    })

    it('渠道零 usage → 跳过不上报（判据 hasAssistantUsage）', () => {
        const { tracker, reportUsage } = makeTracker()
        tracker.onInit('claude-opus-4-8[1m]')
        tracker.onAssistantUsage({ input_tokens: 0 }, 'glm-5.3')
        tracker.onAssistantUsage(undefined, 'glm-5.3')
        expect(reportUsage).not.toHaveBeenCalled()
    })
})

describe('onResult（turn 兜底上报）', () => {
    it('先拉 summary 再计算：CC 有效窗口优先做分母，breakdown/窗口回写记忆，上报附带细分与模型上限', async () => {
        const { tracker, fetchSummary, reportUsage } = makeTracker()
        tracker.onInit('claude-opus-4-8[1m]')
        tracker.onAssistantUsage(U(1199, 127744, 0, 0), 'glm-5.3')  // 猜测窗口 1m，report#1
        fetchSummary.mockResolvedValue(SUMMARY_WITH_BREAKDOWN(350_000))

        await tracker.onResult(makeResult({ totalCostUsd: 0.5, contextWindow: 1_000_000 }))

        // report#2：分母用 CC 有效窗口 350k（非模型最大 1m），细分 + modelContextTokens 附带
        expect(reportUsage).toHaveBeenCalledTimes(2)
        const report2 = reportUsage.mock.calls[1][0]
        expect(report2).toMatchObject({
            totalTokens: 128943, maxTokens: 350_000, costUsd: 0.5,
            inputTokens: 1199, outputTokens: 0, cacheReadTokens: 127744, cacheCreationTokens: 0,
            breakdown: EXPECTED_BREAKDOWN, modelContextTokens: 1_000_000,
        })
        expect(report2.percentage).toBeCloseTo(128943 / 350_000 * 100, 10)
        // report#3：记忆已回写——后续流式上报直接用 350k 真实窗口 + 0.5 成本，细分不丢
        tracker.onAssistantUsage(U(100, 0, 10, 0))
        expect(reportUsage).toHaveBeenCalledTimes(3)
        expect(reportUsage).toHaveBeenLastCalledWith({
            totalTokens: 110, maxTokens: 350_000, percentage: 110 / 350_000 * 100, costUsd: 0.5,
            inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0,
            breakdown: EXPECTED_BREAKDOWN, modelContextTokens: 1_000_000,
        })
    })

    it('await fetchSummary 期间流式上报到达（代际推进）→ 旧 turn 读数放弃，不发回退水位', async () => {
        const { tracker, fetchSummary, reportUsage } = makeTracker()
        tracker.onInit('claude-opus-4-8[1m]')
        tracker.onAssistantUsage(U(), 'glm-5.3')   // report#1，代际 1
        let resolveSummary!: (s: SDKControlGetContextUsageResponse) => void
        fetchSummary.mockReturnValue(new Promise(res => { resolveSummary = res }))

        const pending = tracker.onResult(makeResult())
        tracker.onAssistantUsage(U(100, 0, 10, 0))  // 流式插队：代际 2
        resolveSummary(SUMMARY_WITH_BREAKDOWN(350_000))
        await pending

        expect(reportUsage).toHaveBeenCalledTimes(2)  // 旧 result 读数未发
    })

    it('compact result 只回填累计成本不上报（用量已由 compact_boundary 的 post_tokens 代表）', async () => {
        const { tracker, fetchSummary, reportUsage } = makeTracker()
        tracker.onInit('claude-opus-4-8[1m]')
        tracker.onAssistantUsage(U(), 'glm-5.3')   // report#1
        await tracker.onResult(makeResult({ totalCostUsd: 1.23 }), true)
        expect(reportUsage).toHaveBeenCalledTimes(1)  // compact result 不上报
        tracker.onAssistantUsage(U(100, 0, 10, 0))
        expect(reportUsage).toHaveBeenLastCalledWith(expect.objectContaining({ costUsd: 1.23 }))
        expect(fetchSummary).not.toHaveBeenCalled()
    })

    it('result 缺 total_cost_usd（部分错误 result）→ 成本记忆不覆写，兜底水位用最新已知成本', async () => {
        const { tracker, reportUsage } = makeTracker()
        // 首个 result 无 assistant usage 记忆 → usage null 不上报，但窗口/成本记忆写入
        await tracker.onResult(makeResult({ totalCostUsd: 1.23 }))
        expect(reportUsage).not.toHaveBeenCalled()
        tracker.onAssistantUsage(U(100, 0, 10, 0), 'claude-opus-4-8')  // report#1：costUsd 1.23
        // 第二个 result 缺成本 → 不覆写记忆，兜底水位仍报 1.23（非 $0.00）
        const noCost = makeResult()
        delete (noCost as { total_cost_usd?: unknown }).total_cost_usd
        await tracker.onResult(noCost)
        expect(reportUsage).toHaveBeenCalledTimes(2)
        expect(reportUsage).toHaveBeenLastCalledWith(expect.objectContaining({ costUsd: 1.23 }))
    })
})

describe('onCompactBoundary（压缩后上报）', () => {
    it('post_tokens + 记忆窗口 → 压缩后水位；pre-compact 细分作废（防新旧口径同屏矛盾）', async () => {
        const { tracker, reportUsage } = makeTracker()
        const query = {
            getContextUsage: vi.fn(async () => SUMMARY_WITH_BREAKDOWN(400_000)),
        }
        await tracker.collectStartupUsage(query as never)   // report#1：窗口 400k + 细分
        tracker.onCompactBoundary(18_000)                    // report#2
        expect(reportUsage).toHaveBeenCalledTimes(2)
        expect(reportUsage).toHaveBeenLastCalledWith({
            totalTokens: 18_000, maxTokens: 400_000, percentage: 4.5, costUsd: 0,
        })
        // 后续流式上报不再带 pre-compact 细分
        tracker.onInit('claude-opus-4-8[1m]')  // reset 未发生，窗口已在——猜测不触发
        tracker.onAssistantUsage(U(100, 0, 10, 0))
        const last = reportUsage.mock.calls[2][0] as Record<string, unknown>
        expect(last.maxTokens).toBe(400_000)
        expect(last.breakdown).toBeUndefined()
    })

    it('post_tokens 缺失或无窗口记忆 → 不上报', () => {
        const { tracker, reportUsage } = makeTracker()
        tracker.onCompactBoundary(undefined)
        tracker.onCompactBoundary(18_000)  // maxTokens=0：calc 返回 null
        expect(reportUsage).not.toHaveBeenCalled()
    })
})

describe('collectStartupUsage（query 启动首轮前水位）', () => {
    it('无窗口记忆：rawMaxTokens 采纳 + 细分缓存 + 静态基线读数上报', async () => {
        const { tracker, reportUsage } = makeTracker()
        const getContextUsage = vi.fn(async () => SUMMARY_WITH_BREAKDOWN(400_000))
        await tracker.collectStartupUsage({ getContextUsage } as never)
        expect(reportUsage).toHaveBeenCalledTimes(1)
        expect(reportUsage).toHaveBeenCalledWith({
            totalTokens: 40_000, maxTokens: 400_000, percentage: 10, costUsd: 0,
            breakdown: EXPECTED_BREAKDOWN,
        })
        // 窗口记忆已落：后续流式上报不触发猜测
        tracker.onAssistantUsage(U(100, 0, 10, 0))
        expect(reportUsage).toHaveBeenLastCalledWith(expect.objectContaining({ maxTokens: 400_000 }))
    })

    it('rawMaxTokens=0（渠道不支持）→ 按 summary.model 猜测兜底', async () => {
        const { tracker, reportUsage } = makeTracker()
        const summary = { rawMaxTokens: 0, totalTokens: 30_000, model: 'claude-opus-4-8[1m]' } as SDKControlGetContextUsageResponse
        await tracker.collectStartupUsage({ getContextUsage: vi.fn(async () => summary) } as never)
        expect(reportUsage).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 1_000_000, totalTokens: 30_000 }))
    })

    it('已有窗口记忆 → 跳过（本会话已有 result，实测值更权威）', async () => {
        const { tracker } = makeTracker()
        tracker.onInit('claude-opus-4-8[1m]')
        tracker.onAssistantUsage(U())  // 窗口已猜测落记忆
        const getContextUsage = vi.fn()
        await tracker.collectStartupUsage({ getContextUsage } as never)
        expect(getContextUsage).not.toHaveBeenCalled()
    })

    it('双检竞态：拉取期间 result 已到达 → 放弃静态基线', async () => {
        const { tracker, reportUsage } = makeTracker()
        let resolveSummary!: (s: SDKControlGetContextUsageResponse) => void
        const getContextUsage = vi.fn(() => new Promise<SDKControlGetContextUsageResponse>(res => { resolveSummary = res }))
        const pending = tracker.collectStartupUsage({ getContextUsage } as never)
        tracker.onInit('claude-opus-4-8[1m]')
        tracker.onAssistantUsage(U())  // await 期间真实数据到达
        resolveSummary(SUMMARY_WITH_BREAKDOWN(400_000))
        await pending
        expect(reportUsage).toHaveBeenCalledTimes(1)  // 只有流式那次
    })
})

describe('reset（上下文重置，/clear 与 output style 切换共用）', () => {
    it('六字段归零：窗口回退猜测、细分/成本/模型上限清空', async () => {
        const { tracker, fetchSummary, reportUsage } = makeTracker()
        tracker.onInit('claude-opus-4-8[1m]')
        tracker.onAssistantUsage(U(), 'glm-5.3')
        fetchSummary.mockResolvedValue(SUMMARY_WITH_BREAKDOWN(350_000))
        await tracker.onResult(makeResult({ totalCostUsd: 2.5 }))
        tracker.reset()
        tracker.onAssistantUsage(U(100, 0, 10, 0))
        expect(reportUsage).toHaveBeenLastCalledWith({
            totalTokens: 110, maxTokens: 1_000_000, percentage: 110 / 1_000_000 * 100, costUsd: 0,
            inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0,
        })  // 无 breakdown、无 modelContextTokens、成本归零、窗口重新猜测
    })

    it('reset 推进代际：在途旧 turn result 上报被作废（不落进新上下文）', async () => {
        const { tracker, fetchSummary, reportUsage } = makeTracker()
        tracker.onInit('claude-opus-4-8[1m]')
        tracker.onAssistantUsage(U(), 'glm-5.3')
        let resolveSummary!: (s: SDKControlGetContextUsageResponse) => void
        fetchSummary.mockReturnValue(new Promise(res => { resolveSummary = res }))
        const pending = tracker.onResult(makeResult())
        tracker.reset()
        resolveSummary(SUMMARY_WITH_BREAKDOWN(350_000))
        await pending
        expect(reportUsage).toHaveBeenCalledTimes(1)  // 只有 reset 前的流式上报
    })
})
