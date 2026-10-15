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

import { extractAnthropicMessageId, isLifecycleAhead } from '@mobi/shared'
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
 * 合并 native metadata（rewind 锚点），first-write-wins：只补旧值空缺的字段，
 * 不覆盖已有值（与 daemon 侧 store 的 mergeMetadata 语义对齐）。
 * 用于重复消息（skipIfNotSnapshot）命中时，把 messages-bound 补写的 nativeId/nativeSessionId
 * 与 messages-acked 补写的 nativeAckAt 增量合并进已渲染行——否则补写只落库、Web 端不更新，
 * hover 不显 rewind icon、刷新才见。
 * 无空缺（两者一致或旧值已完整）→ 返回原引用，调用方据此判断无变化。
 */
function mergeNativeMetadata(
    existing: DecryptedMessage['metadata'],
    incoming: DecryptedMessage['metadata'],
): DecryptedMessage['metadata'] {
    if (!incoming) return existing
    if (!existing) return incoming
    const merged: NonNullable<DecryptedMessage['metadata']> = { ...existing }
    let changed = false
    if (existing.nativeId === undefined && incoming.nativeId !== undefined) {
        merged.nativeId = incoming.nativeId
        changed = true
    }
    if (existing.nativeSessionId === undefined && incoming.nativeSessionId !== undefined) {
        merged.nativeSessionId = incoming.nativeSessionId
        changed = true
    }
    if (existing.nativeAckAt === undefined && incoming.nativeAckAt !== undefined) {
        merged.nativeAckAt = incoming.nativeAckAt
        changed = true
    }
    return changed ? merged : existing
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

    // 当非 snapshot 消息（full）到达时，移除同一条消息的 snapshot。
    // 关联键优先 Anthropic message.id（snapshot 与 full 共享，convertSnapshot 写入
    // opts.messageId）——snapshot chunk 的 parentUuid 取转换器链尾，500ms 节流期会被
    // 中途落库的消息推进而漂移；按 parentUuid 全量清理会误删恰好同锚点的其它流式行
    //（正文气泡消失/重现循环，2026-09-06 dump 实锤）。
    // 兜底：messageId 缺失的行（历史格式/字段缺失）仍按 parentUuid 匹配清理，防残留。
    let base = old
    if (!msg.snapshot) {
        const msgId = extractAnthropicMessageId(msg.content)
        const parentUuid = extractParentUuid(msg.content)
        if (msgId || parentUuid) {
            const filtered = old.filter(m => {
                if (!m.snapshot) return true
                const mId = extractAnthropicMessageId(m.content)
                if (mId) return mId !== msgId  // 有主键按主键比（主键稳定，不受链尾漂移影响）
                return extractParentUuid(m.content) !== parentUuid  // 无主键行回退 parentUuid
            })
            if (filtered.length !== old.length) base = filtered
        }
    }

    const existingIdx = base.findIndex(m => m.id === msg.id)
    if (existingIdx !== -1) {
        if (options?.skipIfNotSnapshot && !base[existingIdx].snapshot) {
            // 真正的重复消息（SSE retry / daemon 去重）默认忽略；
            // 但 rewind 锚点补写（messages-bound 广播）是同 id 消息的 metadata 增量更新，
            // 需合并 metadata 而非丢弃，否则 Web 端已渲染行不更新、hover 不显 rewind icon
            const prevMsg = base[existingIdx]
            const merged = mergeNativeMetadata(prevMsg.metadata, msg.metadata)
            // 乐观消息 seq=null → 落库消息带真实 seq：补 seq，否则 rewindFrom 的 `seq == null` 永远保留它
            const seq = prevMsg.seq == null && msg.seq != null ? msg.seq : prevMsg.seq
            // lifecycle 广播（daemon 终态推进的 update new-message）单调合并：rank 前进才接受——
            // 与 messages-bound 补写当年同坑（只落库 Web 不更新、刷新才见），同点修复。
            // lifecycleAt 随 lifecycle 推进同步（广播缺 lifecycleAt 时保留旧值）
            let lifecycle = prevMsg.lifecycle
            let lifecycleAt = prevMsg.lifecycleAt
            if (isLifecycleAhead(prevMsg.lifecycle, msg.lifecycle)) {
                lifecycle = msg.lifecycle
                lifecycleAt = msg.lifecycleAt ?? prevMsg.lifecycleAt
            }
            if (merged !== prevMsg.metadata || seq !== prevMsg.seq
                || lifecycle !== prevMsg.lifecycle || lifecycleAt !== prevMsg.lifecycleAt) {
                const updated = base.slice()
                updated[existingIdx] = { ...prevMsg, metadata: merged, seq, lifecycle, lifecycleAt }
                return updated
            }
            return base
        }
        // snapshot 原地更新，或 snapshot → full message 替换
        // 迟到 snapshot 闸门：full 是消息的终态权威，落库行不得被打回 snapshot。
        // snapshot 行与落库行共用 stream uuid 作行 id（daemon addMessage 的 id = localId
        // = body.uuid = snapshot 的 sdkUuid），落库广播与 snapshot 帧（500ms 节流 flush /
        // 快照通道）之间无全局定序——full 先入窗口、终态全量帧后到时，无条件替换会把落库行
        // 打回 snapshot=true（seq/positionAt 丢失）→ compareMessages 判「锚点在未来」坠到
        // turn-result 之后 → turn 状态行下方孤立工具块（2026-10-15 报障）；reducer 第二道
        // 防线 dedupeSnapshotBlocks 因 full 行已被替换、deliveredKeys 为空而失效。
        if (msg.snapshot && !base[existingIdx].snapshot) return base
        const updated = base.slice()
        updated[existingIdx] = msg
        return updated
    }
    // 迟到 snapshot 闸门（append 侧）：同 Anthropic messageId 的落库行已在窗口（旧 snapshot
    // 行已被 full 到达时的清理分支删掉、迟到帧行 id 又与落库行不同的路径）→ 该消息的终态
    // full 已到，迟到帧必为陈旧帧，append 会成为排序坠尾的 ghost 行。messageId 是稳定关联键
    // （parentUuid 有链尾漂移，不可用）；无 messageId 的历史格式帧不设防，走原 append 语义
    if (msg.snapshot) {
        const lateMsgId = extractAnthropicMessageId(msg.content)
        if (lateMsgId && base.some(m => !m.snapshot && extractAnthropicMessageId(m.content) === lateMsgId)) return base
    }
    return [...base, msg]
}
