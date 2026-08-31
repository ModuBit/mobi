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
 * 发送/停止合并按钮的状态推导
 *
 * Sender 右下角的唯一按钮，依据可发送性与运行态决定展示「发送」还是「停止」：
 * - canSend 为 true → 发送（即使 running 中只要有可发送内容也展示发送，消息进排队悬浮条）
 * - canSend 为 false 且 running/sending 中 → 停止（中止当前 turn）
 * - 否则（空闲且空内容）→ 发送（禁用）
 *
 * 注意：canSend 已内含 controlsDisabled（inactive / compressing 等）、
 * hasPendingPermission、sending 等判断，故请求权限期间 canSend 为 false，
 * 若同时 running → 落入停止分支且不禁用 → 唯独停止按钮可用（输入框仍由 Sender disabled 锁住）。
 */

export type SubmitButtonState =
    | { kind: 'send'; disabled: boolean }
    | { kind: 'stop'; disabled: boolean; loading: boolean }

export interface ResolveSubmitButtonStateInput {
    /** 是否可发送（已有可发送内容且未被 controlsDisabled / sending / hasPendingPermission 阻断） */
    canSend: boolean
    /** agent 是否正在运行一个 turn */
    running: boolean
    /** 发送 mutation 是否进行中（消息已提交、hub 尚未 ack 为 running 的过渡态） */
    sending: boolean
    /** 中止请求是否进行中 */
    abortPending: boolean
}

/**
 * 推导合并按钮的状态
 */
export function resolveSubmitButtonState(input: ResolveSubmitButtonStateInput): SubmitButtonState {
    const { canSend, running, sending, abortPending } = input

    // 有可发送内容 → 发送（含 running 中有内容的特殊情况）
    if (canSend) {
        return { kind: 'send', disabled: false }
    }

    // 无可发送内容但正在运行 → 停止（abortPending 时转圈并禁用以防重复中止）
    if (running || sending) {
        return { kind: 'stop', disabled: abortPending, loading: abortPending }
    }

    // 空闲且空内容 → 发送（禁用）
    return { kind: 'send', disabled: true }
}

// ──────────────────────────────────────────────────────────────
// 停止态长按判定（spec D1：点按=只停本轮；长按弹三档菜单）
// ──────────────────────────────────────────────────────────────

/** 长按判定阈值（ms）：pointerdown 起算，达到即开三档菜单 */
export const LONG_PRESS_MS = 500

export type StopPressKind = 'click' | 'longpress'

/**
 * pointerdown→pointerup 时长 → 点按或长按（达到阈值即长按）。
 * 提为纯函数以便阈值语义单源可测；pointer 时序的组装在 SubmitButton。
 */
export function resolveStopPress(upElapsedMs: number): StopPressKind {
    return upElapsedMs >= LONG_PRESS_MS ? 'longpress' : 'click'
}
