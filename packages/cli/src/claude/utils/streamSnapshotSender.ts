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
import { SNAPSHOT_PLACEHOLDER_ID } from '@mobi/shared'
import type { RawJSONLines } from '@/claude/types'
import type { SDKToLogConverter } from './sdkToLogConverter'

type SnapshotTransport = (msg: DecryptedMessage) => void

/** 内容块缓冲区 */
interface ContentBlockBuffer {
    type: 'text' | 'thinking'
    content: string
    dirty: boolean
}

type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'thinking'; thinking: string }

/**
 * 流式 Snapshot 发送器
 *
 * 累积 SDK StreamEvent 中的 text_delta / thinking_delta，
 * 每 500ms 通过 SDKToLogConverter 转换为 DecryptedMessage 发送。
 */
export class StreamSnapshotSender {
    private readonly buffers: Map<number, ContentBlockBuffer> = new Map()
    private timer: ReturnType<typeof setInterval> | null = null
    private destroyed = false
    /** 当前消息的快照选项 */
    private snapshotOpts: { parentToolUseId?: string; model?: string } = {}
    /** snapshot placeholder 的固定 ID，前端用于匹配 */
    private snapshotMsgId = SNAPSHOT_PLACEHOLDER_ID

    constructor(
        private readonly transport: SnapshotTransport,
        private readonly converter: SDKToLogConverter,
        private readonly intervalMs: number = 500,
    ) {}

    /** 设置消息级别选项（在 message_start 时调用） */
    setSnapshotOpts(opts: { parentToolUseId?: string; model?: string }): void {
        this.snapshotOpts = opts
    }

    /** 清除所有 buffer（新消息开始时调用） */
    clearBuffers(): void {
        if (this.destroyed) return
        this.buffers.clear()
    }

    /** 记录 content_block_start */
    startBlock(index: number, type: 'text' | 'thinking'): void {
        if (this.destroyed) return
        this.buffers.set(index, { type, content: '', dirty: false })
    }

    /** 追加增量内容 */
    append(index: number, delta: string): void {
        if (this.destroyed) return
        const buffer = this.buffers.get(index)
        if (!buffer) return
        buffer.content += delta
        buffer.dirty = true
    }

    /** 开始节流发送 */
    start(): void {
        if (this.destroyed || this.timer) return
        this.timer = setInterval(() => this.flush(), this.intervalMs)
    }

    /** 立即刷新所有脏 buffer */
    flush(): void {
        if (this.destroyed) return

        const blocks: ContentBlock[] = []
        let hasDirty = false

        // Map 保持插入顺序，startBlock 按递增 index 调用，无需额外排序
        for (const buffer of this.buffers.values()) {
            if (buffer.dirty) hasDirty = true
            if (buffer.type === 'text') {
                blocks.push({ type: 'text', text: buffer.content })
            } else {
                blocks.push({ type: 'thinking', thinking: buffer.content })
            }
        }

        if (!hasDirty || blocks.length === 0) return

        // 通过 SDKToLogConverter 生成与最终消息一致的 RawJSONLines
        const rawLog = this.converter.convertSnapshot(blocks, this.snapshotOpts)
        this.transport(this.wrapAsDecryptedMessage(rawLog))

        // 标记所有 buffer 为干净
        for (const buffer of this.buffers.values()) {
            buffer.dirty = false
        }
    }

    /** 将 RawJSONLines 包装为 DecryptedMessage（与 sendClaudeSessionMessage 一致的角色信封格式） */
    private wrapAsDecryptedMessage(rawLog: RawJSONLines): DecryptedMessage {
        return {
            id: this.snapshotMsgId,
            seq: null,
            localId: null,
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: rawLog,
                },
                meta: { sentFrom: 'cli' },
            },
            createdAt: Date.now(),
        }
    }

    /** 停止发送并清空 buffer */
    destroy(): void {
        this.destroyed = true
        if (this.timer) {
            clearInterval(this.timer)
            this.timer = null
        }
        this.buffers.clear()
    }
}
