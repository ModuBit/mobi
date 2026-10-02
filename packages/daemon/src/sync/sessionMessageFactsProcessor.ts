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

import {
    asNumber,
    COMMAND_LIFECYCLE_STATES,
    isObject,
    type CommandLifecycleState,
    type NativeMessageMetadata,
    type SyncEvent,
} from '@mobi/shared'

import { hubLogger } from '../logger'
import type { Store, StoredMessage } from '../store'
import { extractWithdrawnContent } from '../store/messages'

type StoredMessagesPublication = {
    type: 'stored-messages'
    sessionId: string
    messages: StoredMessage[]
    /** 历史行补写：消费端只合并已在窗口的行，不得追加为新消息。 */
    backfill?: true
}

export type MessageFactsPublication =
    | StoredMessagesPublication
    | Extract<SyncEvent, { type: 'messages-submitted' | 'message-withdrawn' }>

export type MessageFactsInput = {
    sessionId: string
    /** Socket 输入不可信；每种 fact 的字段由 module 内部收窄。 */
    facts: readonly unknown[]
}

const COMMAND_LIFECYCLE_STATE_SET: ReadonlySet<string> = new Set(COMMAND_LIFECYCLE_STATES)
const TERMINAL_LIFECYCLES: ReadonlySet<string> = new Set([
    'done',
    'cancelled',
    'discarded',
    'refused',
])

function nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

function observedAt(fact: Record<string, unknown>, fallback: number): number {
    return asNumber(fact.at) ?? fallback
}

/**
 * CLI 消息事实的连接级处理 module。
 *
 * Socket adapter 只校验批次外层和会话访问权；本 module 收窄每种 fact、
 * 执行幂等/单调持久化，并惰性产出按 fact 顺序排列的发布结果。它不依赖
 * Socket 或 SSE。
 *
 * 每个 CLI Socket 连接必须持有独立实例：attached fact 建立的 native session
 * 上下文只对该连接后续的合成消息有效。
 */
export class SessionMessageFactsProcessor {
    private readonly nativeSessionIds = new Map<string, string>()
    private readonly now: () => number

    constructor(
        private readonly store: Store,
        options?: { now?: () => number },
    ) {
        this.now = options?.now ?? Date.now
    }

    /** 为当前连接的后续合成消息补齐 attached fact 已确认的 nativeSessionId。 */
    enrichMetadata(
        sessionId: string,
        metadata: NativeMessageMetadata | null,
    ): NativeMessageMetadata | null {
        const nativeSessionId = this.nativeSessionIds.get(sessionId)
        if (!nativeSessionId || metadata?.nativeSessionId) return metadata
        return { ...(metadata ?? {}), nativeSessionId }
    }

    /**
     * 逐 fact 收窄并持久化，惰性产出 publication——消费方边处理边发布，
     * 批次中途存储异常不丢已持久化事实的发布（保持旧 handler 的交错语义）。
     */
    *process(input: MessageFactsInput): Generator<MessageFactsPublication> {
        const { sessionId, facts } = input
        const batchNow = this.now()

        for (const value of facts) {
            if (!isObject(value)) continue
            const kind = nonEmptyString(value.kind)
            if (!kind) continue

            switch (kind) {
                case 'pushed':
                    yield* this.processPushed(sessionId, value, batchNow)
                    break
                case 'bound':
                    yield* this.processBound(sessionId, value)
                    break
                case 'attached':
                    yield* this.processAttached(sessionId, value)
                    break
                case 'acked':
                    yield* this.processAcked(sessionId, value, batchNow)
                    break
                case 'lifecycle':
                    yield* this.processLifecycle(sessionId, value, batchNow)
                    break
                case 'withdrawn':
                    yield* this.processWithdrawn(sessionId, value, batchNow)
                    break
            }
        }
    }

    private *processPushed(
        sessionId: string,
        fact: Record<string, unknown>,
        batchNow: number,
    ): Generator<MessageFactsPublication> {
        if (!Array.isArray(fact.localIds)) return
        const localIds = fact.localIds
            .map(nonEmptyString)
            .filter((id): id is string => id !== null)
        if (localIds.length === 0) return

        const result = this.store.messages.markMessagesPushed(
            sessionId,
            localIds,
            observedAt(fact, batchNow),
        )
        if (result.localIds.length === 0) return

        yield {
            type: 'messages-submitted',
            sessionId,
            localIds: result.localIds,
            submittedAt: result.positionAt,
        }
    }

    private *processBound(
        sessionId: string,
        fact: Record<string, unknown>,
    ): Generator<MessageFactsPublication> {
        const localId = nonEmptyString(fact.localId)
        const nativeId = nonEmptyString(fact.nativeId)
        if (!localId || !nativeId) return

        // nsid 缺省或无效均仅省略不补（CLI 侧旧帧对无效值即省略），不弃整条绑定
        const nativeSessionId = nonEmptyString(fact.nativeSessionId)

        const messages = this.store.messages.bindNativeIds(sessionId, [{
            localId,
            metadata: {
                nativeId,
                ...(nativeSessionId ? { nativeSessionId } : {}),
            },
        }])
        yield* this.publishStoredMessages(sessionId, messages)
    }

    private *processAttached(
        sessionId: string,
        fact: Record<string, unknown>,
    ): Generator<MessageFactsPublication> {
        const nativeSessionId = nonEmptyString(fact.nativeSessionId)
        if (!nativeSessionId) return

        this.nativeSessionIds.set(sessionId, nativeSessionId)
        const messages = this.store.messages.attachNativeSessionId(sessionId, nativeSessionId)
        yield* this.publishStoredMessages(sessionId, messages, true)
    }

    private *processAcked(
        sessionId: string,
        fact: Record<string, unknown>,
        batchNow: number,
    ): Generator<MessageFactsPublication> {
        const nativeId = nonEmptyString(fact.nativeId)
        if (!nativeId) return

        const at = observedAt(fact, batchNow)
        const ids = new Set(this.store.messages.advanceMessagesAcked(sessionId, nativeId, at))
        for (const message of this.store.messages.markMessagesAcked(sessionId, nativeId, at)) {
            ids.add(message.id)
        }
        if (ids.size === 0) return

        const messages = this.store.messages.getMessagesByIds(sessionId, [...ids])
        yield* this.publishStoredMessages(sessionId, messages)
    }

    private *processLifecycle(
        sessionId: string,
        fact: Record<string, unknown>,
        batchNow: number,
    ): Generator<MessageFactsPublication> {
        const nativeId = nonEmptyString(fact.nativeId)
        if (
            !nativeId
            || typeof fact.state !== 'string'
            || !COMMAND_LIFECYCLE_STATE_SET.has(fact.state)
        ) return

        const state = fact.state as CommandLifecycleState
        const ids = this.store.messages.advanceMessagesLifecycle(
            sessionId,
            nativeId,
            state,
            observedAt(fact, batchNow),
        )
        if (ids.length === 0) return

        const terminalReason = nonEmptyString(fact.terminalReason)
        if (state !== 'processing' && terminalReason) {
            this.store.messages.markTerminalReason(sessionId, ids, terminalReason)
        }
        const messages = this.store.messages.getMessagesByIds(sessionId, ids)
        yield* this.publishStoredMessages(sessionId, messages)
    }

    private *processWithdrawn(
        sessionId: string,
        fact: Record<string, unknown>,
        batchNow: number,
    ): Generator<MessageFactsPublication> {
        const nativeId = nonEmptyString(fact.nativeId)
        if (!nativeId) return

        const first = this.store.messages.getMessagesByNativeId(sessionId, nativeId)[0]
        if (!first) return
        if (TERMINAL_LIFECYCLES.has(first.lifecycle ?? '')) {
            hubLogger.debug(`[messages-facts] withdrawn skipped: anchor already terminal (sid=${sessionId} nativeId=${nativeId} lifecycle=${first.lifecycle})`)
            return
        }
        if (this.store.messages.hasQueuedMessagesAfter(sessionId, first.seq)) {
            hubLogger.debug(`[messages-facts] withdrawn skipped: queued rows exist after anchor (sid=${sessionId} nativeId=${nativeId} seq=${first.seq})`)
            return
        }

        this.store.messages.softDeleteMessagesFrom(sessionId, first.seq)
        this.store.messages.advanceMessagesLifecycle(
            sessionId,
            nativeId,
            'withdrawn',
            observedAt(fact, batchNow),
        )
        const { blocks, originalText } = extractWithdrawnContent(first.content)
        yield {
            type: 'message-withdrawn',
            sessionId,
            localId: first.localId ?? first.id,
            blocks,
            originalText,
        }
    }

    private *publishStoredMessages(
        sessionId: string,
        messages: StoredMessage[],
        backfill = false,
    ): Generator<StoredMessagesPublication> {
        if (messages.length === 0) return
        yield {
            type: 'stored-messages',
            sessionId,
            messages,
            ...(backfill ? { backfill: true as const } : {}),
        }
    }
}
