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
 * 回路③原地更新的状态机（generative-ui 票 04）。
 *
 * 档③按钮的状态由约定 reactive 变量 `$actionState` 承载（catalog prompt 教学），
 * 值域 idle → running → done | failed：
 * - idle：未发起；点击后进 running（renderer 本地即时翻转，不等扫描）
 * - running：turn 进行中；重复点击被去重
 * - done：该 action 触发的 agent turn 成功完成（其后出现 result 终态证据）
 * - failed：turn 被中断（terminal_reason aborted_*）
 *
 * 终态判定从消息窗口派生（纯函数，可测）：openui 发起的 user 消息（meta 带
 * sentFrom='openui' + openuiAnchor）之后的 agent result 输出即其响应 turn 的
 * 终态证据。刷新后重扫同一数据即可恢复状态——锚点随消息落库，不依赖内存。
 */

import {
    getField,
    isAbortedTerminalReason,
    isObject,
    UI_ANCHOR_ORIGIN,
    unwrapOutputMessage,
    unwrapRoleWrappedRecordEnvelope,
} from '@mobi/shared'
import type { DecryptedMessage } from '@/core/data/api/types'

/** $actionState 的值域（与 catalog prompt 教学、renderer 注入三方共享的词汇） */
export type OpenUIActionPhase = 'idle' | 'running' | 'done' | 'failed'

/** 派生条目（状态持久化票 02）：phase 之外携带锚点消息 meta 上的表单快照——
 *  renderer 回注 initialState 恢复提交时刻表单；快照缺失（超限丢弃/旧消息）为 undefined */
export type OpenUIActionState = {
    phase: Exclude<OpenUIActionPhase, 'idle'>
    formState?: Record<string, unknown>
}

/**
 * per-action 状态键单源（per-action 粒度票 02）：操作状态存储与派生的键拼装。
 * 有变量身份 → `anchor#var`（同块多操作互不串）；无（模型偏离教学 + 绑定表也空）
 * → 裸 anchor（块级行为，与 per-action 之前等价）。写读两侧必须同源拼装。
 */
export function actionStateKey(anchor: string, stateVar: string | null): string {
    return stateVar === null ? anchor : `${anchor}#${stateVar}`
}

/** 排队轨道前段（queued→pushed→acked 单调推进）：lifecycle 停在这一段 = 消息尚未被
 *  agent 消费。MessageLifecycle 词汇见 shared；终态（cancelled/discarded/refused/
 *  withdrawn）不出现在这里——带锚点的消息一旦离开排队轨道就视为已消费 */
const UNCONSUMED_LIFECYCLES = new Set(['queued', 'pushed', 'acked'])

/** 从消息 meta 读档③锚点（发起时由 daemon 写入，见 messageService）。
 *  信封解包走 shared 单源（unwrapRoleWrappedRecordEnvelope），不复刻信封形状。
 *  consumed = 该消息已被 agent 消费（不在排队轨道前段；非排队轨道的 lifecycle 为
 *  null，服务端直收亦视为已消费）——result 配对只认消费后的，见 derive 注释。
 *  stateVar = per-action 身份（票 02）：缺失时派生键退化为裸 anchor（块级）。 */
function readAnchor(msg: DecryptedMessage): { anchor: string; stateVar: string | null; consumed: boolean; formState?: Record<string, unknown> } | null {
    const env = unwrapRoleWrappedRecordEnvelope(msg.content)
    if (!env || env.role !== 'user') return null
    const meta = env.meta
    if (!isObject(meta) || meta.sentFrom !== UI_ANCHOR_ORIGIN) return null
    if (typeof meta.openuiAnchor !== 'string' || meta.openuiAnchor.length === 0) return null
    // 表单快照（票 02）：daemon 侧仅 openui 来源落，形状 object 才认
    const rawFormState = meta.openuiFormState
    const formState = isObject(rawFormState) ? (rawFormState as Record<string, unknown>) : undefined
    const stateVar = typeof meta.openuiStateVar === 'string' && meta.openuiStateVar.length > 0 ? meta.openuiStateVar : null
    return { anchor: meta.openuiAnchor, stateVar, consumed: !UNCONSUMED_LIFECYCLES.has(msg.lifecycle ?? ''), formState }
}

/** agent 输出消息的 result 载荷（turn 终态证据所在）；非 result 形态返回 null。
 *  信封解包走 shared 单源（unwrapOutputMessage）。终态判据保留**字段存在性**
 *  （stop_reason / terminal_reason / usage 任一在场）而非 shared 的 data.type ===
 *  'result'——后者是更严的口径，字段启发式是本模块对「证据充足」的刻意防御：
 *  result 行理论上必带 usage（SDK 契约），万一 type 缺失也认字段，宁可多判不漏判 */
function readResultPayload(msg: DecryptedMessage): Record<string, unknown> | null {
    const unwrapped = unwrapOutputMessage(msg.content)
    if (!unwrapped || unwrapped.role !== 'agent') return null
    const payload = unwrapped.data
    const hasTerminal = getField(payload, 'stop_reason') != null
        || getField(payload, 'terminal_reason') != null
        || typeof payload.usage === 'object'
    return hasTerminal ? payload : null
}

/**
 * 扫描消息窗口，派生每个档③锚点的状态。返回 anchor → phase 映射。
 * done/failed 由 result 终态证据判定；窗口尾部 pending（有发起无终态）在会话
 * running 时归 running——点击后的即时翻转也走同一词汇，两来源幂等合成。
 *
 * 排队插队门控：锚点消息未消费（lifecycle 仍在 queued/pushed/acked）时其后出现的
 * result 属于上一个 turn（本消息还没轮到 agent 处理），不归因给它——否则 turn 进行
 * 中点击的 action 会被前 turn 的收尾 result 误翻 done。仅消费后（processing 及之后
 * /非排队轨道）的 result 才配对。
 *
 * 交叠 turn（并发点击多操作，per-action E2E 2026-10-11 实锤）：多条锚点背靠背落库
 * 且各自 result 未到齐——pending 是**队列**而非单槽位，result 按序消费队首**已消费**
 * 的锚点。单槽位下后者覆盖前者，前者的 result 错配给后者、前者终态丢失恒卡 running。
 */
export function deriveOpenUITerminalStates(
    messages: readonly DecryptedMessage[],
    isSessionRunning: boolean,
): Map<string, OpenUIActionState> {
    const out = new Map<string, OpenUIActionState>()
    type Pending = { anchor: string; stateVar: string | null; consumed: boolean; formState?: Record<string, unknown> }
    const pendings: Pending[] = []

    for (const msg of messages) {
        const anchor = readAnchor(msg)
        if (anchor !== null) {
            // 新一条 openui action 开始：入队等待自己的 result（交叠时不挤掉未决前任）
            pendings.push(anchor)
            continue
        }
        if (pendings.length === 0) continue
        const result = readResultPayload(msg)
        if (result === null) continue
        // 队首未消费 → 其后 result 属于上一个 turn，谁都不消费（保持等待，不误报）；
        // 交叠时严格按队首闸门（跳过队首配给后任会把前 turn result 错配给后发起的操作）
        if (!pendings[0]!.consumed) continue
        const pending = pendings.shift()!
        const phase: OpenUIActionState['phase'] = isAbortedTerminalReason(getField(result, 'terminal_reason')) ? 'failed' : 'done'
        const entry: OpenUIActionState = pending.formState ? { phase, formState: pending.formState } : { phase }
        out.set(actionStateKey(pending.anchor, pending.stateVar), entry)
    }
    // 窗口尾部仍有多条未决：会话 running → 各自归 running（交叠时互不遮蔽）；会话已停
    // 但无终态证据（CLI 掉线消息丢失等）→ 不给条目，保持调用方已翻转的即时态（宁可停
    // 在执行态，不误报）
    if (isSessionRunning) {
        for (const pending of pendings) {
            const entry: OpenUIActionState = { phase: 'running', ...(pending.formState ? { formState: pending.formState } : {}) }
            out.set(actionStateKey(pending.anchor, pending.stateVar), entry)
        }
    }
    return out
}
