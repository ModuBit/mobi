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

import React from "react";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Session } from "./session";
import { RemoteModeDisplay } from "@/ui/ink/RemoteModeDisplay";
import { claudeRemote, commandLifecycleToFact, isReplayUserMessage, type TurnTrackingState } from "./claudeRemote";
import { classifyInboundTurn } from './utils/inboundCrossSession';
import { parseSpecialCommand } from "@/parsers/specialCommands";
import { PermissionHandler } from "./utils/permissionHandler";
import { Future } from "@/utils/future";
import type { PromptPayload } from "@/utils/promptBuilder";
import type { SDKAssistantMessage, SDKMessage, SDKResultMessage, SDKSystemMessage, SDKUserMessage, Query } from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { formatClaudeMessageForInk } from "@/ui/messageFormatterInk";
import { logger } from "@/ui/logger";
import { SDKToLogConverter } from "./utils/sdkToLogConverter";
import { calcContextUsageFromAssistant, calcContextUsageFromCompact, calcContextUsageFromResult, hasAssistantUsage } from "./utils/contextUsageCalc";
import { applyContextReset, type ContextUsageMemory } from "./utils/contextReset";
import { guessContextWindow } from "./utils/modelContextWindow";
import { EnhancedMode, type QueryControlRef } from "./types";
import { OutgoingMessageQueue } from "./utils/OutgoingMessageQueue";
import type { RawJSONLines } from "./types";
import { createSessionScanner, readSessionLog } from "./utils/sessionScanner";
import { createNativeAttachReporter } from "./utils/nativeAttachReporter";
import { REWIND_EXIT_SENTINEL } from "./utils/rewindSentinel";
import { OUTPUT_STYLE_EXIT_SENTINEL } from "./utils/outputStyleSentinel";
import { reportRewindCompletion } from "./utils/rewindReport";
import { handleRewindRefusal } from "./utils/rewindRefusal";
import { GoalStatusHandler } from "./goalStatusHandler";
import { getProjectPath } from "./utils/path";
import { discoverCapabilities } from "./utils/capabilityDiscovery";
import { classifyMessage, extractLiveBackgroundTaskIds, isAbortedTerminalReason, isCancelQueued, shouldStopTasks, type StopKind } from '@mobi/shared';
import {
    resolveStopAction,
    resolvePostInterruptAction,
    applyPushToTurnTracking,
    stopBackgroundTasksAllSettled,
} from './utils/stopAction';
import type { ClaudePermissionMode } from "@mobi/shared/types";
import {
    RemoteLauncherBase,
    type RemoteLauncherDisplayContext,
    type RemoteLauncherExitReason
} from "@/modules/common/remote/RemoteLauncherBase";

interface PermissionsField {
    date: number;
    result: 'approved' | 'denied';
    mode?: ClaudePermissionMode;
    allowedTools?: string[];
}

class ClaudeRemoteLauncher extends RemoteLauncherBase {
    private readonly session: Session;
    private readonly processCleanupRef?: { current: (() => void) | null };
    private readonly queryControlRef?: QueryControlRef;
    private readonly getSessionConfig: () => EnhancedMode;
    private readonly flushConfig: () => void;
    private abortController: AbortController | null = null;
    private abortFuture: Future<void> | null = null;
    private permissionHandler: PermissionHandler | null = null;
    private handleSessionFound: ((sessionId: string) => void) | null = null;
    // SDK Query 引用，用于 interrupt/close 控制
    private queryRef: Query | null = null;
    // steer sink：由 claudeRemote 启动循环时注入，把 steer 消息 payload push 进 SDK input stream
    // （payload 可为数组 content block——队列消息可能是带图片的 PromptPayload）
    private steerSink: ((payload: PromptPayload, localId?: string) => boolean) | null = null;
    // 上次真实 turn 的窗口/成本/瞬时 usage 记忆，供实时水位与 compact_boundary 上报复用
    // （compact_boundary 消息不带 contextWindow 与 costUsd，只能复用上次记忆）。
    // 三份记忆同生共死（上报一起读、上下文重置一起清），故集中为对象经 applyContextReset 整体归零。
    // 初值 0 = 窗口未知：主线 assistant 到达时按模型名猜（guessContextWindow）预填，
    // result.modelUsage 到达后始终为权威真实值
    private contextMemory: ContextUsageMemory = {
        lastMaxTokens: 0,
        lastCostUsd: 0,
        lastAssistantUsage: undefined,
    }
    /**
     * CLI 请求的模型名（system/init.model，与 result.modelUsage key 同源）。
     * 窗口猜测用它而非 assistant.message.model——网关渠道后者是上游真实名
     * （如 glm-5.3），与 modelUsage 按请求名查的窗口知识不同源（见 reportAssistantUsage）
     */
    private lastRequestModel: string | undefined
    /** turn 追踪（批次 A 撤回）：均为单值标量（D10）。hasOutput 由 sdkOutputLoop 回调置位、
     *  result 到达复位；lastPushedNativeId 在 push 用户消息时覆盖记录（丢失只降级不误删） */
    private turnTracking: TurnTrackingState = { hasOutput: false, lastPushedNativeId: null }
    /** 存活的后台任务 id（批次 A『全部停止』档的 stopTask 遍历源）。来源：background_tasks_changed
     *  系统消息（sdk.d.ts 明确 REPLACE 语义——每次整体换掉集合，勿增量合并；query 轮结束清空）。
     *  SDK 未提供任务列表查询 API（backgroundTasks() 是「后台化前台任务」开关，返回 boolean），只能自维护 */
    private backgroundTaskIds: ReadonlySet<string> = new Set<string>()
    /** 待注入到下一条中断 result 的停止信息（emitAbortedEvent 的落点，见该方法的注释） */
    private pendingAbortInfo: { stopKind: StopKind; stillQueuedCount: number } | null = null
    /** nextMessage 是否持有被暂存的待投递批次（mode 变更/isolate 时 stash）。
     *  暂存批次不在 MessageQueue 里但下轮必投——撤回初判把它视同「队列非空」 */
    private pendingBatchHeld = false
    /** 撤回生效后待拦的死亡回执：撤回后本 turn 的第一条中断 result 不转发 hub（E2E 残留缺陷
     *  修复——否则该 result 以更大 seq 落库，web 仍渲染「Session aborted」灰行）。消费即清除 */
    private suppressNextInterruptedResult = false
    /** 已做过能力发现的去重键（nativeSessionId；resume 首轮 sessionId 未回写时为 '__pending__' 哨兵）——
     *  onQueryReady 每轮触发，per-session 去重防重复拉取与乱序覆写（批次 G F3/New-1）。
     *  语义对齐 launch 循环的 isNewSession 检测：resume 出新 native session（compact 切换等）会变，rewind 截断轮不变 */
    private capabilityDiscoveredForSession: string | null = null;

    constructor(
        session: Session,
        processCleanupRef?: { current: (() => void) | null },
        queryControlRef?: QueryControlRef,
        getSessionConfig: () => EnhancedMode = () => ({ permissionMode: 'default' }),
        flushConfig: () => void = () => {},
    ) {
        super(process.env.DEBUG ? session.logPath : undefined);
        this.session = session;
        this.processCleanupRef = processCleanupRef;
        this.queryControlRef = queryControlRef;
        this.getSessionConfig = getSessionConfig;
        this.flushConfig = flushConfig;
    }

    protected createDisplay(context: RemoteLauncherDisplayContext): React.ReactElement {
        return React.createElement(RemoteModeDisplay, context);
    }

    private async abort(): Promise<void> {
        if (this.abortController && !this.abortController.signal.aborted) {
            this.abortController.abort();
        }
        await this.abortFuture?.promise;
    }

    /**
     * 停止请求三档分派（批次 A）：
     * - turn：只中断当前 turn（队列照跑、后台任务存活）
     * - turn-queue：中断 + cancel_queued（CC 层排队消息取消，经 lifecycle 帧回流终态）
     * - turn-queue-tasks：再遍历停止全部运行中的后台任务
     * stopKind='turn' 且本 turn 无任何模型输出时走撤回两段式：interrupt 返回后复验，
     * 仍无输出则撤回最后 push 的用户消息（withdrawn fact），并抑制 aborted 灰行注入（spec D6/§5.2）。
     */
    private async handleAbortRequest(stopKind: StopKind): Promise<void> {
        logger.debug(`[remote]: doAbort stopKind=${stopKind}`)
        if (!this.queryRef) {
            await this.abort()   // Query 未创建：现状不变
            return
        }
        if (shouldStopTasks(stopKind)) await this.stopAllBackgroundTasks()

        // interrupt 签名滞后：sdk.mjs 实现 interrupt(e) 支持 { cancelQueued: true } 并返回
        // { still_queued, cancelled? }；上游补类型后删断言（spec §5.5）
        const interruptWithOpts = this.queryRef.interrupt.bind(this.queryRef) as
            (opts?: { cancelQueued?: boolean }) => Promise<{ still_queued?: string[] } | undefined>
        // 撤回锚在 await interrupt() 之前快照：窗口内新消息被消费成新 turn 会覆盖
        // lastPushedNativeId 并复位 hasOutput——复验时锚已变化即降级普通停止（queue-drain 竞态守卫）
        const withdrawAnchor = this.turnTracking.lastPushedNativeId
        const receipt = await interruptWithOpts(isCancelQueued(stopKind) ? { cancelQueued: true } : undefined)

        if (stopKind !== 'turn') {
            // 非 'turn' 档如实回传 still_queued：cancelQueued 未生效（旧二进制/取消失败）时
            // 残留队列数是对账信息，硬编码 0 会把异常伪装成「已清空」（I3）
            this.emitAbortedEvent(stopKind, receipt?.still_queued?.length ?? 0)
            return
        }

        const action = resolveStopAction({
            turnHasOutput: this.turnTracking.hasOutput,
            pumpQueueEmpty: this.isPumpQueueEmpty(),
            hasLastPushed: this.turnTracking.lastPushedNativeId !== null,
        })
        if (action === 'withdraw' && this.turnTracking.lastPushedNativeId) {
            // 复验：await interrupt() 返回即 abort 处理完成。守卫裁决收口在
            // resolvePostInterruptAction（C1 修法 2 / I1 独立防线）——回执仍列排队消息
            // （cancelQueued 未带或未生效，撤回目标还会执行）、窗口期冒出输出、
            // 或撤回锚已被新 turn 的 push 覆盖 → 降级普通停止
            const stillQueuedCount = receipt?.still_queued?.length ?? 0
            if (resolvePostInterruptAction({
                turnHasOutput: this.turnTracking.hasOutput,
                stillQueuedCount,
                anchorChanged: this.turnTracking.lastPushedNativeId !== withdrawAnchor,
            }) === 'stop') {
                this.emitAbortedEvent('turn', stillQueuedCount)
                return
            }
            this.session.client.emitWithdrawnFact(this.turnTracking.lastPushedNativeId)
            this.turnTracking.lastPushedNativeId = null
            // 撤回生效：拦下本 turn 即将到达的中断 result（死亡回执），不转发 hub/落库——
            // hub 已按撤回锚软删除，回执再落库会以更大 seq 复活为灰行（spec §5.2）
            this.suppressNextInterruptedResult = true
            return                                       // 撤回路径抑制 aborted event（spec D6/§5.2）
        }
        this.emitAbortedEvent('turn', receipt?.still_queued?.length ?? 0)
    }

    /** 遍历停止运行中的后台任务（'turn-queue-tasks' 档；单个失败不中断）。
     *  并行 allSettled：总延迟从 N×RTT 降为最慢单个；失败逐个 warn（保失败日志） */
    private async stopAllBackgroundTasks(): Promise<void> {
        const failures = await stopBackgroundTasksAllSettled(
            this.backgroundTaskIds,
            (taskId) => {
                const query = this.queryRef
                if (!query) return Promise.resolve()
                return query.stopTask(taskId)
            },
        )
        for (const { taskId, error } of failures) {
            logger.warn('[remote]: stopTask failed', taskId, error)
        }
    }

    /** gated pump 队列是否为空：MessageQueue 无待消费项，且 nextMessage 未持有暂存批次。
     *  撤回初判用——非空说明停止后还有消息会跑，不能撤回 */
    private isPumpQueueEmpty(): boolean {
        return this.session.queue.size() === 0 && !this.pendingBatchHeld
    }

    /**
     * 标记本次停止的中断灰行变体信息（aborted event「发射」）。
     * web 的 aborted 灰行由 result 消息 terminal_reason 推导（normalizeAgent.handleResultOutput），
     * CLI 无独立 aborted 事件——「发射」= 给下一条经过的中断 result 注入 stopKind/stillQueuedCount
     * （消费点在 onMessage 的 result 分支）；撤回路径不调用本方法即「抑制」（spec D6/§5.2）。
     * sdk.d.ts 保证 interrupt 回执先于被中断 turn 的 result 写出，正常时序下注入必命中。
     */
    private emitAbortedEvent(stopKind: StopKind, stillQueuedCount: number): void {
        this.pendingAbortInfo = { stopKind, stillQueuedCount }
    }

    private async handleSwitchRequest(): Promise<void> {
        logger.debug('[remote]: doSwitch');
        await this.requestExit('switch', async () => {
            this.queryRef?.close();
            this.queryRef = null;
            await this.abort();
        });
    }

    private async handleExitFromUi(): Promise<void> {
        logger.debug('[remote]: Exiting client via Ctrl-C');
        await this.requestExit('exit', async () => {
            this.queryRef?.close();
            this.queryRef = null;
            await this.abort();
        });
    }

    private async handleSwitchFromUi(): Promise<void> {
        logger.debug('[remote]: Switching to local mode via double space');
        await this.handleSwitchRequest();
    }

    /**
     * result 到达时刷新窗口/成本记忆（这两个值只在 result 消息），并用本 turn 最后一条
     * 主线 assistant 的 usage 兜底上报一次（与实时上报同值，覆盖无害；首 turn 必经此路径）。
     * 组装逻辑见 calcContextUsageFromResult（纯函数）。
     * compact / 中断已在 claudeRemote 层过滤（不到此）。记忆 maxTokens/costUsd 供 compact 复用。
     */
    private handleContextUsage(resultMsg: SDKResultMessage, isCompact: boolean): void {
        // 非 compact result 到达即 turn 正常收尾：复位输出观测并作废撤回锚（撤回复验判据，批次 A §5.3）。
        // 撤回窗口只存在于「消息已 push、turn 未完成」期间——turn 正常完成后消息已被处理，
        // 不再可撤（否则闲置时点停止会误删已完成对话）。中断（aborted_*）result 不经过此回调
        // （claudeRemote 层过滤）——撤回复验读的正是「被中断 turn 是否产出过输出」，
        // 此处提前复位会造成误判（复验永远看到 false）
        this.turnTracking.hasOutput = false
        this.turnTracking.lastPushedNativeId = null
        // compact 的 result：用量已由 compact_boundary 的 post_tokens 上报，此处只回填累计成本
        // （compact 自身的 total_cost_usd），避免连续 /compact 期间 lastCostUsd 冻结
        if (isCompact) {
            this.contextMemory.lastCostUsd = resultMsg.total_cost_usd ?? this.contextMemory.lastCostUsd
            return
        }
        // 请求名传入 result 刷新：modelUsage 多模型条目时按请求名精确选中主模型，
        // 不靠「inputTokens 最大」启发式（子代理流量大的 turn 会误选，见 calcContextUsageFromResult）
        const r = calcContextUsageFromResult(resultMsg, this.contextMemory.lastAssistantUsage, this.contextMemory.lastMaxTokens, this.contextMemory.lastCostUsd, this.lastRequestModel)
        if (r.maxTokens > 0) this.contextMemory.lastMaxTokens = r.maxTokens
        if (r.costUsd !== undefined) this.contextMemory.lastCostUsd = r.costUsd  // 缺字段的 result 不覆写记忆
        if (!r.usage) return  // 无可靠 assistant usage → 保持上一轮读数
        try {
            this.session.client.reportContextUsage(r.usage)
        } catch (e) {
            logger.debug('[remote]: reportContextUsage failed', e)
        }
    }

    /**
     * 上下文用量上报（compact_boundary）：用 post_tokens 反映压缩后真实占用，复用上次记忆的
     * 窗口大小与成本。组装逻辑见 calcContextUsageFromCompact（纯函数）。
     */
    private handleCompactBoundary(postTokens: number | undefined): void {
        const usage = calcContextUsageFromCompact(postTokens, this.contextMemory.lastMaxTokens, this.contextMemory.lastCostUsd)
        if (!usage) return
        try {
            this.session.client.reportContextUsage(usage)
        } catch (e) {
            logger.debug('[remote]: reportContextUsage (compact) failed', e)
        }
    }

    public async launch(): Promise<RemoteLauncherExitReason> {
        return this.start({
            onExit: () => this.handleExitFromUi(),
            onSwitchToLocal: () => this.handleSwitchFromUi()
        });
    }

    protected async runMainLoop(): Promise<void> {
        logger.debug('[claudeRemoteLauncher] Starting remote launcher');
        logger.debug(`[claudeRemoteLauncher] TTY available: ${this.hasTTY}`);

        const session = this.session;
        const messageBuffer = this.messageBuffer;

        this.setupAbortHandlers(session.client.rpcHandlerManager, {
            onAbort: (stopKind) => this.handleAbortRequest(stopKind),
            onSwitch: () => this.handleSwitchRequest()
        });

        // goal 状态处理器：scanner 提取 goal_status attachment 后双发(RPC + goal_progress 消息)
        const goalHandler = new GoalStatusHandler(
            session.client,
            (m) => session.client.sendClaudeSessionMessage(m),
        );
        // attach 上报：native session id 变化（首启/新会话 /clear /compact fork）时通知 Hub
        // 批量补写该会话缺 nativeSessionId 的消息行（rewind 判据的数据源）
        const reportNativeAttach = createNativeAttachReporter(
            (nativeSessionId) => session.client.emitNativeAttached(nativeSessionId)
        );
        // scanner 只启动一次(首次 onSessionFound)；后续 session 切换走 onNewSession
        let scanner: Awaited<ReturnType<typeof createSessionScanner>> | null = null;
        // pending promise 跟踪：防止 start() 完成前的重复启动竞争 + cleanup 时序问题
        let scannerPromise: Promise<Awaited<ReturnType<typeof createSessionScanner>>> | null = null;

        // 启动恢复：读 transcript 最后一条 goal_status，仅恢复未达成的 active goal
        const restoreGoalStatus = async (sessionId: string) => {
            try {
                const file = join(getProjectPath(session.path), `${sessionId}.jsonl`);
                const { goalStatuses } = await readSessionLog(file, 0);
                const last = goalStatuses[goalStatuses.length - 1];
                if (last && !last.met) {
                    // 仅恢复未达成的 active goal；met:true 不恢复(已达成,等下次 active)
                    // 用 restore(只 RPC)而非 handle(双发)——恢复时不发 goal_progress 聊天消息，
                    // 避免每次重连/会话切换都往历史注入一条合成消息
                    goalHandler.restore(last);
                }
            } catch (e) {
                logger.debug('[remote]: restoreGoalStatus failed', e);
            }
        };

        // 注册 stop-task RPC 处理器，用于远程停止后台任务
        session.client.rpcHandlerManager.registerHandler('stop-task', async (params) => {
            const { taskId } = params as { taskId: string }
            if (this.queryRef) {
                await this.queryRef.stopTask(taskId)
            }
        });

        // 取消排队消息（web → hub → cli 两阶段取消的 CLI 侧）
        // CLI 是「是否仍可安全取消」的权威：in-flight（已 collectBatch/steal，即将喂 agent）→ 不可取消，
        // 否则会产生幽灵消息。tryCancel 区分 in-flight / 仍在队列 / CLI 未知三种。
        session.client.rpcHandlerManager.registerHandler('cancel-queued-message', async (params) => {
            const { localId } = (params ?? {}) as { localId?: string }
            if (!localId) return { status: 'submitted' }
            return { status: session.queue.tryCancel(localId) }
        });

        // steer 排队消息（web → hub → cli）：把仍排队的消息从内存队列取出，
        // 立即 push 进 SDK input stream，由 Claude Code 在内部安全点处理。
        // 设计权衡：steer 绕过 MessageQueue 的 modeHash 一致性检查与 collectBatch 的 pending 重启机制，
        // 消息以「当前运行 Query 的配置」被处理，而非入队时的配置。若用户排队后改了 model/permissionMode，
        // steer 消息不会触发 Query 重启——这是为「即时性」刻意取舍（mode 重启走正常 collectBatch 路径）。
        session.client.rpcHandlerManager.registerHandler('steer-queued-message', async (params) => {
            const { localId } = (params ?? {}) as { localId?: string }
            if (!localId) return { status: 'submitted' }

            // 特殊命令（!bash / /clear / /compact）不 steal：steer 会把文本直接 push 进 SDK
            // input stream 绕过 claudeRemote 正常泵的 handleSpecialCommand（!bash 会被 SDK 当
            // 普通消息用自己的 Bash 工具执行，/clear /compact 也失效）。用 peek（不移除）探测，
            // 命中则留队列走正常泵（executeBash/onClear/isCompact）——保留消息原始 isolate 标志
            // 与位置，避免 steal 后 pushBack 丢 isolate（/clear 由 pushIsolateAndClear 入队）
            // 并被 collectBatch 重排序合并进相邻同 mode 消息。
            const peeked = session.queue.peekByLocalId(localId)
            // 特殊命令只可能是 string 形态 payload（数组恒为普通消息），非 string 直接放行 steal
            if (peeked && typeof peeked.message === 'string' && parseSpecialCommand(peeked.message).type) {
                return { status: 'submitted' }
            }

            const stolen = session.queue.stealByLocalId(localId)
            if (!stolen) return { status: 'submitted' }

            // push 失败的统一回填：消息已从队列移除，若 SDK input stream 未就绪或已关闭，
            // 必须放回队列，否则消息丢失（DB 行 lifecycle 停留 queued 但 agent 永远收不到）
            const pushBack = () => session.queue.push(stolen.message, stolen.mode, localId)

            if (!this.steerSink) {
                // query 未就绪：放回队列，保持排队态
                pushBack()
                return { status: 'submitted' }
            }
            let ok: boolean
            try {
                ok = this.steerSink(stolen.message, localId)
            } catch (e) {
                // SDK input stream 已 end（mode 切换重启/turn 间隙旧循环已结束）→ push 抛错，回填保命
                logger.debug('[remote]: steer push failed, restoring queue', e)
                ok = false
            }
            if (!ok) {
                pushBack()
                return { status: 'submitted' }
            }
            // push 成功 → 立即通知 Hub 已提交（与 collectBatch 同路径）
            session.client.emitMessagesSubmitted([localId])
            return { status: 'steered' }
        });

        const permissionHandler = new PermissionHandler(session, {
            // mode 变更时通知运行中 SDK Query 动态切换 permissionMode（见 permissionHandler 说明）
            onApplyPermissionMode: (mode) => this.queryControlRef?.current?.setPermissionMode(mode),
        });
        this.permissionHandler = permissionHandler;

        const messageQueue = new OutgoingMessageQueue<RawJSONLines>(
            (logMessage) => session.client.sendClaudeSessionMessage(logMessage)
        );

        permissionHandler.setOnPermissionRequest((toolCallId: string) => {
            messageQueue.releaseToolCall(toolCallId);
        });

        const sdkToLogConverter = new SDKToLogConverter({
            sessionId: session.sessionId || 'unknown',
            cwd: session.path,
            version: process.env.npm_package_version
        }, permissionHandler.getResponses());

        const handleSessionFound = (sessionId: string) => {
            sdkToLogConverter.updateSessionId(sessionId);
        };
        this.handleSessionFound = handleSessionFound;
        session.addSessionFoundCallback(handleSessionFound);

        // 跟踪 enter_plan_mode 工具调用，成功后同步 permissionMode 为 plan
        // （exit_plan_mode 批准已改为 allow + query.setPermissionMode 直切，
        //  无需再拦截伪造 tool_result，见 permissionHandler exit_plan_mode 分支）
        const enterPlanModeToolCalls = new Set<string>();
        // 跟踪所有正在执行中的工具调用，记录 parentToolCallId 用于处理嵌套工具调用场景
        // 工具开始执行时添加，收到 tool_result 时移除
        const ongoingToolCalls = new Map<string, { parentToolCallId: string | null }>();

        // 主线 assistant 到达即实时上报水位（turn 内逐步上涨）；零 usage（渠道不返回）跳过。
        const reportAssistantUsage = (u: SDKAssistantMessage['message']['usage'], model?: string) => {
            if (!hasAssistantUsage(u)) return  // 渠道零值/缺失跳过（判据与 calc 同源，勿内联重算）
            this.contextMemory.lastAssistantUsage = u
            // 窗口未记忆（首 turn / resume 后新进程）→ 按模型名预填猜测值，实时上报立即生效，
            // 不必等第一个 result。注意：猜测仅在 result.modelUsage 携带 contextWindow 时才被
            // 真实值覆盖；渠道不返回该字段时猜测值整个会话生效（已知取舍，pending #57）。
            // 猜测输入优先用 init 的请求名（lastRequestModel）——网关渠道 assistant.message.model
            // 是上游真实名（如 glm-5.3），与 modelUsage 按请求名查的窗口知识不同源，会猜出
            // 与 result 修正值不一致的窗口（实测 [1M] 请求被按上游名猜成 200k）
            if (this.contextMemory.lastMaxTokens === 0) {
                this.contextMemory.lastMaxTokens = guessContextWindow(this.lastRequestModel ?? model) ?? 0
            }
            if (this.contextMemory.lastMaxTokens === 0) return  // 模型名也缺失的极端情况，等 result 兜底
            const usage = calcContextUsageFromAssistant(u, this.contextMemory.lastMaxTokens, this.contextMemory.lastCostUsd)
            if (!usage) return
            try { session.client.reportContextUsage(usage) } catch (e) { logger.debug('[remote]: reportContextUsage (assistant) failed', e) }
        }

        // 记录 CLI 请求名（箭头捕获 this，供 onMessage 内调用）。
        // init 先于一切 assistant 到达且每次新 query（含 resume）都重发，模型切换自动更新；
        // 窗口猜测与 result.modelUsage 同源的模型名
        const rememberRequestModel = (msg: SDKMessage) => {
            if (msg.type === 'system' && (msg as SDKSystemMessage).subtype === 'init') {
                const requestModel = (msg as SDKSystemMessage).model
                if (requestModel) this.lastRequestModel = requestModel
            }
        }

        const onMessage = (message: SDKMessage): void => {
            // 重置空闲计时器（Agent 输出）
            session.client.resetIdleTimer();

            // 拦截 isReplay 回显：CC 接收确认信号，不 convert、不落库，转 ack 上报
            // （nativeAckAt 数据源）。回显 uuid = 当初 push 时预设的 nativeId，故按 uuid 回填。
            if (isReplayUserMessage(message)) {
                session.client.emitMessagesAcked(message.uuid)
                return
            }

            // 拦截 command_lifecycle 帧：CC 排队消息生命周期回执。控制帧不 convert 不落库
            //（classifyMessage discard 兜底），只取信号转 lifecycle fact 上报 Hub。
            // command_uuid = push 时预设的 nativeId，Hub 按 nativeId 反查推进
            const lifecycleSignal = commandLifecycleToFact(message)
            if (lifecycleSignal) {
                session.client.emitLifecycleFact(
                    lifecycleSignal.nativeId,
                    lifecycleSignal.state,
                    undefined,
                    lifecycleSignal.terminalReason,
                )
                return
            }

            // 后台任务存活集合（批次 A『全部停止』档的遍历源）：level 信号整体替换（REPLACE 语义，
            // 见 SDKBackgroundTasksChangedMessage——勿做增量合并）。不 early-return，保持既有落库行为。
            // SDKSystemMessage 联合尚未收录该 subtype（SDK 0.3.251），走开放形状断言
            if (message.type === 'system' && (message as unknown as { subtype?: string }).subtype === 'background_tasks_changed') {
                this.backgroundTaskIds = collectLiveTaskIds((message as unknown as { tasks?: unknown }).tasks)
            }

            formatClaudeMessageForInk(message, messageBuffer);
            permissionHandler.onMessage(message);

            // 记录 CLI 请求名（实现见 rememberRequestModel 注释）
            rememberRequestModel(message)

            if (message.type === 'assistant') {
                const usageMsg = message as SDKAssistantMessage;
                // 主线 assistant（子代理 parent_tool_use_id 非空，其 usage 是独立子上下文不作水位）；
                // 有效性判据（渠道零值跳过）统一在 reportAssistantUsage 内的 hasAssistantUsage
                if (!usageMsg.parent_tool_use_id && usageMsg.message?.usage) {
                    reportAssistantUsage(usageMsg.message.usage, usageMsg.message.model);
                }
                const umessage = message as SDKAssistantMessage;
                if (umessage.message.content && Array.isArray(umessage.message.content)) {
                    for (const c of umessage.message.content) {
                        if (c.type === 'tool_use') {
                            logger.debug('[remote]: detected tool use ' + c.id! + ' parent: ' + umessage.parent_tool_use_id);
                            ongoingToolCalls.set(c.id!, { parentToolCallId: umessage.parent_tool_use_id ?? null });
                            if (c.name === 'enter_plan_mode' || c.name === 'EnterPlanMode') {
                                logger.debug('[remote]: detected enter plan mode tool call ' + c.id!);
                                enterPlanModeToolCalls.add(c.id! as string);
                            }
                        }
                    }
                }
            }
            if (message.type === 'user') {
                const umessage = message as SDKUserMessage;
                if (umessage.message.content && Array.isArray(umessage.message.content)) {
                    for (const c of umessage.message.content) {
                        if (c.type === 'tool_result' && c.tool_use_id) {
                            ongoingToolCalls.delete(c.tool_use_id);
                            messageQueue.releaseToolCall(c.tool_use_id);
                        }
                    }
                }
            }

            let msg = message;

            if (message.type === 'user') {
                const umessage = message as SDKUserMessage;
                if (umessage.message.content && Array.isArray(umessage.message.content)) {
                    msg = {
                        ...umessage,
                        message: {
                            ...umessage.message,
                            content: umessage.message.content.map((c: ContentBlockParam): ContentBlockParam => {
                                if (c.type === 'tool_result' && c.tool_use_id && enterPlanModeToolCalls.has(c.tool_use_id)) {
                                    enterPlanModeToolCalls.delete(c.tool_use_id);
                                    if (!c.is_error) {
                                        logger.debug('[remote]: enter plan mode succeeded, syncing permissionMode');
                                        permissionHandler.handleModeChange('plan');
                                    }
                                    return c;
                                }
                                return c;
                            })
                        }
                    };
                }
            }

            const logMessage = sdkToLogConverter.convert(msg);
            if (logMessage) {
                // 过滤 discard 类消息，不发送到 Hub
                if (classifyMessage(logMessage.type, (logMessage as { subtype?: string }).subtype) === 'discard') {
                    return
                }

                // 中断 result 处理（emitAbortedEvent 的消费点，见 pendingAbortInfo 注释）。
                // 正常/compact result 到达即作废待注入信息与撤回抑制标志（跨 turn 陈旧防护）。
                // RawJSONLines 无 'result' discriminant（见 sdkToLogConverter case 'result'），走开放形状断言
                if ((logMessage as { type?: string }).type === 'result') {
                    const reason = (logMessage as { terminal_reason?: unknown }).terminal_reason
                    if (isAbortedTerminalReason(reason)) {
                        // 撤回后本 turn 的死亡回执：只拦第一条（标志消费即清），跳过 hub 转发/落库。
                        // 内层已收窄为中断 result，是否跳过退化为标志直查（原 helper 恒真内联）；
                        // 内部消费照旧（上方 Ink/权限/记忆已走完）；后续新 turn 的 result 正常转发
                        if (this.suppressNextInterruptedResult) {
                            this.suppressNextInterruptedResult = false
                            return
                        }
                        if (this.pendingAbortInfo) {
                            const target = logMessage as unknown as Record<string, unknown>
                            target.stopKind = this.pendingAbortInfo.stopKind
                            target.stillQueuedCount = this.pendingAbortInfo.stillQueuedCount
                            this.pendingAbortInfo = null
                        }
                    } else {
                        this.pendingAbortInfo = null
                        this.suppressNextInterruptedResult = false
                    }
                }

                if (logMessage.type === 'user' && logMessage.message?.content) {
                    const content = Array.isArray(logMessage.message.content)
                        ? logMessage.message.content
                        : [];

                    for (let i = 0; i < content.length; i++) {
                        const c = content[i];
                        if (c.type === 'tool_result' && c.tool_use_id) {
                            const responses = permissionHandler.getResponses();
                            const response = responses.get(c.tool_use_id);

                            if (response) {
                                const permissions: PermissionsField = {
                                    date: response.receivedAt || Date.now(),
                                    result: response.approved ? 'approved' : 'denied'
                                };

                                if (response.mode) {
                                    permissions.mode = response.mode;
                                }

                                if (response.allowTools && response.allowTools.length > 0) {
                                    permissions.allowedTools = response.allowTools;
                                }

                                content[i] = {
                                    ...c,
                                    permissions
                                };
                            }
                        }
                    }
                }

                if (logMessage.type === 'assistant' && message.type === 'assistant') {
                    const assistantMsg = message as SDKAssistantMessage;
                    const toolCallIds: string[] = [];

                    if (assistantMsg.message.content && Array.isArray(assistantMsg.message.content)) {
                        for (const block of assistantMsg.message.content) {
                            if (block.type === 'tool_use' && block.id) {
                                toolCallIds.push(block.id);
                            }
                        }
                    }

                    if (toolCallIds.length > 0) {
                        const isSidechain = assistantMsg.parent_tool_use_id !== undefined;

                        if (!isSidechain) {
                            messageQueue.enqueue(logMessage, {
                                delay: 250,
                                toolCallIds
                            });
                            return;
                        }
                    }
                }

                messageQueue.enqueue(logMessage);
            }
        };

        // 入站跨会话消息落库（spec 2026-08-28 ②）：hook 观测 → 甄别 → user 消息落库。
        // 回调由 SDK hook 同步触发，任何异常就地吞掉——观测失败退化为现状（消息不落库），
        // 绝不影响会话主流程。
        const handleInboundPrompt = (input: { prompt: string; source?: string }) => {
            try {
                const turn = classifyInboundTurn(input);
                if (turn) {
                    session.client.sendInboundCrossSessionMessage(turn.text, turn.kind, turn.fromName, randomUUID());
                }
            } catch (e) {
                logger.debug('[remote]: inbound cross-session prompt handling failed', e);
            }
        };

        try {
            // 暂存待下轮重启会话再投递的完整批次（mode 变更/isolate 时存入，恢复时原样返回）
            let pending: Awaited<ReturnType<typeof session.queue.waitForMessagesAndGetAsString>> = null;

            let previousSessionId: string | null = null;
            while (!this.exitReason) {
                logger.debug('[remote]: launch');
                messageBuffer.addMessage('═'.repeat(40), 'status');

                // rewind：rewind RPC 受理后经哨兵退出了上一轮 query，pendingRewind 已置位。
                // SDK 的截断由下面 claudeRemote 的 startup 预热承载（resumeSessionAt 加载到
                // 锚点即截断，不再走空跑轮）。两段回报经 onRewindTruncated 回调移到 startup
                // 截断后——对齐设计文档「先 CLI 截断成功，再 Hub 软删除（CLI 失败则 Hub 不动）」，
                // 截断失败由下方 catch 补发 completed { error }。rewind 局部变量保留 resumeAt 供传参。
                const rewind = session.pendingRewind;
                if (rewind) {
                    messageBuffer.addMessage(`Rewinding session to anchor ${rewind.resumeAt.slice(0, 8)}...`, 'status');
                }

                const isNewSession = session.sessionId !== previousSessionId;
                if (isNewSession) {
                    messageBuffer.addMessage('Starting new Claude session...', 'status');
                    permissionHandler.reset();
                    sdkToLogConverter.resetParentChain();
                    logger.debug(`[remote]: New session detected (previous: ${previousSessionId}, current: ${session.sessionId})`);
                } else {
                    messageBuffer.addMessage('Continuing Claude session...', 'status');
                    logger.debug(`[remote]: Continuing existing session: ${session.sessionId}`);
                }

                previousSessionId = session.sessionId;
                const controller = new AbortController();
                this.abortController = controller;
                this.abortFuture = new Future<void>();
                let modeHash: string | null = null;
                try {
                    await claudeRemote({
                        sessionId: session.sessionId,
                        // rewind 截断轮携带保留锚（其前最近一条 assistant entry uuid）：
                        // 语义是「加载到该条（含）为止」，锚点用户消息及其后全部丢弃
                        resumeSessionAt: rewind?.resumeAt,
                        // output style：session 当前值，每轮循环读取（切换 RPC 更新后经哨兵重启生效）
                        outputStyle: session.getOutputStyle(),
                        // 配对护栏（spec E1）：丢弃的 turn prompt UUID（= rewind 目标 user msg nativeId），
                        // SDK fork 时校验截断区间只含该 turn；含其他则 refusal（refusal 处理在 T4）
                        resumeDropsTurn: rewind?.nativeId,
                        // startup 截断完成后回报（先截断后软删除），并清 pendingRewind。
                        // 先清再回报：截断已完成即标记收尾，后续 query 失败不算截断失败
                        onRewindTruncated: rewind ? async () => {
                            session.pendingRewind = null;
                            await reportRewindCompletion(session.client, rewind);
                        } : undefined,
                        onRewindRefusal: rewind ? async (msg: string) => {
                            handleRewindRefusal({
                                pendingRewind: session.pendingRewind,
                                // 路径 B 回退：onRewindTruncated 已清空 session.pendingRewind，
                                // 但 rewind 局部变量仍持有受理阶段的真实 filesRestored/skippedLinks
                                fallbackRewindData: {
                                    filesRestored: rewind.filesRestored,
                                    skippedLinks: rewind.skippedLinks,
                                },
                                clearPendingRewind: () => { session.pendingRewind = null },
                                emitRewindCompleted: (filesRestored, error, skippedLinks) =>
                                    session.client.emitRewindCompleted(filesRestored, error, skippedLinks),
                                sendSessionEvent: (event) =>
                                    session.client.sendSessionEvent(event),
                            }, msg)
                        } : undefined,
                        path: session.path,
                        allowedTools: session.allowedTools ?? [],
                        mcpServers: session.mcpServers,
                        hookSettingsPath: session.hookSettingsPath,
                        getSessionConfig: this.getSessionConfig,
                        flushConfig: this.flushConfig,
                        canCallTool: permissionHandler.handleToolCall,
                        onElicitation: permissionHandler.handleElicitation,
                        onInboundPrompt: handleInboundPrompt,
                        onQueryReady: (query) => {
                            this.queryRef = query;
                            // 暴露给外部用于动态 setModel/setPermissionMode
                            if (this.queryControlRef) {
                                this.queryControlRef.current = query;
                            }
                            // 修复配置漂移：将预热期间积累的配置变更同步到 Query
                            this.flushConfig();
                            if (this.processCleanupRef) {
                                this.processCleanupRef.current = () => {
                                    query.close();
                                    this.queryRef = null;
                                    if (this.queryControlRef) {
                                        this.queryControlRef.current = null;
                                    }
                                };
                            }
                            // U-27：会话能力面经三方法落 metadata（替代 extractSDKMetadataAsync
                            // 专用 headless 进程）。异步不阻塞 turn；失败静默保旧值（spec 批次 G）。
                            // per-session 去重：onQueryReady 每轮触发，同一会话只发现一次。
                            // resume 首轮 sessionId 尚未回写（--resume 分支跳过 pregeneration 的
                            // 同步 onSessionFound，真实 id 在 init 后异步到达）——以 pending 哨兵
                            // 先发现一次，真实 id 就绪的下轮再刷新并此后去重
                            const discoveryKey = session.sessionId ?? '__pending__';
                            if (discoveryKey !== this.capabilityDiscoveredForSession) {
                                this.capabilityDiscoveredForSession = discoveryKey;
                                void discoverCapabilities(query, (caps) => {
                                    session.client.updateMetadata((metadata) => ({
                                        ...metadata,
                                        sdkMetadata: caps,
                                    }));
                                });
                            }
                        },
                        nextMessage: async () => {
                            if (pending) {
                                const p = pending;
                                pending = null;
                                this.pendingBatchHeld = false;
                                return p;
                            }

                            for (;;) {
                                const msg = await session.queue.waitForMessagesAndGetAsString(controller.signal);
                                if (!msg) return null;

                                // 重置空闲计时器（用户发送消息）
                                session.client.resetIdleTimer();

                                // 退出哨兵（rewind / output style 切换）：识别后不暂存 pending、
                                // 不推送 SDK（NUL 前缀串作为 prompt 会污染会话）。退轮门控按哨兵
                                // 种类读「实时」session 状态——局部 rewind 是轮起快照，截断轮中已被
                                // onRewindTruncated 清空，不能作判据：
                                // - rewind 哨兵：session.pendingRewind 非空（常规轮的新 rewind / 截断轮
                                //   中抵达的第二次 rewind）→ return null 结束本轮，launcher 下轮循环
                                //   读到 pendingRewind 后以 resumeSessionAt 截断重启
                                // - output style 哨兵：session.pendingOutputStyleExit 置位（切换 RPC
                                //   受理时写入）→ return null 结束本轮并清位，下轮循环以新 style 经
                                //   applyStartupOutputStyle 重启
                                // - 门控均不满足：本轮已执行后的残留哨兵（RPC 落在 query 轮间隙时
                                //   入队）→ 丢弃，继续等下一条用户消息，避免误触发本轮早退
                                if (msg.isolate && (msg.message === REWIND_EXIT_SENTINEL || msg.message === OUTPUT_STYLE_EXIT_SENTINEL)) {
                                    const gateRewind = msg.message === REWIND_EXIT_SENTINEL && session.pendingRewind !== null;
                                    const gateOutputStyle = msg.message === OUTPUT_STYLE_EXIT_SENTINEL && session.pendingOutputStyleExit;
                                    if (gateRewind || gateOutputStyle) {
                                        if (gateOutputStyle) {
                                            session.pendingOutputStyleExit = false;
                                            // /clear 语义对齐：切换同为清空上下文重启，重启前发
                                            // 边界事件（web 渲染「已重置」分隔线）+ 清水位 + 归零
                                            // 记忆——此前只有 /clear 路径做，切换后水位残留旧值
                                            applyContextReset(session.client, this.contextMemory);
                                        }
                                        logger.debug(`[remote]: exit sentinel received (${msg.message}), ending current query round`);
                                        return null;
                                    }
                                    logger.debug(`[remote]: stale exit sentinel (${msg.message}) dropped, keep waiting for user message`);
                                    continue;
                                }

                                if ((modeHash && msg.hash !== modeHash) || msg.isolate) {
                                    logger.debug('[remote]: mode has changed, pending message');
                                    pending = msg;
                                    this.pendingBatchHeld = true;
                                    return null;
                                }
                                modeHash = msg.hash;
                                return {
                                    message: msg.message,
                                    mode: msg.mode,
                                    localIds: msg.localIds,
                                };
                            }
                        },
                        onSessionFound: (sessionId) => {
                            session.onSessionFound(sessionId);
                            // attach：native session 变化（首启/新会话/compact 切换）→ Hub 补写空缺行
                            reportNativeAttach(sessionId);
                            if (!scannerPromise) {
                                // 首次：启动 scanner(只传 onAttachmentStatus,不传 onMessage——
                                // remote 模式 SDK 消息流已送聊天消息,scanner 送消息会重复)
                                scannerPromise = createSessionScanner({
                                    sessionId,
                                    workingDirectory: session.path,
                                    onAttachmentStatus: (status) => goalHandler.handle(status),
                                });
                                scannerPromise
                                    .then((s) => { scanner = s; restoreGoalStatus(sessionId); })
                                    .catch((e) => { scannerPromise = null; logger.debug('[remote]: scanner start failed', e); });
                            } else if (scanner) {
                                // 后续 session 切换(fork/compact)：切监听文件 + 恢复 goal 状态
                                scanner.onNewSession(sessionId);
                                restoreGoalStatus(sessionId);
                            }
                        },
                        onRunningChange: session.onRunningChange,
                        claudeEnvVars: session.claudeEnvVars,
                        claudeArgs: session.claudeArgs,
                        additionalDirectories: session.additionalDirectories,
                        onMessage,
                        onCompletionEvent: (message: string) => {
                            logger.debug(`[remote]: Completion event: ${message}`);
                            session.client.sendSessionEvent({ type: 'message', message });
                        },
                        onCompactCompleted: () => {
                            logger.debug('[remote]: Compaction completed');
                            session.client.sendSessionEvent({ type: 'compact-completed' });
                        },
                        onContextCleared: () => {
                            logger.debug('[remote]: Context cleared');
                            // /clear 语义收口：边界事件 + 清水位 + 归零记忆（与 output style 切换共用）
                            applyContextReset(session.client, this.contextMemory);
                        },
                        onContextUsage: (resultMsg, isCompact) => {
                            this.handleContextUsage(resultMsg, isCompact);
                        },
                        onCompactBoundary: (postTokens) => {
                            this.handleCompactBoundary(postTokens);
                        },
                        onSessionReset: () => {
                            logger.debug('[remote]: Session reset');
                            session.clearSessionId();
                        },
                        onReady: () => {
                            if (!pending && session.queue.size() === 0) {
                                session.client.sendSessionEvent({ type: 'ready' });
                            }
                        },
                        onSnapshot: (msg) => {
                            session.client.sendContentSnapshot(msg);
                        },
                        getConverter: () => sdkToLogConverter,
                        // 流式期间 abort/中断时，把已累积但 full 未到的内容补全落库。
                        // 经 messageQueue 入队（非直接 send）：让 messageQueue 统一仲裁顺序——abort 时
                        // messageQueue 可能含 delay 中的上一条 assistant（tool_use 未配对 result），补全按 FIFO
                        // 入队其后，由本 launch finally 的 messageQueue.flush() 统一发送，保证
                        // 「上一条 tool_use → 当前补全」的正确时序。前端 resolveMessageCache 按 message.id
                        // 清理 snapshot + 追加补全 full，刷新后内容仍在。
                        onAbortFlush: (pending) => {
                            try {
                                const raw = sdkToLogConverter.convertSnapshot(pending.blocks, {
                                    model: pending.model,
                                    parentToolUseId: pending.parentToolUseId,
                                    messageId: pending.messageId,
                                });
                                messageQueue.enqueue(raw);
                            } catch (e) {
                                logger.warn('[remote]: onAbortFlush failed', e);
                            }
                        },
                        onSteerSinkReady: (push) => { this.steerSink = push },
                        // 用户消息 push 给 SDK 后上报 (localId → nativeId) 绑定（rewind 锚点）。
                        // push 时若 native session id 已知（非首条）直接带上，省去 attach 补写往返。
                        // 同时是 turn 追踪的 push 接线点（批次 A）：更新策略收口在
                        // applyPushToTurnTracking（纯函数，C1 修法 1）——新 turn 的 push 复位
                        // hasOutput 并覆盖撤回锚；steer push 只覆盖锚、不复位 hasOutput
                        //（turn 运行中的插队不该抹掉「已产出输出」的事实）
                        onMessagesBound: (bindings, origin) => {
                            const last = bindings[bindings.length - 1]
                            if (last) {
                                this.turnTracking = applyPushToTurnTracking(
                                    this.turnTracking,
                                    last.nativeId,
                                    origin ?? 'turn',
                                )
                            }
                            session.client.emitMessagesBound(bindings, session.sessionId ?? undefined)
                        },
                        // 撤回复验判据：本 turn 有任何模型输出即置位（见 TurnTrackingState）
                        onTurnOutput: () => { this.turnTracking.hasOutput = true },
                    });

                    session.consumeOneTimeFlags();

                    if (!this.exitReason && controller.signal.aborted) {
                        session.client.sendSessionEvent({ type: 'message', message: 'Aborted by user' });
                    }
                } catch (e) {
                    // 截断失败（claudeRemote 抛错）：补发 completed { error } 而不发 truncated——
                    // 对齐设计文档「CLI 失败则 Hub 不动」：Hub 不软删除，Web 收到 error 终态解锁
                    // 并 toast 原因。文件回滚结果 filesRestored 在 RPC 阶段已确定（先于截断），如实携带。
                    if (rewind && session.pendingRewind === rewind) {
                        session.client.emitRewindCompleted(
                            rewind.filesRestored,
                            `rewind truncation failed: ${e instanceof Error ? e.message : String(e)}`,
                            rewind.skippedLinks,
                        );
                        session.pendingRewind = null;
                    }
                    // 增强错误日志：序列化非标准错误对象
                    // 用 error 级而非 debug：SDK 崩溃错误（含 stderr tail，见 getProcessExitError）
                    // 需始终落盘以便事后从日志排查。debug 在生产模式只进 ringBuffer、不落盘，
                    // 而此处错误被优雅捕获（不崩溃）→ ringBuffer 永不 dump → 日志文件空白。
                    const errorDetail = e instanceof Error
                        ? `${e.name}: ${e.message}\n${e.stack?.substring(0, 500)}`
                        : `Non-Error thrown: type=${typeof e}, value=${JSON.stringify(e)}, keys=${typeof e === 'object' && e !== null ? Object.keys(e).join(',') : 'N/A'}`;
                    logger.error(`[remote]: launch error: ${errorDetail}`);
                    if (!this.exitReason) {
                        session.client.sendSessionEvent({ type: 'message', message: `Process exited unexpectedly: ${e instanceof Error ? e.message : String(e)}` });
                        // claude 进程崩溃，退出 session 避免僵尸进程
                        this.exitReason = 'exit';
                    }
                } finally {
                    logger.debug('[remote]: launch finally');

                    for (const [toolCallId, { parentToolCallId }] of ongoingToolCalls) {
                        const converted = sdkToLogConverter.generateInterruptedToolResult(toolCallId, parentToolCallId);
                        if (converted) {
                            logger.debug('[remote]: terminating tool call ' + toolCallId + ' parent: ' + parentToolCallId);
                            session.client.sendClaudeSessionMessage(converted);
                        }
                    }
                    ongoingToolCalls.clear();

                    logger.debug('[remote]: flushing message queue');
                    await messageQueue.flush();
                    messageQueue.destroy();
                    logger.debug('[remote]: message queue flushed');

                    this.abortController = null;
                    this.abortFuture?.resolve(undefined);
                    this.abortFuture = null;
                    this.queryRef = null;
                    // 清空 steer sink：旧 SDK input stream 已 end，避免下一轮 claudeRemote 注入新 sink 前
                    // 命中 stale sink 导致 steer push 抛错（虽已 try/catch 回填，但清空让未就绪态更明确）
                    this.steerSink = null;
                    // 轮级状态复位：后台任务集合按「进程重启即清空」语义随轮清空（sdk.d.ts level 信号
                    // 为 per-process）；待注入停止信息与暂存批次标记不跨轮残留
                    this.backgroundTaskIds = new Set<string>();
                    this.pendingAbortInfo = null;
                    this.suppressNextInterruptedResult = false;
                    this.pendingBatchHeld = false;
                    if (this.queryControlRef) {
                        this.queryControlRef.current = null;
                    }
                    logger.debug('[remote]: launch done');
                    permissionHandler.resetForNewTurn();
                    modeHash = null;
                }
            }
        } finally {
            // scanner 与 goalHandler 跟 launcher 生命周期一致(跨 turn 复用,仅销毁时清理)
            goalHandler.dispose();
            // 等待 pending scanner 创建完成再 cleanup,防止 launcher 在 start() 完成前退出致孤儿 watcher
            // scannerPromise 仅在回调闭包内赋值，TS CFA 不跟踪闭包赋值会窄化为 null，需 as 恢复联合类型
            const pendingScanner = scannerPromise as Promise<Awaited<ReturnType<typeof createSessionScanner>>> | null;
            if (pendingScanner) {
                try {
                    const s = await pendingScanner.catch(() => null);
                    await s?.cleanup();
                } catch (e) {
                    logger.debug('[remote]: scanner cleanup failed', e);
                }
            }
            if (this.permissionHandler) {
                this.permissionHandler.reset();
            }
        }
    }

    protected async cleanup(): Promise<void> {
        this.clearAbortHandlers(this.session.client.rpcHandlerManager);

        if (this.handleSessionFound) {
            this.session.removeSessionFoundCallback(this.handleSessionFound);
            this.handleSessionFound = null;
        }

        if (this.permissionHandler) {
            this.permissionHandler.reset();
        }

        if (this.abortFuture) {
            this.abortFuture.resolve(undefined);
        }

        if (this.processCleanupRef) {
            this.processCleanupRef.current = null;
        }
    }
}

/**
 * 从 background_tasks_changed 的 tasks 数组提取存活任务 id 集合（批次 A『全部停止』遍历源）。
 * 提取规则（task_id 非空字符串 + 跳过 ambient 家务任务，spec D1/D2；非数组输入返回空集合
 * 即 REPLACE 语义清空）单源于 shared 的 extractLiveBackgroundTaskIds——cli 与 hub 共用，
 * 此处仅作薄包装以保持既有导出签名（ReadonlySet）与调用方不变。
 */
export function collectLiveTaskIds(tasks: unknown): ReadonlySet<string> {
    return extractLiveBackgroundTaskIds(tasks)
}

export async function claudeRemoteLauncher(
    session: Session,
    processCleanupRef?: { current: (() => void) | null },
    queryControlRef?: QueryControlRef,
    getSessionConfig?: () => EnhancedMode,
    flushConfig?: () => void,
): Promise<'switch' | 'exit'> {
    const launcher = new ClaudeRemoteLauncher(
        session,
        processCleanupRef,
        queryControlRef,
        getSessionConfig ?? (() => ({ permissionMode: 'default' as const })),
        flushConfig ?? (() => {}),
    );
    return launcher.launch();
}
