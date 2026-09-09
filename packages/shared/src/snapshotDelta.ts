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

import type { SnapshotBlock, SnapshotDeltaFrame } from './schemas'

/**
 * Snapshot delta 协议的 apply 端共享逻辑（.scratch/snapshot-delta 票 02）：
 * hub 拼接器与 web 消息窗口 store 共用同一份实现，避免双实现漂移。
 * 语义与发送端（CLI StreamSnapshotSender）的状态变迁一一对应。
 */

/**
 * 定位 snapshot 信封内的 blocks 数组：content.content.data.message.content。
 * CLI 发送的 snapshot 信封固定此形状（wrapAsDecryptedMessage → convertSnapshot）；
 * 任何环节形状漂移 → null（调用方按防御路径处理：丢弃等全量）。
 */
export function locateSnapshotBlocks(content: unknown): SnapshotBlock[] | null {
    if (typeof content !== 'object' || content === null) return null
    const c = content as { content?: unknown }
    if (typeof c.content !== 'object' || c.content === null) return null
    const data = (c.content as { data?: unknown }).data
    if (typeof data !== 'object' || data === null) return null
    const message = (data as { message?: unknown }).message
    if (typeof message !== 'object' || message === null) return null
    const blocks = (message as { content?: unknown }).content
    return Array.isArray(blocks) ? (blocks as SnapshotBlock[]) : null
}

/**
 * 逐 op 应用到 blocks（就地变异）。
 * 任何违规（index 越界、类型错配、new-block 非末位）→ false（整体失败，调用方丢弃等全量）。
 * 直接变异的理由：失败路径状态即被丢弃、成功路径避免整树拷贝（流式期间每帧拷贝是 O(N²)）。
 */
export function applySnapshotBlockDeltas(
    blocks: SnapshotBlock[],
    deltas: NonNullable<SnapshotDeltaFrame['deltas']>,
): boolean {
    for (const op of deltas) {
        if (op.op === 'append') {
            const block = blocks[op.index]
            if (!block || block.type === 'tool_use') return false
            if (block.type === 'text') {
                block.text += op.text
            } else {
                block.thinking += op.text
            }
            continue
        }
        if (op.op === 'new-block') {
            // 新块只能追加到末位（发送方按插入序对齐 index）
            if (op.index !== blocks.length) return false
            blocks.push(op.block)
            continue
        }
        // replace-block：仅替换已存在位置
        if (op.index >= blocks.length) return false
        blocks[op.index] = op.block
    }
    return true
}
