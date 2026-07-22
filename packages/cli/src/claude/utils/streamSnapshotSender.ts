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

import { SNAPSHOT_PENDING_ID, type DecryptedMessage } from '@mobi/shared'
import type { RawJSONLines } from '@/claude/types'
import type { SDKToLogConverter } from './sdkToLogConverter'

type SnapshotTransport = (msg: DecryptedMessage) => void

/** 文本类（text/thinking）缓冲区：流式逐字追加，过程中即可输出 */
interface TextLikeBuffer {
    kind: 'text-like'
    type: 'text' | 'thinking'
    content: string
    dirty: boolean
}

/** tool_use 缓冲区：累积 input_json_delta，content_block_stop 后（input JSON 完整）才进实时 snapshot */
interface ToolUseBuffer {
    kind: 'tool_use'
    id: string
    name: string
    /** 累积的 input JSON 字符串（来自 input_json_delta.partial_json） */
    inputJson: string
    /** content_block_stop 后置 true，表示 input 已完整可进实时 snapshot */
    ready: boolean
    /** ready 翻转时标脏一次，触发 flush 输出 */
    dirty: boolean
    /** ready 时一次性 parse 缓存（inputJson 此后不变，避免每次 flush 重复 parse） */
    parsedInput: unknown
}

type ContentBlockBuffer = TextLikeBuffer | ToolUseBuffer

/**
 * 解析 tool_use 累积的 input JSON：空串→{}，parse 失败→{}（保证 tool_use 总能输出，input 兜底）
 */
function parseInputJson(json: string): unknown {
    if (!json) return {}
    try {
        return JSON.parse(json)
    } catch {
        return {}
    }
}

export type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'thinking'; thinking: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }

/**
 * 流式 Snapshot 发送器
 *
 * 累积 SDK StreamEvent 中的 text_delta / thinking_delta / input_json_delta(tool_use)，
 * 每 500ms 通过 SDKToLogConverter 转换为 DecryptedMessage 发送。
 * 使用 SDK 的 uuid 作为 snapshot id，与完整消息共享同一 localId，
 * 前端据此实现平滑的 snapshot → full message 过渡。
 *
 * text/thinking 流式逐字追加，过程中即可输出（半截文本有意义）。
 * tool_use 累积 input_json_delta，**content_block_stop 后（input JSON 完整）才输出**——
 * 半截 JSON 无意义且前端解析会出错。这样 tool_use 在工具实际执行期间就作为 snapshot 下发，
 * 前端 reducer 命中 tool-call 建 running block（不等 type:'assistant' 完整消息），可见「工具正在执行」。
 */
export class StreamSnapshotSender {
    private readonly buffers: Map<number, ContentBlockBuffer> = new Map()
    private timer: ReturnType<typeof setInterval> | null = null
    private destroyed = false
    /** 当前消息的快照选项 */
    private snapshotOpts: { parentToolUseId?: string; model?: string; messageId?: string } = {}
    /** SDK 为当前 message_start 分配的 uuid，作 snapshot 的 id/localId（full message 用各自独立 uuid，不共享） */
    private sdkUuid: string | null = null
    /**
     * 当前 message 的完整 SDKAssistantMessage 是否已下发。setSnapshotOpts（message_start）时重置 false；
     * sdkOutputLoop 收到完整 assistant 时调 markFullDelivered 置 true。
     * abort 时若仍 false 且有累积内容，consumePendingFull 返回补全内容落库。
     */
    private fullDelivered = false

    constructor(
        private readonly transport: SnapshotTransport,
        private readonly converter: SDKToLogConverter,
        private readonly intervalMs: number = 500,
    ) {}

    /** 设置消息级别选项（在 message_start 时调用）。每条新 message 开始时 full 未到，重置 fullDelivered。 */
    setSnapshotOpts(opts: { parentToolUseId?: string; model?: string; sdkUuid?: string; messageId?: string }): void {
        this.snapshotOpts = opts
        if (opts.sdkUuid) this.sdkUuid = opts.sdkUuid
        this.fullDelivered = false
    }

    /** 清除所有 buffer（新消息开始时调用） */
    clearBuffers(): void {
        if (this.destroyed) return
        this.buffers.clear()
    }

    /** 记录 content_block_start（text/thinking 逐字流式；tool_use 累积 input JSON） */
    startBlock(index: number, type: 'text' | 'thinking'): void
    startBlock(index: number, type: 'tool_use', meta: { id: string; name: string }): void
    startBlock(index: number, type: 'text' | 'thinking' | 'tool_use', meta?: { id: string; name: string }): void {
        if (this.destroyed) return
        if (type === 'tool_use') {
            // tool_use 的 id/name 在 content_block_start 就齐全；input 随 input_json_delta 累积
            this.buffers.set(index, {
                kind: 'tool_use',
                id: meta!.id,
                name: meta!.name,
                inputJson: '',
                ready: false,
                dirty: false,
                parsedInput: {},
            })
            return
        }
        this.buffers.set(index, { kind: 'text-like', type, content: '', dirty: false })
    }

    /** 追加增量内容（text_delta / thinking_delta / input_json_delta.partial_json） */
    append(index: number, delta: string): void {
        if (this.destroyed) return
        const buffer = this.buffers.get(index)
        if (!buffer) return
        if (buffer.kind === 'tool_use') {
            buffer.inputJson += delta
        } else {
            buffer.content += delta
            buffer.dirty = true
        }
    }

    /**
     * 内容块结束（content_block_stop），刷新剩余内容。
     * tool_use 在此标记 ready 并一次性 parse 缓存 input（此后不变），下次 flush 输出。
     * 不删 buffer——保留当前 message 的完整累积，供 abort 时 consumePendingFull 补全落库。
     * 累积在下次 message_start（clearBuffers）时清空，一个 message 的 block 数有限，不泄漏。
     */
    endBlock(index: number): void {
        if (this.destroyed) return
        const buffer = this.buffers.get(index)
        if (buffer?.kind === 'tool_use' && !buffer.ready) {
            buffer.ready = true
            buffer.parsedInput = parseInputJson(buffer.inputJson)
            buffer.dirty = true
        }
        this.flush()
    }

    /** 开始节流发送 */
    start(): void {
        if (this.destroyed || this.timer) return
        this.timer = setInterval(() => this.flush(), this.intervalMs)
    }

    /** 立即刷新所有脏 buffer */
    flush(): void {
        if (this.destroyed) return

        let hasDirty = false
        for (const buffer of this.buffers.values()) {
            if (buffer.dirty) { hasDirty = true; break }
        }
        if (!hasDirty) return

        // 通过 SDKToLogConverter 生成与最终消息一致的 RawJSONLines
        const rawLog = this.converter.convertSnapshot(this.buildBlocks(), this.snapshotOpts)
        this.transport(this.wrapAsDecryptedMessage(rawLog))

        // 标记所有 buffer 为干净
        for (const buffer of this.buffers.values()) {
            buffer.dirty = false
        }
    }

    /**
     * 从 buffers 构造完整 ContentBlock[]（按插入顺序，含已 endBlock 的——endBlock 不删 buffer）。
     *
     * - text/thinking：总是输出（流式中也含已累积内容，半截文本有意义）
     * - tool_use：仅 ready（content_block_stop）后输出，input 用 ready 时缓存的 parsedInput
     *
     * @param includePartialToolUse abort 补全（consumePendingFull）传 true——半截 tool_use 也输出
     *   （input 兜底为已累积部分或 {}），保留「该工具被调用过」的记录，避免 abort 时整条丢失。
     *   实时 flush 传 false（默认）——半截 JSON 无意义，不发。
     */
    private buildBlocks(includePartialToolUse = false): ContentBlock[] {
        const blocks: ContentBlock[] = []
        for (const buffer of this.buffers.values()) {
            if (buffer.kind === 'text-like') {
                blocks.push(buffer.type === 'text'
                    ? { type: 'text', text: buffer.content }
                    : { type: 'thinking', thinking: buffer.content })
            } else if (buffer.ready) {
                blocks.push({ type: 'tool_use', id: buffer.id, name: buffer.name, input: buffer.parsedInput })
            } else if (includePartialToolUse) {
                // abort 补全：未 ready 的 tool_use 也输出，尽量保留记录（input 用已累积部分，parse 失败兜底 {}）
                blocks.push({ type: 'tool_use', id: buffer.id, name: buffer.name, input: parseInputJson(buffer.inputJson) })
            }
        }
        return blocks
    }

    /**
     * 标记当前 message 的完整 SDKAssistantMessage 已下发（sdkOutputLoop 收到 assistant 时调用）。
     * 之后 consumePendingFull 不再返回该 message 的内容，避免与已下发的 full 重复。
     */
    markFullDelivered(): void {
        this.fullDelivered = true
    }

    /**
     * 取出当前 message 的完整累积内容（用于 abort 补全落库）。
     * 仅当完整 full 未下发（!fullDelivered）且有累积内容时返回；否则返回 null。
     *
     * 语义是「当前 message 的完整累积内容」，不暴露 buffers 内部——未来 snapshot 改增量发送时
     * 只改 flush 的发送逻辑，本接口仍返回完整内容，abort 补全逻辑不变。
     *
     * 传 includePartialToolUse=true 给 buildBlocks：abort 时未 content_block_stop 的半截 tool_use
     * 也保留（input 兜底），避免「该工具被调用过」的记录整条丢失。
     */
    consumePendingFull(): { blocks: ContentBlock[]; model?: string; parentToolUseId?: string; messageId?: string } | null {
        if (this.fullDelivered || this.buffers.size === 0) return null
        return { blocks: this.buildBlocks(true), model: this.snapshotOpts.model, parentToolUseId: this.snapshotOpts.parentToolUseId, messageId: this.snapshotOpts.messageId }
    }

    /** 将 RawJSONLines 包装为 DecryptedMessage（与 sendClaudeSessionMessage 一致的角色信封格式） */
    private wrapAsDecryptedMessage(rawLog: RawJSONLines): DecryptedMessage {
        return {
            id: this.sdkUuid ?? SNAPSHOT_PENDING_ID,
            seq: null,
            localId: this.sdkUuid ?? null,
            snapshot: true,
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
