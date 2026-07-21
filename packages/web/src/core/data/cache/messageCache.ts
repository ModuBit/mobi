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

import type { DecryptedMessage } from '@mobi/shared'

/** 从 DecryptedMessage.content 信封中提取 parentUuid */
export function extractParentUuid(content: unknown): string | null {
    if (!content || typeof content !== 'object') return null
    const envelope = content as Record<string, unknown>
    const inner = envelope.content
    if (!inner || typeof inner !== 'object') return null
    const data = (inner as Record<string, unknown>).data
    if (!data || typeof data !== 'object') return null
    const parentUuid = (data as Record<string, unknown>).parentUuid
    return typeof parentUuid === 'string' ? parentUuid : null
}

/**
 * 解析消息缓存更新
 * 纯函数，便于测试
 */
export function resolveMessageCache(
    old: DecryptedMessage[] | undefined,
    msg: DecryptedMessage,
    options?: { skipIfNotSnapshot?: boolean },
): DecryptedMessage[] {
    if (!old) return [msg]

    // 当非 snapshot 消息（full）到达时，移除相同 parentUuid 的 snapshot。
    // 前提：CLI 的 assembler 把 SDK 拆分的 full 按 message.id 聚合成一条，使 snapshot（一条）
    // 与 full（一条）1-vs-1、parentUuid 不漂移，清理可靠（= message queue 之前的稳定态）。
    // parentUuid 的已知边界（null：会话首条 assistant；SSE 乱序）由 reducer 的 (message.id, type)
    // 过滤兜底（见 normalize 后的 dedupe），双保险。
    let base = old
    if (!msg.snapshot) {
        const parentUuid = extractParentUuid(msg.content)
        if (parentUuid) {
            const filtered = old.filter(m => !m.snapshot || extractParentUuid(m.content) !== parentUuid)
            if (filtered.length !== old.length) base = filtered
        }
    }

    const existingIdx = base.findIndex(m => m.id === msg.id)
    if (existingIdx !== -1) {
        if (options?.skipIfNotSnapshot && !base[existingIdx].snapshot) {
            // 真正的重复消息（SSE retry / Hub 去重）
            return base
        }
        // snapshot 原地更新，或 snapshot → full message 替换
        const updated = base.slice()
        updated[existingIdx] = msg
        return updated
    }
    return [...base, msg]
}
