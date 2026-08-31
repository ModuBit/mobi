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

import { DEFAULT_STOP_KIND, STOP_KIND_VALUES, type StopKind } from '@mobi/shared'

/**
 * abort 入口的 stopKind 校验：不白名单的值（旧 hub 手误、未来第 4 档在旧 CLI 上运行）
 * 回落 DEFAULT_STOP_KIND('turn')。isCancelQueued 是负向默认（kind !== 'turn' 即清队列），
 * 未知值不校验直接透传会静默升级为破坏性清队列——宁降不升。
 */
export function normalizeStopKind(value: unknown): StopKind {
    return typeof value === 'string' && (STOP_KIND_VALUES as readonly string[]).includes(value)
        ? value as StopKind
        : DEFAULT_STOP_KIND
}

/** stopKind='turn' 的撤回三分支（spec §3.3）。初判只定意向；复验在 interrupt 返回后做。 */
export function resolveStopAction(state: {
    turnHasOutput: boolean
    pumpQueueEmpty: boolean
    hasLastPushed: boolean
}): 'withdraw' | 'stop' {
    if (state.turnHasOutput) return 'stop'
    if (!state.pumpQueueEmpty) return 'stop'
    if (!state.hasLastPushed) return 'stop'   // 安全降级：只少撤、不错删
    return 'withdraw'
}

/**
 * interrupt 返回后的复验裁决（两段式第二段；C1 修法 2 / I1 的独立防线）：
 * - anchorChanged → 守卫降级 stop：await interrupt() 窗口内撤回锚被新 push 覆盖（queue-drain
 *   竞态——新消息被消费成新 turn，覆盖 lastPushedNativeId 并复位 hasOutput，其余守卫全过），
 *   此时撤回会删掉一条已在执行的新消息，降级普通停止
 * - still_queued 非空 → 守卫降级 stop：撤回目标（或其后消息）仍停在 CC 队列、停止后还会执行，
 *   此时软删除会制造「消息已删但仍执行」的僵尸——即使初判错了也删不掉会执行的消息
 * - turnHasOutput → 等待期模型抢先输出，降级普通停止（spec D4 原有语义）
 * 三者皆否 → 撤回生效。
 */
export function resolvePostInterruptAction(state: {
    turnHasOutput: boolean
    stillQueuedCount: number
    /** 复验时 lastPushedNativeId !== 初判记录的锚（queue-drain 竞态守卫；省略视为未变化） */
    anchorChanged?: boolean
}): 'withdraw' | 'stop' {
    if (state.anchorChanged) return 'stop'
    if (state.stillQueuedCount > 0) return 'stop'
    if (state.turnHasOutput) return 'stop'
    return 'withdraw'
}

/** 中断终态判别（与 web normalizeAgent.handleResultOutput 同口径）：
 *  SDK result 的 terminal_reason 命中 aborted_* 即「turn 被中断的死亡回执」。
 *  （撤回后转发抑制：调用点 claudeRemoteLauncher onMessage 在本判别为 true 的分支内
 *  直接查 suppressNextInterruptedResult 标志——helper 内层判别在调用点恒真，已内联。） */
export function isInterruptedTerminalReason(reason: unknown): boolean {
    return reason === 'aborted_streaming' || reason === 'aborted_tools'
}

/**
 * 后台任务并行停止（'turn-queue-tasks' 档）：Promise.allSettled 并发——单个 rejection
 * 不中断其余任务，总延迟从 N×RTT 降为最慢单个。失败不吞：按 { taskId, error } 返回，
 * 由调用方映射 logger.warn（保失败日志）。
 */
export async function stopBackgroundTasksAllSettled(
    taskIds: Iterable<string>,
    stopTask: (taskId: string) => Promise<void>,
): Promise<{ taskId: string; error: unknown }[]> {
    const ids = [...taskIds]
    if (ids.length === 0) return []
    const results = await Promise.allSettled(ids.map(id => stopTask(id)))
    const failures: { taskId: string; error: unknown }[] = []
    results.forEach((r, i) => {
        if (r.status === 'rejected') failures.push({ taskId: ids[i]!, error: r.reason })
    })
    return failures
}

/**
 * push 来源：'turn' = 新 turn 的首 push（initial / inputLoop 泵 / bash 注入——三者都只在
 * agent idle 时发生，push 即新 turn 起点）；'steer' = turn 运行中经 steer sink 的插队 push。
 */
export type PushOrigin = 'turn' | 'steer'

/**
 * push 绑定时的 turn 追踪更新（C1 修法 1）：
 * - lastPushedNativeId 恒覆盖为最新 push：撤回锚 = 最新 user 消息。steer 的 B 成为锚后，
 *   若 turn 死于无输出，撤 B 合法——B 尚无任何产出，且 still_queued 守卫保证 B 仍在 CC
 *   队列时根本走不到撤回（不会僵尸执行）。若锚不随 steer 前移，stale 锚 A 会把已产出
 *   回答的旧消息误作撤回目标，破坏更大
 * - hasOutput 只在新 turn 的 push 时复位：steer push 发生在 turn 运行中，turn 可能已产出
 *   输出（如工具调用已发出）——复位会把「有输出」误判为「无输出」，工具执行期的分钟级
 *   窗口内点停止就会误撤回。steer 不是新 turn 起点，不得复位
 *
 * 返回新状态对象（不入参改写）；nativeId 为 null（空 bindings）时原样返回入参引用。
 */
export function applyPushToTurnTracking(
    prev: { hasOutput: boolean; lastPushedNativeId: string | null },
    nativeId: string | null,
    origin: PushOrigin,
): { hasOutput: boolean; lastPushedNativeId: string | null } {
    if (nativeId === null) return prev
    return {
        hasOutput: origin === 'turn' ? false : prev.hasOutput,
        lastPushedNativeId: nativeId,
    }
}
