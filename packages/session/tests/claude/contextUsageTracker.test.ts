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
 * 怎么防乱序、窗口从哪来」——纯计算契约已由 contextUsageCalc.test.ts 覆盖，
 * 这里只测编排（mock 两个通道 + 喂事件序列断言上报序列）。
 *
 * 窗口口径（2026-10 收口）：唯一权威来源是 summary.rawMaxTokens，**不再按模型名猜测**；
 * 拿不到窗口就不上报（环显示不可用），启动采集在 fresh/resume 都跑、resume 只取窗口。
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

/** summary + 显式配置的自动压缩阈值（autocompactSource 缺省 = 非 auto，采纳） */
const SUMMARY_WITH_AUTOCOMPACT = (rawMaxTokens: number, threshold = 350_000): SDKControlGetContextUsageResponse => ({
    ...SUMMARY_WITH_BREAKDOWN(rawMaxTokens),
    isAutoCompactEnabled: true,
    autoCompactThreshold: threshold,
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

/** 预置窗口记忆（不产生上报）：模拟 query 就绪时已采集到 summary.rawMaxTokens */
const seedWindow = async (tracker: ContextUsageTracker, rawMaxTokens: number): Promise<void> => {
    await tracker.collectStartupUsage(
        { getContextUsage: vi.fn(async () => SUMMARY_WITH_BREAKDOWN(rawMaxTokens)) } as never,
        { reportBaseline: false },
    )
}

describe('onAssistantUsage（流式实时上报）', () => {
    it('窗口未就绪 → 不上报（不再按模型名猜窗口）', () => {
        const { tracker, reportUsage } = makeTracker()
        tracker.onInit('claude-opus-4-8[1m]')
        tracker.onAssistantUsage(U(100, 0, 10, 0))
        expect(reportUsage).not.toHaveBeenCalled()
    })

    it('窗口就绪后按 CC 权威窗口上报（分母来自 summary，非猜测）', async () => {
        const { tracker, reportUsage } = makeTracker()
        tracker.onInit('claude-opus-4-8[1m]')
        await seedWindow(tracker, 350_000)
        tracker.onAssistantUsage(U(100, 0, 10, 0))
        expect(reportUsage).toHaveBeenCalledTimes(1)
        expect(reportUsage).toHaveBeenCalledWith({
            totalTokens: 110, maxTokens: 350_000, percentage: 110 / 350_000 * 100, costUsd: 0,
            inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0,
        })
    })

    it('渠道零 usage → 跳过不上报（判据 hasAssistantUsage）', async () => {
        const { tracker, reportUsage } = makeTracker()
        await seedWindow(tracker, 1_000_000)
        tracker.onAssistantUsage({ input_tokens: 0 })
        tracker.onAssistantUsage(undefined)
        expect(reportUsage).not.toHaveBeenCalled()
    })
})

describe('onResult（turn 兜底上报）', () => {
    it('先拉 summary 再计算：CC 有效窗口优先做分母，breakdown/窗口回写记忆，上报附带细分与模型上限', async () => {
        const { tracker, fetchSummary, reportUsage } = makeTracker()
        tracker.onInit('claude-opus-4-8[1m]')
        await seedWindow(tracker, 350_000)
        tracker.onAssistantUsage(U(1199, 127744, 0, 0))  // report#1
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
        await seedWindow(tracker, 350_000)
        tracker.onAssistantUsage(U())   // report#1，代际 1
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
        await seedWindow(tracker, 350_000)
        tracker.onAssistantUsage(U())   // report#1
        await tracker.onResult(makeResult({ totalCostUsd: 1.23 }), true)
        expect(reportUsage).toHaveBeenCalledTimes(1)  // compact result 不上报
        tracker.onAssistantUsage(U(100, 0, 10, 0))
        expect(reportUsage).toHaveBeenLastCalledWith(expect.objectContaining({ costUsd: 1.23 }))
        expect(fetchSummary).not.toHaveBeenCalled()
    })

    it('result 缺 total_cost_usd（部分错误 result）→ 成本记忆不覆写，兜底水位用最新已知成本', async () => {
        const { tracker, reportUsage } = makeTracker()
        await seedWindow(tracker, 1_000_000)
        // 首个 result 无 assistant usage 记忆 → usage null 不上报，但成本记忆写入
        await tracker.onResult(makeResult({ totalCostUsd: 1.23 }))
        expect(reportUsage).not.toHaveBeenCalled()
        tracker.onAssistantUsage(U(100, 0, 10, 0))  // report#1：costUsd 1.23
        // 第二个 result 缺成本 → 不覆写记忆，兜底水位仍报 1.23（非 $0.00）
        const noCost = makeResult()
        delete (noCost as { total_cost_usd?: unknown }).total_cost_usd
        await tracker.onResult(noCost)
        expect(reportUsage).toHaveBeenCalledTimes(2)
        expect(reportUsage).toHaveBeenLastCalledWith(expect.objectContaining({ costUsd: 1.23 }))
    })

    it('自动压缩阈值随 summary 透传：显式配置 → autoCompactAtTokens；自动推导 → 不带', async () => {
        const { tracker, fetchSummary, reportUsage } = makeTracker()
        await seedWindow(tracker, 1_000_000)
        fetchSummary.mockResolvedValue(SUMMARY_WITH_AUTOCOMPACT(1_000_000, 350_000))
        await tracker.onResult(makeResult())
        tracker.onAssistantUsage(U(100, 0, 10, 0))
        expect(reportUsage).toHaveBeenLastCalledWith(expect.objectContaining({ autoCompactAtTokens: 350_000 }))

        // 用户关掉 autocompact / 阈值自动推导 → 下一次 result 清掉记忆，后续上报不带刻度
        fetchSummary.mockResolvedValue({
            ...SUMMARY_WITH_BREAKDOWN(1_000_000),
            isAutoCompactEnabled: true,
            autoCompactThreshold: 500_000,
            autocompactSource: 'auto',
        } as SDKControlGetContextUsageResponse)
        await tracker.onResult(makeResult())
        tracker.onAssistantUsage(U(200, 0, 10, 0))
        const last = reportUsage.mock.calls.at(-1)![0] as Record<string, unknown>
        expect(last.autoCompactAtTokens).toBeUndefined()
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

describe('collectStartupUsage（query 启动采集）', () => {
    it('无窗口记忆：rawMaxTokens 采纳 + 静态基线读数上报；细分不缓存（不完整快照不得随实时上报扩散）', async () => {
        const { tracker, reportUsage } = makeTracker()
        const getContextUsage = vi.fn(async () => SUMMARY_WITH_BREAKDOWN(400_000))
        await tracker.collectStartupUsage({ getContextUsage } as never)
        expect(reportUsage).toHaveBeenCalledTimes(1)
        expect(reportUsage).toHaveBeenCalledWith({
            totalTokens: 40_000, maxTokens: 400_000, percentage: 10, costUsd: 0,
            breakdown: EXPECTED_BREAKDOWN,  // 启动上报本身仍携带快照明细
        })
        // 启动采样早于 MCP 就绪（快照缺 MCP tools 类目），不缓存 → 后续流式上报不带明细
        tracker.onAssistantUsage(U(100, 0, 10, 0))
        expect(reportUsage).toHaveBeenLastCalledWith({
            totalTokens: 110, maxTokens: 400_000, percentage: 110 / 400_000 * 100, costUsd: 0,
            inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0,
        })  // 无 breakdown，等首个 result 的 fetchSummary 刷新
    })

    it('rawMaxTokens=0（渠道不支持）→ 不记窗口、不上报，也不猜（环保持不可用）', async () => {
        const { tracker, reportUsage } = makeTracker()
        const summary = { rawMaxTokens: 0, totalTokens: 30_000, model: 'claude-opus-4-8[1m]' } as SDKControlGetContextUsageResponse
        await tracker.collectStartupUsage({ getContextUsage: vi.fn(async () => summary) } as never)
        expect(reportUsage).not.toHaveBeenCalled()
        tracker.onAssistantUsage(U(100, 0, 10, 0))
        expect(reportUsage).not.toHaveBeenCalled()  // 无窗口 → 流式也不报
    })

    it('resume（reportBaseline=false）：只取窗口不报基线，后续流式上报用该窗口', async () => {
        const { tracker, reportUsage } = makeTracker()
        await tracker.collectStartupUsage(
            { getContextUsage: vi.fn(async () => SUMMARY_WITH_BREAKDOWN(1_000_000)) } as never,
            { reportBaseline: false },
        )
        expect(reportUsage).not.toHaveBeenCalled()  // daemon 持久化的真实水位不被静态基线覆盖
        tracker.onAssistantUsage(U(100, 0, 10, 0))
        expect(reportUsage).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 1_000_000, totalTokens: 110 }))
    })

    it('已有窗口记忆 → 跳过（本会话已有真实值，不重复拉取）', async () => {
        const { tracker } = makeTracker()
        await seedWindow(tracker, 350_000)
        const getContextUsage = vi.fn()
        await tracker.collectStartupUsage({ getContextUsage } as never)
        expect(getContextUsage).not.toHaveBeenCalled()
    })

    it('拉取期间已有主线 assistant 到达（首轮抢跑）→ 用那条 usage 报真实水位，而非静态基线', async () => {
        const { tracker, reportUsage } = makeTracker()
        let resolveSummary!: (s: SDKControlGetContextUsageResponse) => void
        const getContextUsage = vi.fn(() => new Promise<SDKControlGetContextUsageResponse>(res => { resolveSummary = res }))
        const pending = tracker.collectStartupUsage({ getContextUsage } as never)
        tracker.onAssistantUsage(U(100, 0, 10, 0))  // 窗口未就绪，本次不上报但记住 usage
        resolveSummary(SUMMARY_WITH_BREAKDOWN(400_000))
        await pending
        expect(reportUsage).toHaveBeenCalledTimes(1)
        expect(reportUsage).toHaveBeenCalledWith(expect.objectContaining({
            totalTokens: 110, maxTokens: 400_000, breakdown: EXPECTED_BREAKDOWN,
        }))
    })

    it('自动压缩阈值：启动采集即透传（环刻度不必等首个 result）', async () => {
        const { tracker, reportUsage } = makeTracker()
        await tracker.collectStartupUsage({ getContextUsage: vi.fn(async () => SUMMARY_WITH_AUTOCOMPACT(1_000_000)) } as never)
        expect(reportUsage).toHaveBeenCalledWith(expect.objectContaining({ autoCompactAtTokens: 350_000 }))
    })
})

describe('reset（上下文重置，/clear 与 output style 切换共用）', () => {
    it('记忆整体归零：窗口/成本/细分/刻度清空，流式不再上报直到重新采集', async () => {
        const { tracker, fetchSummary, reportUsage } = makeTracker()
        tracker.onInit('claude-opus-4-8[1m]')
        await seedWindow(tracker, 350_000)
        tracker.onAssistantUsage(U())  // report#1
        fetchSummary.mockResolvedValue(SUMMARY_WITH_AUTOCOMPACT(350_000))
        await tracker.onResult(makeResult({ totalCostUsd: 2.5 }))
        tracker.reset()
        tracker.onAssistantUsage(U(100, 0, 10, 0))
        expect(reportUsage).toHaveBeenCalledTimes(2)  // reset 后无窗口 → 不上报

        // /clear 后的新 query 重新采集：窗口 + 读数回来（期间已有 assistant → 用它的 usage 报）
        await tracker.collectStartupUsage({ getContextUsage: vi.fn(async () => SUMMARY_WITH_BREAKDOWN(350_000)) } as never)
        expect(reportUsage).toHaveBeenLastCalledWith(expect.objectContaining({
            maxTokens: 350_000, totalTokens: 110, costUsd: 0,
        }))
    })

    it('reset 推进代际：在途旧 turn result 上报被作废（不落进新上下文）', async () => {
        const { tracker, fetchSummary, reportUsage } = makeTracker()
        tracker.onInit('claude-opus-4-8[1m]')
        await seedWindow(tracker, 350_000)
        tracker.onAssistantUsage(U())  // report#1
        let resolveSummary!: (s: SDKControlGetContextUsageResponse) => void
        fetchSummary.mockReturnValue(new Promise(res => { resolveSummary = res }))
        const pending = tracker.onResult(makeResult())
        tracker.reset()
        resolveSummary(SUMMARY_WITH_BREAKDOWN(350_000))
        await pending
        expect(reportUsage).toHaveBeenCalledTimes(1)  // 只有 reset 前的流式上报
    })
})
