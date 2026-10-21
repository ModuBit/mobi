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
 * WarmOnOpenCoordinator（迭代三票 3.3，warm-on-open）：点开休眠（pause）态会话
 * 停留 ≥2s → 防抖触发冷 resume，用户发首条消息时会话已就绪（无感续聊的前半段）。
 *
 * 信号源复用既有 SSE 订阅/可见性通道（/events?sessionId&visibility 与 POST
 * /visibility），不新建通道。判定面：pause 态识别来自票 1.1 落库的 endReason；
 * 预算语义由 spawn 管线单一所有者裁决（intent=prewarm → acquireSlot('warm')），
 * yield 由调用方翻译成 'yielded'——本模块不预占名额、不排队不重试（warm 是
 * 预热不是承诺）；冷 resume 复用休眠唤醒既有管线（syncEngine.reviveSession）。
 */

import { daemonLogger } from '../logger'
import type { Session } from '@mobi/shared/types'
import type { SyncEventListener } from './eventPublisher'

/** 防抖窗口：翻列表的快速滑动不触发（spec 定稿 2s） */
export const WARM_ON_OPEN_DEBOUNCE_MS = 2_000

/** 会话状态投影（SessionCache 行的最小消费面；复用 Session 声明，不另立字段清单） */
export type WarmSessionView = Pick<Session, 'active' | 'endReason'>

export interface WarmOnOpenOptions {
    /** 会话状态查询（pause 态识别：!active && endReason === 'pause'） */
    getSession: (sessionId: string) => WarmSessionView | undefined
    /**
     * 冷 resume（复用休眠唤醒管线）。返回三态中的两态：
     * - 'warmed'：会话已就绪（或本就 active / already-running）
     * - 'yielded'：预算闸到顶，预热放弃（不是失败）
     * 真失败必须 throw。预算判定归 spawn 管线单一所有者，本模块不再预占名额。
     */
    warmSession: (sessionId: string) => Promise<'warmed' | 'yielded'>
    /** 遥测出口 */
    onEvent?: (event: WarmOnOpenEvent) => void
    /** 调度器注入（默认 setTimeout；测试面） */
    schedule?: (fn: () => void, ms: number) => () => void
    /** 时钟（测试注入） */
    now?: () => number
}

/** 遥测事件（结构化日志起步） */
export type WarmOnOpenEvent =
    | { type: 'warm_triggered'; sessionId: string }
    | { type: 'warm_done'; sessionId: string; warmLeadMs: number }
    | { type: 'warm_failed'; sessionId: string }
    | { type: 'warm_yielded'; sessionId: string }
    | { type: 'warm_abandoned'; sessionId: string; abandonedAfterMs: number }

/** 每会话去重状态：debouncing（防抖中）→ warming（执行中）→ 落定离场 */
type WarmState =
    | { phase: 'debouncing'; cancel: () => void }
    | { phase: 'warming' }

export class WarmOnOpenCoordinator {
    private readonly getSession: (sessionId: string) => WarmSessionView | undefined
    private readonly warmSession: (sessionId: string) => Promise<'warmed' | 'yielded'>
    private readonly onEvent: (event: WarmOnOpenEvent) => void
    private readonly schedule: (fn: () => void, ms: number) => () => void
    private readonly now: () => number
    private readonly states = new Map<string, WarmState>()
    /** 热身已兑现但未见用户活动的会话（warmAbandoned 判定面，票 4.2）：warmAt 时间戳 */
    private readonly pendingActivity = new Map<string, number>()

    constructor(options: WarmOnOpenOptions) {
        this.getSession = options.getSession
        this.warmSession = options.warmSession
        this.onEvent = options.onEvent ?? ((event) => { daemonLogger.info(`[WARM-ON-OPEN] ${event.type}`, event) })
        this.schedule = options.schedule ?? ((fn, ms) => {
            const timer = setTimeout(fn, ms)
            return () => { clearTimeout(timer) }
        })
        this.now = options.now ?? Date.now
    }

    /**
     * 会话查看信号入口（SSE 订阅/可见性变化翻译层调用）。
     * visible = 打开且页面可见；hidden = 滑走/切走/退订——防抖中的取消，
     * warming 中的不打断（触发过就让它完成，回来时大概率已就绪）
     */
    onSessionViewed(sessionId: string, visible: boolean): void {
        if (!visible) {
            const state = this.states.get(sessionId)
            if (state?.phase === 'debouncing') {
                state.cancel()
                this.states.delete(sessionId)
            }
            return
        }

        const existing = this.states.get(sessionId)
        if (existing) return // 防抖中/warming 中：去重

        const session = this.getSession(sessionId)
        // 只热身「休眠可唤醒」态：active 不需要，非 pause 终态（stop/archive/delete）不可 resume
        if (!session || session.active || session.endReason !== 'pause') return

        const cancel = this.schedule(() => { void this.fire(sessionId) }, WARM_ON_OPEN_DEBOUNCE_MS)
        this.states.set(sessionId, { phase: 'debouncing', cancel })
    }

    /**
     * 用户活动信号（票 4.2 warmAbandoned 判定面）：warm 兑现后会话收到任何消息
     * （用户发言/投递）即视为热身被使用，解除 abandoned 观察。由 server 装配层
     * 从 syncEngine 事件流喂入
     */
    observeUserActivity(sessionId: string): void {
        this.pendingActivity.delete(sessionId)
    }

    /**
     * 会话再次休眠信号：若热身兑现后始终无用户活动即记 warm_abandoned
     * （预热落空的度量——多次 abandoned 说明该会话形态不适合 warm-on-open）
     */
    observeSessionPaused(sessionId: string): void {
        const warmAt = this.pendingActivity.get(sessionId)
        if (warmAt === undefined) return
        this.pendingActivity.delete(sessionId)
        this.onEvent({ type: 'warm_abandoned', sessionId, abandonedAfterMs: this.now() - warmAt })
    }

    /**
     * 事件源接线（候选④自 server 内联装配收编）：warmAbandoned 判定面的两条信号
     * （用户活动 / 再次休眠）由 coordinator 自己从事件流翻译，装配层只提供订阅函数。
     */
    attachEventSource(subscribe: (listener: SyncEventListener) => () => void): void {
        subscribe((event) => {
            if (event.type === 'message-received') {
                this.observeUserActivity(event.sessionId)
            } else if (event.type === 'session-updated' || event.type === 'session-removed') {
                // 先判是否处于 abandoned 观察窗口：未热身过的会话不必查会话行
                // （getSession 未命中会回落到 DB 读 + 投影）
                if (!this.pendingActivity.has(event.sessionId)) return
                const session = this.getSession(event.sessionId)
                // warm 后再次 pause（休眠）= 热身落空；非 pause 终态/会话删除也解除观察
                if (!session || !session.active) this.observeSessionPaused(event.sessionId)
            }
        })
    }

    private async fire(sessionId: string): Promise<void> {
        const startedAt = this.now()
        this.states.set(sessionId, { phase: 'warming' })
        this.onEvent({ type: 'warm_triggered', sessionId })
        try {
            const outcome = await this.warmSession(sessionId)
            if (outcome === 'yielded') {
                // 预算闸 yield：warm 是预热不是承诺，放弃即止（下次打开重新计防抖）
                this.onEvent({ type: 'warm_yielded', sessionId })
                return
            }
            // 就绪后才置 abandoned 观察位：此前置位会把「到达 active 前的
            // session-updated」误判成再次休眠
            this.onEvent({ type: 'warm_done', sessionId, warmLeadMs: this.now() - startedAt })
            this.pendingActivity.set(sessionId, this.now())
        } catch (error) {
            daemonLogger.warn(`[WARM-ON-OPEN] warm failed (session=${sessionId}): ${error instanceof Error ? error.message : String(error)}`)
            this.onEvent({ type: 'warm_failed', sessionId })
        } finally {
            // done/failed/yielded 都落定离场：失败后下次打开可再触发；done 后 active 判据天然挡住重复
            this.states.delete(sessionId)
        }
    }
}
