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
 * turn 边界识别与按边界裁剪（#40 C-1）：messageWindowStore 内存钳制的纯函数层。
 *
 * 前提已实证（2026-08-15 dev DB 5 会话 227 条 sidechain）：sidechain 全部落在
 * user turn 之内不跨 turn（SDK Task 同步阻塞），整 turn 裁剪必不断 sidechain 归组。
 */

import { isObject } from '@mobi/shared'
import { unwrapRoleWrappedRecordEnvelope } from '@mobi/shared/messages'
import type { DecryptedMessage } from '@/core/data/api/types'

/** 裁剪触发阈值：窗口超过才做一次 O(n) 边界扫描（未超过时 append 路径仅 O(1) 长度判断） */
export const TRIM_THRESHOLD = 1500
/** 裁剪保留目标（滞回带 [TRIM_TARGET, TRIM_THRESHOLD]，避免频繁裁剪抖动） */
export const TRIM_TARGET = 1000

/**
 * 原始层 turn 起点判定（不依赖 normalize）：三种消息开启新 turn——
 * user 信封（用户发言）、system:compact_boundary（压缩后即新上下文）、
 * context-cleared 事件（/clear 完成）。
 */
export function isTurnStart(content: unknown): boolean {
    const record = unwrapRoleWrappedRecordEnvelope(content)
    if (!record) return false
    if (record.role === 'user') return true
    if (record.role !== 'agent' && record.role !== 'assistant') return false
    const c = isObject(record.content) ? (record.content as { type?: string; data?: { type?: string; subtype?: string } }) : null
    if (!c) return false
    if (c.type === 'event' && c.data?.type === 'context-cleared') return true
    if (c.type === 'output' && c.data?.type === 'system' && c.data?.subtype === 'compact_boundary') return true
    return false
}

/**
 * 按 turn 边界从头部裁剪：丢最少的整 turn 使剩余 ≤ TRIM_TARGET（保留最多历史）。
 * 找不到满足目标的起点（最后一个 turn 自身超过目标）→ 兜底只保留最后一个整 turn；
 * 完全没有 turn 起点 / 整体就是一个 turn → 不裁（原引用返回，避免裁出 orphan 开头）。
 */
export function trimByTurnBoundary(messages: DecryptedMessage[]): DecryptedMessage[] {
    if (messages.length <= TRIM_THRESHOLD) return messages
    let firstUnderTarget = -1
    let lastTurnStart = -1
    for (let i = 0; i < messages.length; i += 1) {
        if (!isTurnStart(messages[i].content)) continue
        lastTurnStart = i
        if (firstUnderTarget === -1 && messages.length - i <= TRIM_TARGET) firstUnderTarget = i
    }
    const cut = firstUnderTarget !== -1 ? firstUnderTarget : lastTurnStart
    if (cut <= 0) return messages
    return messages.slice(cut)
}
