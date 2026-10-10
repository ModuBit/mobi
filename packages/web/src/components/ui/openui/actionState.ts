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

/** 从消息 meta 读档③锚点（发起时由 daemon 写入，见 messageService）。
 *  信封解包走 shared 单源（unwrapRoleWrappedRecordEnvelope），不复刻信封形状 */
function readAnchor(msg: DecryptedMessage): string | null {
    const env = unwrapRoleWrappedRecordEnvelope(msg.content)
    if (!env || env.role !== 'user') return null
    const meta = env.meta
    if (!isObject(meta) || meta.sentFrom !== UI_ANCHOR_ORIGIN) return null
    return typeof meta.openuiAnchor === 'string' && meta.openuiAnchor.length > 0 ? meta.openuiAnchor : null
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
 */
export function deriveOpenUITerminalStates(
    messages: readonly DecryptedMessage[],
    isSessionRunning: boolean,
): Map<string, Exclude<OpenUIActionPhase, 'idle'>> {
    const out = new Map<string, Exclude<OpenUIActionPhase, 'idle'>>()
    let pending: { anchor: string } | null = null

    for (const msg of messages) {
        const anchor = readAnchor(msg)
        if (anchor !== null) {
            // 下一条 openui action 开始：上一段未决的锚点保持上一轮判定
            pending = { anchor }
            continue
        }
        if (!pending) continue
        const result = readResultPayload(msg)
        if (result === null) continue
        if (isAbortedTerminalReason(getField(result, 'terminal_reason'))) {
            out.set(pending.anchor, 'failed')
        } else {
            out.set(pending.anchor, 'done')
        }
        pending = null
    }
    // 窗口尾部仍 pending：会话 running → running；会话已停但无终态证据（CLI 掉线
    // 消息丢失等）→ 不给条目，保持调用方已翻转的即时态（宁可停在执行态，不误报）
    if (pending && isSessionRunning) out.set(pending.anchor, 'running')
    return out
}
