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
import { logger } from '@mobi/node-core/logger'
import { calcContextUsageFromAssistant, calcContextUsageFromCompact, calcContextUsageFromResult, hasAssistantUsage, resolveAutoCompactAtTokens, type AssistantUsage } from './utils/contextUsageCalc'
import { extractBreakdown } from './utils/contextBreakdown'

/**
 * 水位（context usage）采集编排模块：收口「什么时候上报、更新哪几块记忆、怎么防乱序、
 * 窗口口径优先级」——此前散落在 claudeRemoteLauncher 的 4 个上报点各自读改共享记忆，
 * 口径调整只能原地逐点对焦（见编排行为测试 contextUsageTracker.test.ts）。
 *
 * interface 只有事件入口 + 注入通道；记忆、代际守卫、窗口优先级全是实现细节。
 * 纯计算（calc/extract）仍在 utils，经 contextUsageCalc.test.ts 单独锁定。
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
     *  clientdata → 模型档位）解析出的窗口大小，**唯一**窗口权威来源（不再按模型名猜测）。
     *  与压缩触发点（autoCompactThreshold，见 lastAutoCompactAtTokens）是两个独立事实——
     *  阈值可能小于窗口（E2E 实测 267k / 300k），环上单独画刻度，勿把两者混为一谈。
     *  0 = 未知（query 未就绪/渠道不支持），此时不产水位读数 */
    lastCcWindowTokens: number
    /** 模型最大窗口（result.modelUsage 主模型 contextWindow）：信息展示（Popover「模型上限」行），
     *  不参与百分比计算；缺字段的 result 不覆写。0 = 未知 */
    lastModelContextTokens: number
    /** 自动压缩触发点（summary.autoCompactThreshold，tokens）：环上刻度标注用。
     *  undefined = 未启用 / 自动推导 / 尚不知晓——环上不画刻度 */
    lastAutoCompactAtTokens: number | undefined
}

/** 水位上报通道（seam）：launcher 注入实现，测试注入 mock */
export type ContextUsageChannels = {
    /** 读：拉取 getContextUsage summary（detail:'summary'，零 API/零 LLM——本地估算）；
     *  query 不在（已关闭）/调用失败 → undefined，调用方按无细分上报 */
    fetchSummary: () => Promise<SDKControlGetContextUsageResponse | undefined>
    /** 写：向 daemon 上报水位 */
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
        lastAutoCompactAtTokens: undefined,
    }
    /** 水位上报代际：compact_boundary（真实水位骤变）与主线 assistant 实时上报（更新读数）各自递增；
     *  onResult 的上报在 fetchSummary await 前后比对，代际变化 = 期间已有更新数据上报
     *  （下轮流式 / compact post_tokens），此刻再发旧 turn 读数会让水位环短暂回退，放弃 */
    private generation = 0
    /**
     * CLI 请求的模型名（system/init.model，与 result.modelUsage key 同源）。
     * 只用于 result.modelUsage 的精确匹配（「模型上限」展示）；网关渠道
     * assistant.message.model 是上游真实名（如 glm-5.3），与 modelUsage key 不同源
     */
    private requestModel: string | undefined

    constructor(private readonly channels: ContextUsageChannels) {}

    /**
     * 上报载荷统一组装：记忆里的可选块（类目细分 / 模型上限 / 压缩触发点）在每个出口
     * 携带规则一致，此前 5 处各手抄一次——新增字段必漏一处（启动抢跑分支漏过 modelContextTokens）。
     * breakdown 由调用方显式传入：各路径语义不同（实时与 result 带记忆细分；compact 后作废；
     * 启动快照只随本次上报、不缓存）。
     */
    private buildUsage(usage: ContextUsage, breakdown?: ContextUsageBreakdown): ContextUsage {
        const payload: ContextUsage = { ...usage }
        if (breakdown) payload.breakdown = breakdown
        if (this.memory.lastModelContextTokens > 0) payload.modelContextTokens = this.memory.lastModelContextTokens
        if (this.memory.lastAutoCompactAtTokens !== undefined) payload.autoCompactAtTokens = this.memory.lastAutoCompactAtTokens
        return payload
    }

    /**
     * 采纳 summary 的记忆块（窗口 / 类目细分 / 压缩触发点）：result 兜底与启动采集共用
     * 同一套守卫与更新顺序，避免下次给 summary 增派记忆字段时只改一边。启动采集早于 MCP
     * 就绪，快照可能缺 MCP 类目，故 cacheBreakdown=false 时只返回、不进记忆（见调用处）。
     */
    private adoptSummary(
        summary: SDKControlGetContextUsageResponse,
        options: { cacheBreakdown: boolean },
    ): ContextUsageBreakdown | undefined {
        if (summary.rawMaxTokens > 0) {
            this.memory.lastMaxTokens = summary.rawMaxTokens
            this.memory.lastCcWindowTokens = summary.rawMaxTokens
        }
        const breakdown = extractBreakdown(summary) ?? undefined
        if (options.cacheBreakdown && breakdown) this.memory.lastBreakdown = breakdown
        // 每次都以最新 summary 为准（含「用户关掉 autocompact」→ 刻度消失）
        this.memory.lastAutoCompactAtTokens = resolveAutoCompactAtTokens(summary)
        return breakdown
    }

    /** system/init 到达：记录 CLI 请求名。init 先于一切 assistant 到达且每次新 query（含 resume）
     *  都重发，模型切换自动更新——requestModel 只用于 result.modelUsage 的精确匹配（展示字段） */
    onInit(model: string | undefined): void {
        if (model) this.requestModel = model
    }

    /** 主线 assistant 到达即实时上报水位（turn 内逐步上涨）；零 usage（渠道不返回）跳过。
     *  窗口只认 summary 的 rawMaxTokens（query 就绪时采集），尚未拿到 → 本轮不上报：
     *  宁可环显示不可用，也不拿猜测窗当分母（猜错会让百分比整个会话失真）。 */
    onAssistantUsage(u: SDKAssistantMessage['message']['usage']): void {
        if (!hasAssistantUsage(u)) return  // 渠道零值/缺失跳过（判据与 calc 同源，勿内联重算）
        this.memory.lastAssistantUsage = u
        if (this.memory.lastMaxTokens === 0) return  // 窗口权威值未到（启动采集在途/不可用）
        const usage = calcContextUsageFromAssistant(u, this.memory.lastMaxTokens, this.memory.lastCostUsd)
        if (!usage) return
        // 实时读数代表当前最新水位，推进代际：作废仍在途的上一轮 result 上报（防乱序回退）
        this.generation++
        // 附带最近一次缓存的类目细分与模型最大窗口：流式期间水位实时上涨，细分随之上报，
        // 否则无 breakdown 的实时上报会把 result 时落的细分整体覆盖掉（Popover 闪烁）
        try {
            this.channels.reportUsage(this.buildUsage(usage, this.memory.lastBreakdown))
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
        // 请求名传入 result 刷新：modelUsage 多模型条目时按请求名精确选中主模型（只用于
        // 「模型上限」展示；窗口分母已是 summary 权威值）。
        // 类目细分 + CC 有效窗口（rawMaxTokens，含用户 autocompact 阈值）+ 压缩触发点先拉取
        // 再参与计算，让本轮 result 的窗口口径即用上最新值（而非滞后一轮）。await 期间代际
        // 变化（下轮流式上报 / compact_boundary 到达）→ 本条旧 turn 读数放弃，此刻再发会让
        // 水位环短暂回退
        const generation = this.generation
        const summary = await this.channels.fetchSummary()
        if (generation !== this.generation) return
        if (summary) this.adoptSummary(summary, { cacheBreakdown: true })
        const r = calcContextUsageFromResult(resultMsg, this.memory.lastAssistantUsage, this.memory.lastMaxTokens, this.memory.lastCostUsd, this.requestModel, this.memory.lastCcWindowTokens)
        if (r.maxTokens > 0) this.memory.lastMaxTokens = r.maxTokens
        if (r.modelContextTokens !== undefined) this.memory.lastModelContextTokens = r.modelContextTokens
        if (r.costUsd !== undefined) this.memory.lastCostUsd = r.costUsd  // 缺字段的 result 不覆写记忆
        if (!r.usage) return  // 无可靠 assistant usage → 保持上一轮读数
        try {
            this.channels.reportUsage(this.buildUsage(r.usage, this.memory.lastBreakdown))
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
            // 模型最大窗口与压缩触发点自记忆附带（compact 上报本体只有总量口径；窗口未变，
            // 两者都不需重取）；压缩前细分已在上面作废
            this.channels.reportUsage(this.buildUsage(usage))
        } catch (e) {
            logger.debug('[remote]: reportContextUsage (compact) failed', e)
        }
    }

    /**
     * query 启动时采集窗口（以及 fresh 会话的首轮前水位）。
     *
     * - 窗口：`rawMaxTokens` 是 CC 权威窗口（含用户 autocompact 阈值），**任何新增 query 都取**
     *   （含 resume）——替代此前按模型名猜测的窗口猜测链；取不到（旧 CLI / 渠道不支持）
     *   就什么都不记，水位环保持不可用，不用猜测值充数
     * - 水位：fresh query 无 response usage，summary 的 totalTokens 回退为类目估算之和
     *   （= 静态基础占用：system prompt + 工具定义 + CLAUDE.md + skills），可安全上报；
     *   resume 时这个基线会把 daemon 已持久化的真实水位覆盖回退，故只取窗口
     *   （reportBaseline=false），等首个 result 再纠偏
     * - 拉取期间已有 result 到达（竞态）则放弃——result 路径的实测值更权威
     */
    async collectStartupUsage(query: Query, options: { reportBaseline?: boolean } = {}): Promise<void> {
        if (!query.getContextUsage) return
        if (this.memory.lastMaxTokens > 0) return
        // 代际快照：await 期间可能 /clear（reset 归零记忆并推进代际）——此时旧 query 的
        // summary 属于上一个上下文，双检（lastMaxTokens 已被归零）会误放行，必须按代际丢弃
        const generation = this.generation
        try {
            const summary = await query.getContextUsage({ detail: 'summary' })
            if (generation !== this.generation) return  // 上下文已重置，旧 query 快照作废
            if (this.memory.lastMaxTokens > 0) return  // 双检：await 期间 result 已到达
            if (summary.rawMaxTokens <= 0) return
            const breakdown = this.adoptSummary(summary, { cacheBreakdown: false })
            if (options.reportBaseline === false) return
            // 拉取期间已有主线 assistant 到达（首轮抢跑）：它的用法比静态基线新，直接按它报，
            // 否则首 turn 的实时水位要等 result 才第一次出现
            const live = this.memory.lastAssistantUsage
                ? calcContextUsageFromAssistant(this.memory.lastAssistantUsage, summary.rawMaxTokens, this.memory.lastCostUsd)
                : null
            // 启动快照不缓存进 lastBreakdown：采样时机注定早于 MCP 就绪（/clear 重启瞬间
            // MCP server 尚未连接完成，CC 类目里没有 MCP tools），缓存会让这份不完整明细
            // 随首 turn 的实时上报持续扩散（总量/明细口径错位），直到首个 result 才自愈。
            // 快照只随本次启动上报发出，首 turn 流式期间实时上报不带明细，result 刷新后恢复
            // 全空响应不产出 0 水位噪声（live 分支有真实 usage，不受此限）
            if (!live && summary.totalTokens <= 0 && !breakdown) return
            this.channels.reportUsage(this.buildUsage(live ?? {
                totalTokens: summary.totalTokens,
                maxTokens: summary.rawMaxTokens,
                percentage: (summary.totalTokens / summary.rawMaxTokens) * 100,
                costUsd: 0,
            }, breakdown))
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
        this.memory.lastAutoCompactAtTokens = undefined
        this.generation++
    }
}
