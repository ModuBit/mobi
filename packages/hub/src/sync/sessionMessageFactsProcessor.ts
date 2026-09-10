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
    COMMAND_LIFECYCLE_STATES,
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

function observedAt(fact: Record<string, unknown>, fallback: number): number {
    return typeof fact.at === 'number' && Number.isFinite(fact.at) ? fact.at : fallback
}

/**
 * CLI 消息事实的连接级处理 module。
 *
 * Socket adapter 只校验批次外层和会话访问权；本 module 收窄每种 fact、
 * 执行幂等/单调持久化，并返回按 fact 顺序排列的发布结果。它不依赖
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

    process(input: MessageFactsInput): MessageFactsPublication[] {
        const { sessionId, facts } = input
        const batchNow = this.now()
        const publications: MessageFactsPublication[] = []

        for (const value of facts) {
            if (!isRecord(value)) continue
            const kind = nonEmptyString(value.kind)
            if (!kind) continue

            switch (kind) {
                case 'pushed':
                    this.processPushed(sessionId, value, batchNow, publications)
                    break
                case 'bound':
                    this.processBound(sessionId, value, publications)
                    break
                case 'attached':
                    this.processAttached(sessionId, value, publications)
                    break
                case 'acked':
                    this.processAcked(sessionId, value, batchNow, publications)
                    break
                case 'lifecycle':
                    this.processLifecycle(sessionId, value, batchNow, publications)
                    break
                case 'withdrawn':
                    this.processWithdrawn(sessionId, value, batchNow, publications)
                    break
            }
        }

        return publications
    }

    private processPushed(
        sessionId: string,
        fact: Record<string, unknown>,
        batchNow: number,
        publications: MessageFactsPublication[],
    ): void {
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

        publications.push({
            type: 'messages-submitted',
            sessionId,
            localIds: result.localIds,
            submittedAt: result.positionAt,
        })
    }

    private processBound(
        sessionId: string,
        fact: Record<string, unknown>,
        publications: MessageFactsPublication[],
    ): void {
        const localId = nonEmptyString(fact.localId)
        const nativeId = nonEmptyString(fact.nativeId)
        if (!localId || !nativeId) return

        const nativeSessionId = fact.nativeSessionId === undefined
            ? undefined
            : nonEmptyString(fact.nativeSessionId)
        if (fact.nativeSessionId !== undefined && !nativeSessionId) return

        const messages = this.store.messages.bindNativeIds(sessionId, [{
            localId,
            metadata: {
                nativeId,
                ...(nativeSessionId ? { nativeSessionId } : {}),
            },
        }])
        this.publishStoredMessages(sessionId, messages, publications)
    }

    private processAttached(
        sessionId: string,
        fact: Record<string, unknown>,
        publications: MessageFactsPublication[],
    ): void {
        const nativeSessionId = nonEmptyString(fact.nativeSessionId)
        if (!nativeSessionId) return

        this.nativeSessionIds.set(sessionId, nativeSessionId)
        const messages = this.store.messages.attachNativeSessionId(sessionId, nativeSessionId)
        this.publishStoredMessages(sessionId, messages, publications, true)
    }

    private processAcked(
        sessionId: string,
        fact: Record<string, unknown>,
        batchNow: number,
        publications: MessageFactsPublication[],
    ): void {
        const nativeId = nonEmptyString(fact.nativeId)
        if (!nativeId) return

        const at = observedAt(fact, batchNow)
        const ids = new Set(this.store.messages.advanceMessagesAcked(sessionId, nativeId, at))
        for (const message of this.store.messages.markMessagesAcked(sessionId, nativeId, at)) {
            ids.add(message.id)
        }
        if (ids.size === 0) return

        const messages = this.store.messages.getMessagesByIds(sessionId, [...ids])
        this.publishStoredMessages(sessionId, messages, publications)
    }

    private processLifecycle(
        sessionId: string,
        fact: Record<string, unknown>,
        batchNow: number,
        publications: MessageFactsPublication[],
    ): void {
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
        this.publishStoredMessages(sessionId, messages, publications)
    }

    private processWithdrawn(
        sessionId: string,
        fact: Record<string, unknown>,
        batchNow: number,
        publications: MessageFactsPublication[],
    ): void {
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
        publications.push({
            type: 'message-withdrawn',
            sessionId,
            localId: first.localId ?? first.id,
            blocks,
            originalText,
        })
    }

    private publishStoredMessages(
        sessionId: string,
        messages: StoredMessage[],
        publications: MessageFactsPublication[],
        backfill = false,
    ): void {
        if (messages.length === 0) return
        publications.push({
            type: 'stored-messages',
            sessionId,
            messages,
            ...(backfill ? { backfill: true as const } : {}),
        })
    }
}
