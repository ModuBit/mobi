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
 * - still_queued 非空 → 守卫降级 stop：撤回目标（或其后消息）仍停在 CC 队列、停止后还会执行，
 *   此时软删除会制造「消息已删但仍执行」的僵尸——即使初判错了也删不掉会执行的消息
 * - turnHasOutput → 等待期模型抢先输出，降级普通停止（spec D4 原有语义）
 * 两者皆否 → 撤回生效。
 */
export function resolvePostInterruptAction(state: {
    turnHasOutput: boolean
    stillQueuedCount: number
}): 'withdraw' | 'stop' {
    if (state.stillQueuedCount > 0) return 'stop'
    if (state.turnHasOutput) return 'stop'
    return 'withdraw'
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
