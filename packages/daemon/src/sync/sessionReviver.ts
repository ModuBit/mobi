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
 * 会话苏醒编排（架构深化候选④）：把「一个 pause 态会话行拉回活跃」从 4 处散落
 * （syncEngine.resumeSession / wakeSession / warmOnOpenCoordinator / server 内联装配）
 * 收成一个模块。
 *
 * 持有：access 校验、唤醒去重、resume 参数组装、already-running 语义、等待 active、
 * mergeSessions 收敛、预算意图（intent → acquireReason）。
 * 不持有：warm 的防抖/遥测（WarmOnOpenCoordinator 是前端信号适配器）、fork 错误落档
 * （engine 领域，经回调注入）、web API 形状（syncEngine 薄转发）。
 *
 * 两个调用来源天然存在（用户动作 / 预热），所以这层缝是真的：
 * - 发消息唤醒、手动恢复 → intent 'activate'（预算语义 user，永不拒绝）
 * - warm-on-open → intent 'prewarm'（预算语义 warm，到顶 yield 放弃）
 */

import type { GovernorAcquireReason } from '../executor/sessionGovernor'
import type { LocalExecutor } from '../executor/localExecutor'
import { daemonLogger } from '../logger'
import type { SessionCache } from './sessionCache'
import type { Session } from '@mobi/shared/types'

/** 苏醒意图：预算分级的唯一来源（③ 的 intent 定型于此，不再走协议字段） */
export type ReviveIntent = 'activate' | 'prewarm'

export type ReviveResult =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string; code: 'session_not_found' | 'access_denied' | 'executor_not_ready' | 'resume_unavailable' | 'resume_failed' | 'governor_yielded' }

/**
 * intent → 预算闸 reason 的单一映射点（候选③）：user 到顶走逐出降级链/兜底放行；
 * warm 到顶 yield（预热不是承诺，绝不逐别人的会话）
 */
const INTENT_TO_ACQUIRE_REASON: Record<ReviveIntent, GovernorAcquireReason> = {
    activate: 'user',
    prewarm: 'warm',
}

/** reviver 消费面（Pick 声明依赖，测试直接喂假件） */
export type SessionReviverDeps = {
    sessionCache: Pick<SessionCache, 'resolveSessionAccess' | 'getSession' | 'refreshSession' | 'mergeSessions'>
    executor: Pick<LocalExecutor, 'spawnSession'>
    /** executor bridge 是否已注入（同进程 spawn 管线就绪） */
    isExecutorReady: () => boolean
    /** 激活失败落档（fork 行 forkError；engine 领域，经回调注入） */
    markActivationError: (sessionId: string, code: string, detail?: string) => void
    /** 等待会话变 active（engine 方法注入，保留测试可打桩面） */
    waitForActive: (sessionId: string, timeoutMs?: number) => Promise<boolean>
    /**
     * CLI socket 此刻是否还挂在会话上（连接事实；唯一构造者 SyncEngine 注入 socket 层
     * 持有者探针）。心跳只说明 30s 内报过活——进程被强杀时 CLI 来不及上报 session-end，
     * 这个窗口里 active 是陈旧事实，靠本探针纠正。
     */
    isCliAttached: (sessionId: string) => boolean
    /** 陈旧 active 的就地纠正（生产注入 SessionCache.markDetached） */
    markDetached: (sessionId: string) => void
}

export class SessionReviver {
    /** 唤醒去重：同一会话只允许一个在途 spawn（短窗口多条消息/预热/手动唤醒共用） */
    private readonly wakeInFlight = new Map<string, Promise<ReviveResult>>()

    constructor(private readonly deps: SessionReviverDeps) {}

    /**
     * 「此刻真能收消息吗」的唯一判据：active 只是心跳推断（30s 窗口），CLI socket
     * 是否还挂在会话上才是连接事实。两者冲突时以连接为准并就地纠正缓存——
     * 否则唤醒会以为「还活着」直接放行，排队消息与补投都永远等不到触发器。
     */
    private isLive(session: Session): boolean {
        if (!session.active) return false
        if (this.deps.isCliAttached(session.id)) return true
        this.deps.markDetached(session.id)
        return false
    }

    /**
     * 休眠会话唤醒（去重 + 自吞异常）：非活跃会话触发 resume spawn。
     *
     * 返回结构化结果而非 void——warm-on-open 需要「就绪/放弃/失败」三态（warm_done /
     * warm_yielded / warm_failed 遥测与 pendingActivity 置位时点）；消息路径可忽略返回值。
     * 异常在内部消化：Bun 下未捕获 rejection 会终止 daemon，而对休眠会话发消息即可触发。
     */
    wake(sessionId: string, opts?: { intent?: ReviveIntent }): Promise<ReviveResult> {
        const inFlight = this.wakeInFlight.get(sessionId)
        if (inFlight) return inFlight

        const pending = this.reviveDeferred(sessionId, opts)
            .finally(() => { this.wakeInFlight.delete(sessionId) })
        this.wakeInFlight.set(sessionId, pending)
        return pending
    }

    private async reviveDeferred(sessionId: string, opts?: { intent?: ReviveIntent }): Promise<ReviveResult> {
        try {
            const session = this.deps.sessionCache.getSession(sessionId) ?? this.deps.sessionCache.refreshSession(sessionId)
            if (!session) {
                return { type: 'error', message: 'Session not found', code: 'session_not_found' }
            }
            if (this.isLive(session)) {
                return { type: 'success', sessionId }
            }
            return await this.revive(sessionId, session.namespace, opts)
        } catch (error) {
            // 会话查找（缓存淘汰后回源 DB）与 revive 的 RPC 层都可能 throw；
            // wake() 的调用方（消息路由）不 await/catch，异常漏出会触发 unhandledRejection 杀 daemon
            const message = error instanceof Error ? error.message : String(error)
            daemonLogger.warn(`[dormancy] wakeSession failed (session=${sessionId}): ${message}`)
            return { type: 'error', message, code: 'resume_failed' }
        }
    }

    /** 同步苏醒（手动恢复/预热兑现）：返回结构化结果，调用方决定反馈 */
    async revive(sessionId: string, namespace: string, opts?: { intent?: ReviveIntent }): Promise<ReviveResult> {
        const access = this.deps.sessionCache.resolveSessionAccess(sessionId, namespace)
        if (!access.ok) {
            return {
                type: 'error',
                message: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found',
                code: access.reason === 'access-denied' ? 'access_denied' : 'session_not_found'
            }
        }

        const session = access.session
        if (this.isLive(session)) {
            return { type: 'success', sessionId: access.sessionId }
        }

        const metadata = session.metadata
        if (!metadata || typeof metadata.path !== 'string') {
            return { type: 'error', message: 'Session metadata missing path', code: 'resume_unavailable' }
        }

        // Mobi 当前仅支持 Claude
        // nativeSessionId 可能为空（会话创建后未发送消息就退出），
        // 此时 fallback 为新会话而非 resume
        const resumeToken = metadata.nativeSessionId

        // 单机世界：executor（同进程 spawn 管线）就绪即可 resume——不再有「挑机器/
        // 匹配 metadata.machineId|host」这一层（machine 概念移除，ticket 201）
        if (!this.deps.isExecutorReady()) {
            // fork 行：executor 未就绪也激活不了——daemon 侧落 forkError 错误态（spec §5.3）
            this.deps.markActivationError(sessionId, 'activation-failed', 'executor not ready')
            return { type: 'error', message: 'Executor not ready', code: 'executor_not_ready' }
        }

        const intent: ReviveIntent = opts?.intent ?? 'activate'
        const spawnOptions = {   // Mobi 当前仅支持 Claude（agent 缺省）；resume 无 sessionType/worktreeName/workspaceId
            // sessionId：本行的查重键——目标行已有活 child（含在途启动中）时 already-running 零等待
            // 返回，恢复交给 CLI 重连 + handleSessionAlive 补投（#108 首条消息唤醒竞态的闸）
            sessionId: access.sessionId,
            // 预算闸来源：intent 映射单源（activate→user 永不拒绝 / prewarm→warm yield）
            acquireReason: INTENT_TO_ACQUIRE_REASON[intent],
            model: session.runtimeState?.model ?? undefined,
            permissionMode: session.permissionMode,
            resumeSessionId: resumeToken,
            effort: session.runtimeState?.effort ?? undefined,
            outputStyle: session.runtimeState?.outputStyle ?? undefined,
        }
        let spawnResult = await this.deps.executor.spawnSession(metadata.path, spawnOptions)

        // 旧进程正在终结（CLI cleanup 先写 lifecycleState=archived 再退出）：此时 already-running
        // 的去重命中不是「重连中」而是「即将退场」，直接返回 success 会让入站消息滞留 queued。
        // 去重表行由 exit 事件清理，短轮询等它退场后重新 spawn（上限 ~10s，超时退回既有语义）。
        if (spawnResult.type === 'already-running' && session.metadata?.lifecycleState === 'archived') {
            for (let i = 0; i < 20 && spawnResult.type === 'already-running'; i++) {
                await new Promise((resolve) => { setTimeout(resolve, 500) })
                spawnResult = await this.deps.executor.spawnSession(metadata.path, spawnOptions)
            }
        }

        if (spawnResult.type === 'already-running') {
            // 唤醒去重（.scratch/wake-dedup）：executor 报告已有活 child 在 resume 该目标，
            // 未 spawn 新进程。旧进程断连中正无限重连（≤5s 间隔），恢复交给其重连 +
            // web 终端 create 重试 / handleSessionAlive 补投收敛——daemon 零等待：不得落到
            // waitForActive，否则断连场景（重连遥遥无期）会干等满 15s
            return { type: 'success', sessionId: access.sessionId }
        }

        if (spawnResult.type === 'governor-yielded') {
            // 预算闸放弃（warm 专属）：不是故障，也不落激活错误档——调用方按「未兑现」处理
            return { type: 'error', message: 'Session capacity reached', code: 'governor_yielded' }
        }

        if (spawnResult.type !== 'success') {
            this.deps.markActivationError(sessionId, 'activation-failed', spawnResult.message)
            return { type: 'error', message: spawnResult.message, code: 'resume_failed' }
        }

        const becameActive = await this.deps.waitForActive(spawnResult.sessionId)
        if (!becameActive) {
            this.deps.markActivationError(sessionId, 'activation-failed', 'session failed to become active')
            return { type: 'error', message: 'Session failed to become active', code: 'resume_failed' }
        }

        if (spawnResult.sessionId !== access.sessionId) {
            try {
                await this.deps.sessionCache.mergeSessions(access.sessionId, spawnResult.sessionId, namespace)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to merge resumed session'
                return { type: 'error', message, code: 'resume_failed' }
            }
        }

        return { type: 'success', sessionId: spawnResult.sessionId }
    }
}
