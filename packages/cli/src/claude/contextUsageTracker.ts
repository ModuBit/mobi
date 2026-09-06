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

import type { ContextUsage, ContextUsageBreakdown } from '@mobi/shared'
import type { SDKAssistantMessage, SDKControlGetContextUsageResponse, SDKResultMessage, Query } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@/ui/logger'
import { calcContextUsageFromAssistant, calcContextUsageFromCompact, calcContextUsageFromResult, hasAssistantUsage, type AssistantUsage } from './utils/contextUsageCalc'
import { guessContextWindow } from './utils/modelContextWindow'
import { extractBreakdown } from './utils/contextBreakdown'

/**
 * 水位（context usage）采集编排模块：收口「什么时候上报、更新哪几块记忆、怎么防乱序、
 * 窗口口径优先级」——此前散落在 claudeRemoteLauncher 的 4 个上报点各自读改共享记忆，
 * 口径调整只能原地逐点对焦（见编排行为测试 contextUsageTracker.test.ts）。
 *
 * interface 只有事件入口 + 注入通道；记忆、代际守卫、窗口优先级全是实现细节。
 * 纯计算（calc/extract/guess）仍在 utils，经 contextUsageCalc.test.ts 单独锁定。
 */

/** 上次真实 turn 的水位记忆（窗口/成本/瞬时 usage/类目细分），上下文重置时整体归零。
 *  集中成对象：多份记忆总是同生共死（上报时一起读、重置时一起清），单值散落会漏 */
export type ContextUsageMemory = {
    lastMaxTokens: number
    lastCostUsd: number
    lastAssistantUsage: AssistantUsage | undefined
    /** 最近一次类目细分（result 时拉取缓存）：实时上报附带，防流式期间细分被无 breakdown 的上报覆盖丢失 */
    lastBreakdown: ContextUsageBreakdown | undefined
    /** CC 有效窗口（getContextUsage summary 的 rawMaxTokens）：经 CC 内部解析链（env → settings →
     *  clientdata → 模型档位），已含用户 autocompact 阈值（如设 350k 时 = 350k，非模型最大 1m）。
     *  水位语义「距压缩还有多少」，此值优先于 modelUsage.contextWindow（模型最大窗口）。
     *  0 = 未知（尚未采集或渠道不支持），回落旧链 */
    lastCcWindowTokens: number
    /** 模型最大窗口（result.modelUsage 主模型 contextWindow）：信息展示（Popover「模型上限」行），
     *  不参与百分比计算；缺字段的 result 不覆写。0 = 未知 */
    lastModelContextTokens: number
}

/** 水位上报通道（seam）：launcher 注入实现，测试注入 mock */
export type ContextUsageChannels = {
    /** 读：拉取 getContextUsage summary（detail:'summary'，零 API/零 LLM——本地估算）；
     *  query 不在（已关闭）/调用失败 → undefined，调用方按无细分上报 */
    fetchSummary: () => Promise<SDKControlGetContextUsageResponse | undefined>
    /** 写：向 hub 上报水位 */
    reportUsage: (usage: ContextUsage) => void
}

export class ContextUsageTracker {
    private memory: ContextUsageMemory = {
        lastMaxTokens: 0,
        lastCostUsd: 0,
        lastAssistantUsage: undefined,
        lastBreakdown: undefined,
        lastCcWindowTokens: 0,
        lastModelContextTokens: 0,
    }
    /** 水位上报代际：compact_boundary（真实水位骤变）与主线 assistant 实时上报（更新读数）各自递增；
     *  onResult 的上报在 fetchSummary await 前后比对，代际变化 = 期间已有更新数据上报
     *  （下轮流式 / compact post_tokens），此刻再发旧 turn 读数会让水位环短暂回退，放弃 */
    private generation = 0
    /**
     * CLI 请求的模型名（system/init.model，与 result.modelUsage key 同源）。
     * 窗口猜测用它而非 assistant.message.model——网关渠道后者是上游真实名
     * （如 glm-5.3），与 modelUsage 按请求名查的窗口知识不同源
     */
    private requestModel: string | undefined

    constructor(private readonly channels: ContextUsageChannels) {}

    /** system/init 到达：记录 CLI 请求名。init 先于一切 assistant 到达且每次新 query（含 resume）
     *  都重发，模型切换自动更新——窗口猜测与 result.modelUsage 同源的模型名 */
    onInit(model: string | undefined): void {
        if (model) this.requestModel = model
    }

    /** 主线 assistant 到达即实时上报水位（turn 内逐步上涨）；零 usage（渠道不返回）跳过 */
    onAssistantUsage(u: SDKAssistantMessage['message']['usage'], model?: string): void {
        if (!hasAssistantUsage(u)) return  // 渠道零值/缺失跳过（判据与 calc 同源，勿内联重算）
        this.memory.lastAssistantUsage = u
        // 窗口未记忆（首 turn / resume 后新进程）→ 按模型名预填猜测值，实时上报立即生效，
        // 不必等第一个 result。注意：猜测仅在 result.modelUsage 携带 contextWindow 时才被
        // 真实值覆盖；渠道不返回该字段时猜测值整个会话生效（已知取舍，pending #57）。
        // 猜测输入优先用 init 的请求名（requestModel）——网关渠道 assistant.message.model
        // 是上游真实名（如 glm-5.3），与 modelUsage 按请求名查的窗口知识不同源，会猜出
        // 与 result 修正值不一致的窗口（实测 [1M] 请求被按上游名猜成 200k）
        if (this.memory.lastMaxTokens === 0) {
            this.memory.lastMaxTokens = guessContextWindow(this.requestModel ?? model) ?? 0
        }
        if (this.memory.lastMaxTokens === 0) return  // 模型名也缺失的极端情况，等 result 兜底
        const usage = calcContextUsageFromAssistant(u, this.memory.lastMaxTokens, this.memory.lastCostUsd)
        if (!usage) return
        // 实时读数代表当前最新水位，推进代际：作废仍在途的上一轮 result 上报（防乱序回退）
        this.generation++
        // 附带最近一次缓存的类目细分与模型最大窗口：流式期间水位实时上涨，细分随之上报，
        // 否则无 breakdown 的实时上报会把 result 时落的细分整体覆盖掉（Popover 闪烁）
        const breakdown = this.memory.lastBreakdown
        const modelContextTokens = this.memory.lastModelContextTokens
        try {
            this.channels.reportUsage({
                ...usage,
                ...(breakdown ? { breakdown } : {}),
                ...(modelContextTokens > 0 ? { modelContextTokens } : {}),
            })
        } catch (e) { logger.debug('[remote]: reportContextUsage (assistant) failed', e) }
    }

    /** 非 compact result 的 turn 兜底上报；compact result 只回填累计成本 */
    async onResult(resultMsg: SDKResultMessage, isCompact = false): Promise<void> {
        // compact 的 result：用量已由 compact_boundary 的 post_tokens 上报，此处只回填累计成本
        // （compact 自身的 total_cost_usd），避免连续 /compact 期间 lastCostUsd 冻结
        if (isCompact) {
            this.memory.lastCostUsd = resultMsg.total_cost_usd ?? this.memory.lastCostUsd
            return
        }
        // 请求名传入 result 刷新：modelUsage 多模型条目时按请求名精确选中主模型，
        // 不靠「inputTokens 最大」启发式（子代理流量大的 turn 会误选，见 calcContextUsageFromResult）。
        // 类目细分 + CC 有效窗口（rawMaxTokens，含用户 autocompact 阈值）先拉取再参与计算，
        // 让本轮 result 的窗口口径即用上最新值（而非滞后一轮）。await 期间代际变化（下轮流式
        // 上报 / compact_boundary 到达）→ 本条旧 turn 读数放弃，此刻再发会让水位环短暂回退
        const generation = this.generation
        const summary = await this.channels.fetchSummary()
        if (generation !== this.generation) return
        if (summary) {
            if (summary.rawMaxTokens > 0) this.memory.lastCcWindowTokens = summary.rawMaxTokens
            const breakdown = extractBreakdown(summary) ?? undefined
            if (breakdown) this.memory.lastBreakdown = breakdown
        }
        const r = calcContextUsageFromResult(resultMsg, this.memory.lastAssistantUsage, this.memory.lastMaxTokens, this.memory.lastCostUsd, this.requestModel, this.memory.lastCcWindowTokens)
        if (r.maxTokens > 0) this.memory.lastMaxTokens = r.maxTokens
        if (r.modelContextTokens !== undefined) this.memory.lastModelContextTokens = r.modelContextTokens
        if (r.costUsd !== undefined) this.memory.lastCostUsd = r.costUsd  // 缺字段的 result 不覆写记忆
        if (!r.usage) return  // 无可靠 assistant usage → 保持上一轮读数
        try {
            this.channels.reportUsage({
                ...r.usage,
                ...(this.memory.lastBreakdown ? { breakdown: this.memory.lastBreakdown } : {}),
                ...(this.memory.lastModelContextTokens > 0 ? { modelContextTokens: this.memory.lastModelContextTokens } : {}),
            })
        } catch (e) {
            logger.debug('[remote]: reportContextUsage failed', e)
        }
    }

    /** compact_boundary（压缩成功终态）：用 post_tokens 反映压缩后真实占用，复用上次记忆的
     *  窗口大小与成本。组装逻辑见 calcContextUsageFromCompact（纯函数） */
    onCompactBoundary(postTokens: number | undefined): void {
        // 压缩后类目结构骤变（messages 大幅缩小），压缩前缓存的细分已失真——作废，
        // 防后续实时上报继续附带 pre-compact 细分与已变小的 totalTokens 同屏矛盾
        this.memory.lastBreakdown = undefined
        // 代际推进：作废 fetchSummary await 期间的旧 turn result 上报（读数已由 post_tokens 代表）
        this.generation++
        const usage = calcContextUsageFromCompact(postTokens, this.memory.lastMaxTokens, this.memory.lastCostUsd)
        if (!usage) return
        try {
            // 模型最大窗口自记忆附带（compact 上报本体只有总量口径）
            this.channels.reportUsage({
                ...usage,
                ...(this.memory.lastModelContextTokens > 0 ? { modelContextTokens: this.memory.lastModelContextTokens } : {}),
            })
        } catch (e) {
            logger.debug('[remote]: reportContextUsage (compact) failed', e)
        }
    }

    /**
     * query 启动时采集首轮前水位：fresh query 无 response usage，summary 的 totalTokens
     * 回退为类目估算之和（= 静态基础占用：system prompt + 工具定义 + CLAUDE.md + skills），
     * rawMaxTokens 是 CC 权威窗口（替代 guessContextWindow 的 [1m] 正则猜测优先级）。
     * 仅在尚无窗口记忆时上报（lastMaxTokens===0 = 本会话还没有 result）；拉取期间已有
     * result 到达（竞态）则放弃——result 路径的实测值更权威。
     * resume 会话由调用方跳过：hub 已持久化真实水位/成本（web 首拉恢复），
     * 静态基线 totalTokens + costUsd 0 会把真实读数覆盖回退到首个 result 才自愈
     */
    async collectStartupUsage(query: Query): Promise<void> {
        if (!query.getContextUsage) return
        if (this.memory.lastMaxTokens > 0) return
        try {
            const summary = await query.getContextUsage({ detail: 'summary' })
            if (this.memory.lastMaxTokens > 0) return  // 双检：await 期间 result 已到达
            const rawMax = summary.rawMaxTokens > 0
                ? summary.rawMaxTokens
                : guessContextWindow(summary.model) ?? 0
            if (rawMax <= 0) return
            this.memory.lastMaxTokens = rawMax
            this.memory.lastCcWindowTokens = summary.rawMaxTokens > 0 ? summary.rawMaxTokens : 0
            const breakdown = extractBreakdown(summary) ?? undefined
            if (breakdown) this.memory.lastBreakdown = breakdown
            if (summary.totalTokens <= 0 && !breakdown) return  // 全空响应不产出 0 水位噪声
            this.channels.reportUsage({
                totalTokens: summary.totalTokens,
                maxTokens: rawMax,
                percentage: (summary.totalTokens / rawMax) * 100,
                costUsd: 0,
                ...(breakdown ? { breakdown } : {}),
            })
        } catch (e) {
            logger.debug('[remote]: startup getContextUsage failed', e)
        }
    }

    /** 上下文重置（/clear 与 output style 切换共用，经 applyContextReset 收口）：
     *  记忆整体归零（记忆不清会把上个会话的累计成本带给下个 compact_boundary）+
     *  代际推进（在途旧 turn 上报不落进新上下文）。请求名不清——新 query 的 init 会重发覆盖 */
    reset(): void {
        this.memory.lastMaxTokens = 0
        this.memory.lastCostUsd = 0
        this.memory.lastAssistantUsage = undefined
        this.memory.lastBreakdown = undefined
        this.memory.lastCcWindowTokens = 0
        this.memory.lastModelContextTokens = 0
        this.generation++
    }
}
