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
 * （syncEngine.reviveSession / warmOnOpenCoordinator / server 内联装配）
 * 收成一个模块。
 *
 * 持有：access 校验、唤醒去重、resume 参数组装、already-running 语义、等待 active、
 * mergeSessions 收敛、预算意图（intent → acquireReason）。
 * 不持有：warm 的防抖/遥测（WarmOnOpenCoordinator 是前端信号适配器）、fork 错误落档
 * （engine 领域，经回调注入）、web API 形状（syncEngine 薄转发）。
 *
 * 单入口：所有苏醒路径（手动恢复 / 发消息唤醒 / 预热）都走 `revive()`，共用一个在途闸。
 * 2026-10-21 双进程事故：web 对分叉显式 resume 与消息路由的唤醒同时到达，而 resume 走
 * 无闸的旧 revive、唤醒走有闸的旧 wake，两把锁各管各的 → 同一 native id 被拉起两个进程，
 * 互相抢 socket 造成 running 闪烁。
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
 * 苏醒入口参数：
 * - namespace 有值 → 校验会话归属（web 路由；未知 id 与越权 id 分别报 404/403）
 * - namespace 缺省 → 服务端内部调用（预热等），按 id 直接查
 * - intent 缺省 = activate
 */
export type ReviveOptions = {
    namespace?: string
    intent?: ReviveIntent
}

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
     * 这个窗口里 active 是陈旧事实：唤醒必须再问一次连接，不能只信 active。
     */
    isCliAttached: (sessionId: string) => boolean
    /**
     * 补投仍 queued 的消息（CLI 附着时已触发一次）。resume 的 CLI 可能以新 id 上线，
     * 归并把旧 id 下的排队消息搬到新 id；附着补投发生在这之前（socket 连接早于 webhook
     * 归并），搬过来的消息就再也没有触发器——归并后必须再触发一次。
     */
    redeliverQueued: (sessionId: string) => void
}

/** 在途恢复表行：intent 用于「用户操作不得并入预热」的升级判定 */
type InFlightRevive = {
    intent: ReviveIntent
    promise: Promise<ReviveResult>
}

/** 会话解析结果：命中错误时携带可直接返回的结构化结果 */
type ResolvedSession =
    | { ok: true; session: Session; targetId: string }
    | { ok: false; result: ReviveResult }

export class SessionReviver {
    /**
     * 在途恢复闸：同一会话只允许一个 spawn 编排。手动恢复（`POST /resume`）、发消息唤醒、
     * warm-on-open 共用这一把——2026-10-21 之前 awake 各有各的闸，两条路径同时到达会
     * 各自 spawn 一个进程（executor 查重是 check-then-act，窗口内拦不住）。
     */
    private readonly inFlight = new Map<string, InFlightRevive>()

    constructor(private readonly deps: SessionReviverDeps) {}

    /**
     * 唯一的苏醒入口。返回结构化结果；**永不 reject**——消息路由 fire-and-forget 调用，
     * Bun 下未捕获 rejection 会终止 daemon，异常统一消化为 `resume_failed`。
     *
     * 在途去重 + 意图升级：
     * - 同 intent（或新来的是 prewarm）→ 复用在途 Promise
     * - 在途 prewarm、新来 activate → 另起一次（预热到顶会被 governor yield，用户操作
     *   不能继承这个结果）；已起的进程由 executor 同步预约拦成 already-running 零等待
     */
    revive(sessionId: string, opts: ReviveOptions = {}): Promise<ReviveResult> {
        const intent: ReviveIntent = opts.intent ?? 'activate'
        const existing = this.inFlight.get(sessionId)
        if (existing && !(existing.intent === 'prewarm' && intent === 'activate')) {
            // 并入在途条目同样要回答「这次调用能不能碰这个会话」：reviveInner 的归属校验
            // 只跑了**发起方**那一次，而发起方常常是内部预热/唤醒（无 namespace）。
            // 并入方带 namespace 时自己补一次，否则 access_denied 在这条路径上永远不返回
            const denial = this.accessDenial(sessionId, opts.namespace)
            return denial ? Promise.resolve(denial) : existing.promise
        }

        const entry: InFlightRevive = {
            intent,
            promise: this.reviveInner(sessionId, { ...opts, intent }),
        }
        this.inFlight.set(sessionId, entry)
        // 落定即释放（成败都放：失败不粘住去重，下次可重试）；升级场景下旧 entry 的
        // 回调不得删掉新 entry，故按引用比对
        const settle = () => {
            if (this.inFlight.get(sessionId) === entry) this.inFlight.delete(sessionId)
        }
        void entry.promise.then(settle, settle)
        return entry.promise
    }

    /**
     * 并入在途条目时的归属校验：只在调用方带 namespace 时做，通过返回 null。
     * 判据与 reviveInner 完全一致（同一个 resolveSession），区别只是不消费解析出的
     * session/targetId——并入方要的只是「能否访问」这个答案。
     */
    private accessDenial(sessionId: string, namespace?: string): ReviveResult | null {
        if (namespace === undefined) return null
        try {
            const resolved = this.resolveSession(sessionId, namespace)
            return resolved.ok ? null : resolved.result
        } catch (error) {
            // 与 reviveInner 同一契约：本入口永不 reject
            const message = error instanceof Error ? error.message : String(error)
            daemonLogger.warn(`[dormancy] reviveSession access check failed (session=${sessionId}): ${message}`)
            return { type: 'error', message, code: 'resume_failed' }
        }
    }

    private async reviveInner(sessionId: string, opts: ReviveOptions & { intent: ReviveIntent }): Promise<ReviveResult> {
        try {
            const resolved = this.resolveSession(sessionId, opts.namespace)
            if (!resolved.ok) return resolved.result
            const { session, targetId } = resolved
            if (this.isLive(session)) {
                return { type: 'success', sessionId: targetId }
            }
            return await this.spawnRevived(session, targetId, opts.intent)
        } catch (error) {
            // 会话查找（缓存淘汰后回源 DB）与 spawn/merge 的 RPC 层都可能 throw；
            // 调用方（消息路由）不 await/catch，异常漏出会触发 unhandledRejection 杀 daemon
            const message = error instanceof Error ? error.message : String(error)
            daemonLogger.warn(`[dormancy] reviveSession failed (session=${sessionId}): ${message}`)
            return { type: 'error', message, code: 'resume_failed' }
        }
    }

    /**
     * 「此刻真能收消息吗」的判据：active 是心跳推断（30s 窗口），CLI socket 是否还挂在
     * 会话上才是连接事实。两者冲突时按「未附着」处理、让唤醒继续走 spawn——同 session
     * 已有活进程时 spawnDedup 会 already-running 零等待返回，消息等重连后由附着补投。
     *
     * 这里**不改缓存**：socket 脱落也可能只是瞬时断线（Wi-Fi 切换/ping 超时），按死亡纠正
     * 会把 running 一并清掉并广播 active:false，UI 闪成不活跃；真正的死亡由心跳过期
     * （expireInactive → markDetached）收口，读路径只读不写。
     */
    private isLive(session: Session): boolean {
        if (!session.active) return false
        return this.deps.isCliAttached(session.id)
    }

    /** 查会话（有 namespace 才做归属校验）；错误语义与旧两入口保持一致 */
    private resolveSession(sessionId: string, namespace?: string): ResolvedSession {
        if (namespace !== undefined) {
            const access = this.deps.sessionCache.resolveSessionAccess(sessionId, namespace)
            if (!access.ok) {
                return {
                    ok: false,
                    result: {
                        type: 'error',
                        message: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found',
                        code: access.reason === 'access-denied' ? 'access_denied' : 'session_not_found',
                    },
                }
            }
            return { ok: true, session: access.session, targetId: access.sessionId }
        }

        const session = this.deps.sessionCache.getSession(sessionId) ?? this.deps.sessionCache.refreshSession(sessionId)
        if (!session) {
            return { ok: false, result: { type: 'error', message: 'Session not found', code: 'session_not_found' } }
        }
        return { ok: true, session, targetId: sessionId }
    }

    /** 真正拉起进程：spawn → 等上线 → 新 id 归并 + 补投 */
    private async spawnRevived(session: Session, sessionId: string, intent: ReviveIntent): Promise<ReviveResult> {
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

        const spawnOptions = {   // Mobi 当前仅支持 Claude（agent 缺省）；resume 无 sessionType/worktreeName/workspaceId
            // sessionId：本行的查重键——目标行已有活 child（含在途启动中）时 already-running 零等待
            // 返回，恢复交给 CLI 重连 + 附着补投（onCliAttached，见 handleCliAttached）
            sessionId,
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
            // 附着补投（onCliAttached）收敛——daemon 零等待：不得落到
            // waitForActive，否则断连场景（重连遥遥无期）会干等满 15s
            return { type: 'success', sessionId }
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

        if (spawnResult.sessionId !== sessionId) {
            try {
                await this.deps.sessionCache.mergeSessions(sessionId, spawnResult.sessionId, session.namespace)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to merge resumed session'
                return { type: 'error', message, code: 'resume_failed' }
            }
            // 归并把旧 id 下仍 queued 的消息搬到新 id，而附着补投（onCliAttached）先于归并
            // 发生——搬过来的消息否则永久滞留，直到用户再发一条（2026-10-21 merge 竞态）
            this.deps.redeliverQueued(spawnResult.sessionId)
        }

        return { type: 'success', sessionId: spawnResult.sessionId }
    }
}
