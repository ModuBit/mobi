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

import { SNAPSHOT_PENDING_ID, type DecryptedMessage, type SnapshotBlock, type SnapshotBlockDelta, type SnapshotDeltaFrame } from '@mobi/shared'
import type { SDKAssistantMessage } from '@anthropic-ai/claude-agent-sdk'
import type { RawJSONLines } from '@/claude/types'
import type { SDKToLogConverter } from './sdkToLogConverter'

/**
 * 发送侧输出帧（delta 协议，.scratch/snapshot-delta spec）：
 * - full：全量帧（流首帧 / forceFull 重发），携带完整 DecryptedMessage + rev（baseRev=null）
 * - delta：增量帧（此后每次 flush 的增量 op）
 * transport 消费方据此映射到 socket 协议（sendContentSnapshot / sendSnapshotDelta）
 */
export type SnapshotOut =
    | { kind: 'full'; frame: { localId: string; rev: number; baseRev: null }; message: DecryptedMessage }
    | { kind: 'delta'; frame: SnapshotDeltaFrame }

type SnapshotTransport = (out: SnapshotOut) => void

/** 文本类（text/thinking）缓冲区：流式逐字追加，过程中即可输出 */
interface TextLikeBuffer {
    kind: 'text-like'
    type: 'text' | 'thinking'
    content: string
    dirty: boolean
    /** thinking 块起始时间戳（content_block_start 时刻），用于算 durationMs；仅 thinking 有意义 */
    startTs?: number
    /** thinking 块流式生成耗时（content_block_start→stop 的 wall clock 差），endBlock 后填 */
    durationMs?: number
    /** thinking 块是否已收到 content_block_stop（思考完成） */
    done?: boolean
    // —— delta 发送游标（增量协议，下同）：已通过全量/增量帧下发的进度 ——
    /** 是否已进入增量链（首帧全量或 new-block 初始化后置 true） */
    sentInit?: boolean
    /** 已下发的 content 前缀长度（下一帧从此处切后缀） */
    sentLen?: number
    /** thinking done 翻转是否已下发（replace-block 一次性） */
    doneSent?: boolean
}

/** tool_use 缓冲区：累积 input_json_delta，content_block_stop 后 parse 为完整 input 填充占位 */
interface ToolUseBuffer {
    kind: 'tool_use'
    id: string
    name: string
    /** 累积 input 分片，content_block_stop 后 parse 为完整 input 填充占位 */
    inputJson: string
    /** content_block_stop 后置 true，表示 input 已完整并 parse 缓存到 parsedInput（未 ready 时也发占位，input 用初始 {}） */
    ready: boolean
    /** startBlock（占位下发）与 ready 翻转（完整 input）时各标脏一次，触发 flush 输出 */
    dirty: boolean
    /** ready 时一次性 parse 缓存（inputJson 此后不变，避免每次 flush 重复 parse）；初始 {} 作占位 */
    parsedInput: unknown
    // —— delta 发送游标 ——
    /** 占位（new-block）是否已下发 */
    placeholderSent?: boolean
    /** ready 翻转（replace-block 完整 input）是否已下发 */
    readySent?: boolean
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
    | { type: 'thinking'; thinking: string; durationMs?: number; done?: boolean }
    | { type: 'tool_use'; id: string; name: string; input: unknown }

/**
 * 流式 Snapshot 发送器（delta 协议，.scratch/snapshot-delta spec）
 *
 * 累积 SDK StreamEvent 中的 text_delta / thinking_delta / input_json_delta(tool_use)，
 * 每 500ms 发送一次。发送采用「首帧全量 + 此后增量」：流首帧（或 socket 重连重发）
 * 携带完整累积内容建立基线，之后每帧只发增量 op（append 后缀 / new-block / replace-block），
 * 传输量 O(N) 而非全量重发的 O(N²)。op 直接从 buffer 状态变迁产出（事件驱动，无 diff 比较）。
 * rev/baseRev 由本发送器按流分配，接收方（hub）严格衔接校验、断档丢弃等全量重基线。
 *
 * text/thinking 流式逐字追加，过程中即可输出（半截文本有意义）。
 * tool_use 在 content_block_start 即下发 input={} 占位——前端立即建 running 卡片，
 * 消除 Write/Edit 等大 input 工具在模型流式生成 input 内容期间的视觉盲区（半截 JSON 无意义，
 * 但占位卡片只需工具名，不依赖 input）；content_block_stop 后再 flush 填充完整 input，
 * 前端按 tool_use_id 就地更新（input 空→满不闪烁）。
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
    /** delta 流状态：当前消息流内单调递增的帧序号（0=尚未发帧） */
    private streamRev = 0
    /** 当前流是否已发出首帧（false=下一帧必为全量） */
    private streamHasSent = false
    /** 强制下一帧为全量（socket 重连重发，见 forceFullFlush） */
    private forceFull = false

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
        // 新消息流：rev 归零、首帧必全量（sent-state 随 clearBuffers 的 buffer 重建自然重置）
        this.streamRev = 0
        this.streamHasSent = false
        this.forceFull = false
    }

    /** 清除所有 buffer（新消息开始时调用） */
    clearBuffers(): void {
        if (this.destroyed) return
        this.buffers.clear()
    }

    /** 记录 content_block_start（text/thinking 逐字流式；tool_use 累积 input JSON）
     *  tool_use 在 start 时即 flush 下发 input={} 占位——让前端立即建 running 卡片，
     *  消除 Write/Edit 等大 input 工具在模型生成内容期间（input_json_delta 累积）的视觉盲区。
     *  content_block_stop 后再 flush 填充完整 input，前端按 tool_use_id 就地更新。
     */
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
                dirty: true, // 立即标脏，触发占位下发
                parsedInput: {},
            })
            this.flush() // content_block_start 即下发 input={} 占位（不等 content_block_stop）
            return
        }
        this.buffers.set(index, {
            kind: 'text-like',
            type,
            content: '',
            dirty: false,
            // thinking 记起始时间戳，endBlock 时算 durationMs（思考耗时）；text 无此需求
            ...(type === 'thinking' ? { startTs: Date.now() } : {}),
        })
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
     * tool_use 在此标记 ready 并一次性 parse 缓存 input（此后不变），立即 flush 下发完整 input（填充占位）。
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
        } else if (buffer?.kind === 'text-like' && buffer.type === 'thinking' && buffer.startTs != null) {
            // thinking 收到 content_block_stop：算最终耗时、置完成标记，标脏立即下发（消除「思考完成→text 开头」误判窗口）
            buffer.durationMs = Date.now() - buffer.startTs
            buffer.done = true
            buffer.dirty = true
        }
        this.flush()
    }

    /** 开始节流发送 */
    start(): void {
        if (this.destroyed || this.timer) return
        this.timer = setInterval(() => this.flush(), this.intervalMs)
    }

    /**
     * 立即刷新：流首帧（或 forceFull）发全量帧，此后发增量帧。
     * 无未下发内容时不发帧（delta 帧无 op / 全量帧无变化均跳过）。
     */
    flush(): void {
        if (this.destroyed) return

        if (!this.streamHasSent || this.forceFull) {
            this.emitFull()
            return
        }

        // 增量：无脏 buffer 直接跳过（collectDeltas 结果必空）
        let hasDirty = false
        for (const buffer of this.buffers.values()) {
            if (buffer.dirty) { hasDirty = true; break }
        }
        if (!hasDirty) return

        const deltas = this.collectDeltas()
        this.clearDirty()
        if (deltas.length === 0) return

        this.streamRev += 1
        this.transport({
            kind: 'delta',
            frame: {
                localId: this.streamLocalId(),
                rev: this.streamRev,
                baseRev: this.streamRev - 1,
                deltas,
            },
        })
    }

    /**
     * socket 重连后重发全量帧（重基线规则：断线期间的 delta 帧已丢，hub 链必断档，
     * 全量帧重建基线）。无在途内容或尚未发出过任何帧时为 no-op（无需重基线）。
     */
    forceFullFlush(): void {
        if (this.destroyed || this.buffers.size === 0 || !this.streamHasSent) return
        this.forceFull = true
        this.flush()
    }

    /** 发送全量帧并初始化各 buffer 的发送游标（已发送=当前累积全量） */
    private emitFull(): void {
        // 无任何累积内容时不发空帧（tool_use 占位场景 startBlock 已标脏，正常不会走到）
        if (this.buffers.size === 0) {
            this.forceFull = false
            return
        }

        const rawLog = this.converter.convertSnapshot(this.buildBlocks(), this.snapshotOpts)
        this.streamRev += 1
        this.transport({
            kind: 'full',
            frame: { localId: this.streamLocalId(), rev: this.streamRev, baseRev: null },
            message: this.wrapAsDecryptedMessage(rawLog),
        })

        // 初始化发送游标：全量已含当前全部累积
        for (const buffer of this.buffers.values()) {
            if (buffer.kind === 'text-like') {
                buffer.sentInit = true
                buffer.sentLen = buffer.content.length
                buffer.doneSent = Boolean(buffer.done)
            } else {
                buffer.placeholderSent = true
                buffer.readySent = buffer.ready
            }
            buffer.dirty = false
        }
        this.streamHasSent = true
        this.forceFull = false
    }

    /**
     * 收集自上次下发以来的增量 op（事件驱动，无 diff 比较）：
     * - 未入链的 buffer → new-block（携带当前累积；tool_use 携带占位/已 ready 的完整 input）
     * - text/thinking → 超出 sentLen 的后缀 append
     * - tool_use ready 翻转 / thinking done 翻转 → replace-block（一次性全块替换）
     * index 为 buffer 在 Map 迭代序（=插入序=blocks 数组序）中的位置。
     */
    private collectDeltas(): SnapshotBlockDelta[] {
        const deltas: SnapshotBlockDelta[] = []
        let index = 0
        for (const buffer of this.buffers.values()) {
            const pos = index
            index += 1
            if (buffer.kind === 'text-like') {
                if (!buffer.sentInit) {
                    // 首帧后新增的块：整块作为 new-block 入链
                    deltas.push({ op: 'new-block', index: pos, block: this.textLikeBlock(buffer) })
                    buffer.sentInit = true
                    buffer.sentLen = buffer.content.length
                    buffer.doneSent = Boolean(buffer.done)
                    continue
                }
                if (buffer.content.length > (buffer.sentLen ?? 0)) {
                    deltas.push({ op: 'append', index: pos, text: buffer.content.slice(buffer.sentLen) })
                    buffer.sentLen = buffer.content.length
                }
                if (buffer.type === 'thinking' && buffer.done && !buffer.doneSent) {
                    deltas.push({ op: 'replace-block', index: pos, block: this.textLikeBlock(buffer) })
                    buffer.doneSent = true
                }
                continue
            }
            // tool_use
            if (!buffer.placeholderSent) {
                deltas.push({
                    op: 'new-block',
                    index: pos,
                    block: { type: 'tool_use', id: buffer.id, name: buffer.name, input: buffer.parsedInput },
                })
                buffer.placeholderSent = true
                buffer.readySent = buffer.ready
            } else if (buffer.ready && !buffer.readySent) {
                deltas.push({
                    op: 'replace-block',
                    index: pos,
                    block: { type: 'tool_use', id: buffer.id, name: buffer.name, input: buffer.parsedInput },
                })
                buffer.readySent = true
            }
        }
        return deltas
    }

    private textLikeBlock(buffer: TextLikeBuffer): SnapshotBlock {
        if (buffer.type === 'text') {
            return { type: 'text', text: buffer.content }
        }
        return buffer.done
            ? { type: 'thinking', thinking: buffer.content, durationMs: buffer.durationMs, done: true }
            : { type: 'thinking', thinking: buffer.content }
    }

    private clearDirty(): void {
        for (const buffer of this.buffers.values()) {
            buffer.dirty = false
        }
    }

    private streamLocalId(): string {
        return this.sdkUuid ?? SNAPSHOT_PENDING_ID
    }

    /**
     * 从 buffers 构造完整 ContentBlock[]（按插入顺序，含已 endBlock 的——endBlock 不删 buffer）。
     *
     * - text/thinking：总是输出（流式中也含已累积内容，半截文本有意义）
     * - tool_use：ready 后用 ready 时缓存的 parsedInput；未 ready 时也输出占位（parsedInput 初始 {}），
     *   让 content_block_start 即下发占位卡片。abort 补全（includePartialToolUse）时未 ready 改用
     *   累积 inputJson 兜底 parse，保留半截记录。
     */
    private buildBlocks(includePartialToolUse = false): ContentBlock[] {
        const blocks: ContentBlock[] = []
        for (const buffer of this.buffers.values()) {
            if (buffer.kind === 'text-like') {
                if (buffer.type === 'text') {
                    blocks.push({ type: 'text', text: buffer.content })
                } else {
                    // thinking：done 后带 durationMs/done；流式中不带（done undefined → 前端继续显示思考中）
                    blocks.push(buffer.done
                        ? { type: 'thinking', thinking: buffer.content, durationMs: buffer.durationMs, done: true }
                        : { type: 'thinking', thinking: buffer.content })
                }
            } else {
                // tool_use：ready 用 ready 时缓存的 parsedInput；未 ready 实时占位也用 parsedInput（初始 {}）
                //   ——让 content_block_start 立即下发占位，消除大 input 工具（Write/Edit）生成内容期间的盲区
                // abort 补全（includePartialToolUse）：未 ready 时改用累积 inputJson 兜底 parse，保留半截记录
                const input = buffer.ready
                    ? buffer.parsedInput
                    : includePartialToolUse
                        ? parseInputJson(buffer.inputJson)
                        : buffer.parsedInput
                blocks.push({ type: 'tool_use', id: buffer.id, name: buffer.name, input })
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
     * 把已打点的 thinking durationMs/done 注入完整 SDKAssistantMessage 的 thinking block。
     *
     * 必要性：messageCache 的 snapshot→full 是替换不是合并，full 若不重新携带这两个字段，
     * 思考完成后「思考了 X 秒」会在 full 到达时丢失。
     *
     * 匹配：full message 的 content 数组下标 = stream event 的 content_block index
     * （SDK 透传 raw API event，assembler 装配保序），故按 content 数组下标查 buffers 命中。
     * 仅注入已 done 的 thinking（未 stop 的思考不在 full 到达时存在——full 意味 message 完整，
     * thinking 必已 stop）；未命中的 thinking block 不动（保留 SDK 原样，如 abort 后无 meta）。
     *
     * 在 sdkOutputLoop 下发 full assistant 前调用（同一 message 周期内，buffers 尚未被下一条
     * message_start 的 clearBuffers 清空）。
     */
    injectThinkingMeta(msg: SDKAssistantMessage): void {
        if (this.destroyed) return
        const content = msg.message?.content
        if (!Array.isArray(content)) return
        for (let i = 0; i < content.length; i++) {
            const block = content[i]
            if (!block || typeof block !== 'object') continue
            const b = block as { type?: unknown; durationMs?: number; done?: boolean }
            if (b.type !== 'thinking') continue
            const buffer = this.buffers.get(i)
            // buffers 按全局 block index 存储；thinking 的 buffer 在 endBlock 后带 durationMs/done
            if (!buffer || buffer.kind !== 'text-like' || buffer.type !== 'thinking' || !buffer.done) continue
            b.durationMs = buffer.durationMs
            b.done = true
        }
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
